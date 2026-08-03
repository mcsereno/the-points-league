import { env } from "cloudflare:workers";
import { isSameOrigin, requireCommissioner } from "../../../lib/portal-auth";
import { syncLeagueOdds } from "../../../lib/odds-sync";
import { settleCompletedGames, syncLeagueScores } from "../../../lib/settlement";
import { recordAudit } from "../../../lib/audit";

type League = "nfl" | "cfb";

export async function POST(request:Request){
  if(!isSameOrigin(request))return Response.json({error:"Invalid request origin."},{status:403});
  const commissioner=await requireCommissioner();if(!commissioner)return Response.json({error:"Commissioner access required."},{status:403});
  const payload=await request.json().catch(()=>null) as {league?:unknown}|null;
  if(payload?.league!=null&&payload.league!=="nfl"&&payload.league!=="cfb")return Response.json({error:"League must be NFL or CFB."},{status:400});
  const leagues:League[]=payload?.league?[payload.league]:["nfl","cfb"];
  try{
    const oddsResults=[];
    for(const league of leagues)oddsResults.push(await syncLeagueOdds(league,true));
    const scoreResults=await Promise.all(leagues.map(league=>syncLeagueScores(league)));
    const feedResults=[...oddsResults,...scoreResults];
    const settlement=await settleCompletedGames();
    const failed=feedResults.filter(result=>!result.ok);
    const failureSummary=failed.map(result=>`${result.league.toUpperCase()}: ${result.reason??"No reason was returned."}`).join(" ");
    const label=leagues.map(league=>league.toUpperCase()).join(" + ");
    await recordAudit("manual_sync","feeds",leagues.join("-"),commissioner.member.email,{leagues,failed:failed.length,settlement});
    const sync=await env.DB.prepare("SELECT league,last_success_at AS lastSuccessAt,credits_remaining AS creditsRemaining,last_error AS lastError FROM odds_sync_state ORDER BY league").all();
    return Response.json({ok:!failed.length,results:[...feedResults,settlement],sync:sync.results,message:failed.length?`One or more ${label} feeds could not refresh. ${failureSummary}`:`${label} markets and game results refreshed. Settled tickets are up to date.`},{status:failed.length?502:200});
  }catch(error){
    console.error("Commissioner odds refresh failed",error);
    return Response.json({error:error instanceof Error?`Odds refresh failed: ${error.message}`:"Odds refresh failed before the service could return a result."},{status:500});
  }
}
