import { env } from "cloudflare:workers";
import { isSameOrigin, requireCommissioner } from "../../../lib/portal-auth";
import { syncLeagueOdds } from "../../../lib/odds-sync";
import { settleCompletedGames, syncLeagueScores } from "../../../lib/settlement";
import { recordAudit } from "../../../lib/audit";

export async function POST(request:Request){
  if(!isSameOrigin(request))return Response.json({error:"Invalid request origin."},{status:403});
  const commissioner=await requireCommissioner();if(!commissioner)return Response.json({error:"Commissioner access required."},{status:403});
  const feedResults=await Promise.all([
    syncLeagueOdds("nfl",true),
    syncLeagueOdds("cfb",true),
    syncLeagueScores("nfl"),
    syncLeagueScores("cfb"),
  ]);
  const settlement=await settleCompletedGames();
  const failed=feedResults.filter(result=>!result.ok);
  await recordAudit("manual_sync","feeds","nfl-cfb",commissioner.member.email,{failed:failed.length,settlement});
  const sync=await env.DB.prepare("SELECT league,last_success_at AS lastSuccessAt,credits_remaining AS creditsRemaining,last_error AS lastError FROM odds_sync_state ORDER BY league").all();
  return Response.json({ok:!failed.length,results:[...feedResults,settlement],sync:sync.results,message:failed.length?"One or more feeds could not refresh.":"Markets and game results refreshed. Settled tickets are up to date."},{status:failed.length?502:200});
}
