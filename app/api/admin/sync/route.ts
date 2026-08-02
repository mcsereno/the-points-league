import { env } from "cloudflare:workers";
import { isSameOrigin, requireCommissioner } from "../../../lib/portal-auth";
import { syncLeagueOdds } from "../../../lib/odds-sync";
import { settleCompletedGames, syncLeagueScores } from "../../../lib/settlement";
import { recordAudit } from "../../../lib/audit";

export async function POST(request:Request){
  if(!isSameOrigin(request))return Response.json({error:"Invalid request origin."},{status:403});
  const commissioner=await requireCommissioner();if(!commissioner)return Response.json({error:"Commissioner access required."},{status:403});
  try{
    const oddsResults=[
      await syncLeagueOdds("nfl",true),
      await syncLeagueOdds("cfb",true),
    ];
    const scoreResults=await Promise.all([
      syncLeagueScores("nfl"),
      syncLeagueScores("cfb"),
    ]);
    const feedResults=[...oddsResults,...scoreResults];
    const settlement=await settleCompletedGames();
    const failed=feedResults.filter(result=>!result.ok);
    const failureSummary=failed.map(result=>`${result.league.toUpperCase()}: ${result.reason??"No reason was returned."}`).join(" ");
    await recordAudit("manual_sync","feeds","nfl-cfb",commissioner.member.email,{failed:failed.length,settlement});
    const sync=await env.DB.prepare("SELECT league,last_success_at AS lastSuccessAt,credits_remaining AS creditsRemaining,last_error AS lastError FROM odds_sync_state ORDER BY league").all();
    return Response.json({ok:!failed.length,results:[...feedResults,settlement],sync:sync.results,message:failed.length?`One or more feeds could not refresh. ${failureSummary}`:"Markets and game results refreshed. Settled tickets are up to date."},{status:failed.length?502:200});
  }catch(error){
    console.error("Commissioner odds refresh failed",error);
    return Response.json({error:error instanceof Error?`Odds refresh failed: ${error.message}`:"Odds refresh failed before the service could return a result."},{status:500});
  }
}
