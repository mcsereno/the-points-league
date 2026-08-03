import { env } from "cloudflare:workers";
import { isSameOrigin, requireCommissioner } from "../../../lib/portal-auth";
import { syncLeagueOdds } from "../../../lib/odds-sync";
import { settleCompletedGames, syncLeagueScores } from "../../../lib/settlement";
import { recordAudit } from "../../../lib/audit";
import { competitionWeekLabels, leagueSeasonWeeks, leagueWeekKey, leagueWeekWindow, leagueWeekWindowForStart } from "../../../lib/league-config";
import { getLeagueSettings } from "../../../lib/league-settings";

type League = "nfl" | "cfb";

export async function POST(request:Request){
  if(!isSameOrigin(request))return Response.json({error:"Invalid request origin."},{status:403});
  const commissioner=await requireCommissioner();if(!commissioner)return Response.json({error:"Commissioner access required."},{status:403});
  const payload=await request.json().catch(()=>null) as {league?:unknown;week?:unknown}|null;
  if(payload?.league!=null&&payload.league!=="nfl"&&payload.league!=="cfb")return Response.json({error:"League must be NFL or CFB."},{status:400});
  if(payload?.week!=null&&typeof payload.week!=="string")return Response.json({error:"Week must be a valid league week."},{status:400});
  const leagues:League[]=payload?.league?[payload.league]:["nfl","cfb"];
  const settings=await getLeagueSettings();
  const weekKey=payload?.week??leagueWeekKey(leagueWeekWindow());
  const week=leagueWeekWindowForStart(weekKey);
  if(!week||!leagueSeasonWeeks(settings.seasonId).some(candidate=>candidate.key===weekKey))return Response.json({error:"Select a week in the current season."},{status:400});
  const weekLabels=competitionWeekLabels(settings.seasonId,weekKey);
  const weekLabel=weekLabels?`${weekLabels.nfl} / ${weekLabels.cfb}`:week.label;
  try{
    const oddsResults=[];
    for(const league of leagues)oddsResults.push(await syncLeagueOdds(league,true,weekKey));
    const scoreResults=await Promise.all(leagues.map(league=>syncLeagueScores(league,week)));
    const feedResults=[...oddsResults,...scoreResults];
    const settlement=await settleCompletedGames();
    const failed=feedResults.filter(result=>!result.ok);
    const failureSummary=failed.map(result=>`${result.league.toUpperCase()}: ${result.reason??"No reason was returned."}`).join(" ");
    const label=leagues.map(league=>league.toUpperCase()).join(" + ");
    await recordAudit("manual_sync","feeds",leagues.join("-"),commissioner.member.email,{leagues,week:weekKey,weekLabel,failed:failed.length,settlement});
    const sync=await env.DB.prepare("SELECT league,last_success_at AS lastSuccessAt,credits_remaining AS creditsRemaining,last_error AS lastError FROM odds_sync_state ORDER BY league").all();
    return Response.json({ok:!failed.length,results:[...feedResults,settlement],sync:sync.results,message:failed.length?`One or more ${label} feeds could not refresh for ${weekLabel}. ${failureSummary}`:`${label} markets refreshed for ${weekLabel}.`},{status:failed.length?502:200});
  }catch(error){
    console.error("Commissioner odds refresh failed",error);
    return Response.json({error:error instanceof Error?`Odds refresh failed: ${error.message}`:"Odds refresh failed before the service could return a result."},{status:500});
  }
}
