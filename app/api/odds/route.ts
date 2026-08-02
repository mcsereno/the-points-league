import { env } from "cloudflare:workers";
import { leagueWeekWindow } from "../../lib/league-config";
import { getLeagueSettings } from "../../lib/league-settings";
import { syncLeagueOdds } from "../../lib/odds-sync";

async function loadGames(league: string | null, start: string, end: string) {
  return env.DB.prepare("SELECT id,league,away_team AS awayTeam,home_team AS homeTeam,kickoff_at AS kickoffAt,status,odds_provider AS oddsProvider,odds_captured_at AS oddsCapturedAt FROM games WHERE (? IS NULL OR league=?) AND datetime(kickoff_at)>=datetime(?) AND datetime(kickoff_at)<datetime(?) AND datetime(kickoff_at)>datetime('now') ORDER BY kickoff_at LIMIT 250").bind(league, league, start, end).all<Record<string, unknown>>();
}
export async function GET(request: Request) {
  const league = new URL(request.url).searchParams.get("league");
  if (league && league !== "nfl" && league !== "cfb") return Response.json({ error: "League must be nfl or cfb." }, { status: 400 });
  const settings = await getLeagueSettings();
  const week = leagueWeekWindow();
  let games = await loadGames(league, week.start.toISOString(), week.end.toISOString());
  const feedConfigured = Boolean((env as unknown as Record<string, string | undefined>).RUNDOWN_API_KEY);
  if (!games.results.length && feedConfigured) {
    if (league === "nfl" || league === "cfb") await syncLeagueOdds(league);
    else {
      await syncLeagueOdds("nfl");
      await syncLeagueOdds("cfb");
    }
    games = await loadGames(league, week.start.toISOString(), week.end.toISOString());
  }
  const results = [];
  const freshAfter = new Date(Date.now() - settings.oddsStaleHours * 60 * 60 * 1000).toISOString();
  for (const game of games.results) {
    const outcomes = await env.DB.prepare("SELECT id,market,side,label,line,price,odds_provider AS oddsProvider,captured_at AS capturedAt FROM outcomes WHERE game_id=? AND datetime(captured_at)>=datetime(?) ORDER BY market,side").bind(game.id, freshAfter).all();
    results.push({ ...game, outcomes: outcomes.results });
  }
  const sync = await env.DB.prepare("SELECT league,last_success_at AS lastSuccessAt,credits_remaining AS creditsRemaining,last_error AS lastError FROM odds_sync_state ORDER BY league").all();
  return Response.json({
    games: results,
    sync: sync.results,
    feedConfigured,
    week: { start: week.start.toISOString(), end: week.end.toISOString() },
    oddsStaleHours: settings.oddsStaleHours,
  });
}
