import { env } from "cloudflare:workers";
import { competitionWeekLabels, leagueSeasonWeeks, leagueWeekKey, leagueWeekWindow, leagueWeekWindowForStart } from "../../lib/league-config";
import { getLeagueSettings } from "../../lib/league-settings";

async function loadGames(league: string | null, start: string, end: string, includeStarted: boolean) {
  return env.DB.prepare("SELECT id,league,away_team AS awayTeam,home_team AS homeTeam,kickoff_at AS kickoffAt,status,odds_provider AS oddsProvider,odds_captured_at AS oddsCapturedAt FROM games WHERE (? IS NULL OR league=?) AND datetime(kickoff_at)>=datetime(?) AND datetime(kickoff_at)<datetime(?) AND (? = 1 OR datetime(kickoff_at)>datetime('now')) ORDER BY kickoff_at LIMIT 250").bind(league, league, start, end, includeStarted ? 1 : 0).all<Record<string, unknown>>();
}

function serializeWeek(week: { key: string; label: string; start: Date; end: Date }, currentKey: string, seasonId: string) {
  const competition = competitionWeekLabels(seasonId, week.key);
  return {
    key: week.key,
    label: week.label,
    competitionLabel: competition?.combined ?? week.label,
    start: week.start.toISOString(),
    end: week.end.toISOString(),
    isCurrent: week.key === currentKey,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league");
  if (league && league !== "nfl" && league !== "cfb") return Response.json({ error: "League must be nfl or cfb." }, { status: 400 });
  const settings = await getLeagueSettings();
  const currentWeek = leagueWeekWindow();
  const currentKey = leagueWeekKey(currentWeek);
  const seasonWeeks = leagueSeasonWeeks(settings.seasonId);
  const requestedWeek = params.get("week");
  const window = requestedWeek ? leagueWeekWindowForStart(requestedWeek) : currentWeek;
  if (!window || requestedWeek && !seasonWeeks.some((week) => week.key === requestedWeek)) {
    return Response.json({ error: "Week must be a Tuesday start within the current season." }, { status: 400 });
  }
  const selectedKey = leagueWeekKey(window);
  const selectedWeek = seasonWeeks.find((week) => week.key === selectedKey) ?? {
    key: selectedKey,
    label: selectedKey,
    ...window,
  };
  const isCurrentWeek = selectedKey === currentKey;
  const games = await loadGames(league, window.start.toISOString(), window.end.toISOString(), !isCurrentWeek);
  const feedConfigured = Boolean((env as unknown as Record<string, string | undefined>).RUNDOWN_API_KEY);
  const results = [];
  const freshAfter = new Date(Date.now() - settings.oddsStaleHours * 60 * 60 * 1000).toISOString();
  for (const game of games.results) {
    const outcomes = isCurrentWeek
      ? await env.DB.prepare("SELECT id,market,side,label,line,price,odds_provider AS oddsProvider,captured_at AS capturedAt FROM outcomes WHERE game_id=? AND datetime(captured_at)>=datetime(?) ORDER BY market,side").bind(game.id, freshAfter).all()
      : await env.DB.prepare("SELECT id,market,side,label,line,price,odds_provider AS oddsProvider,captured_at AS capturedAt FROM outcomes WHERE game_id=? ORDER BY market,side").bind(game.id).all();
    results.push({ ...game, outcomes: outcomes.results });
  }
  const sync = await env.DB.prepare("SELECT league,last_success_at AS lastSuccessAt,credits_remaining AS creditsRemaining,last_error AS lastError FROM odds_sync_state ORDER BY league").all();
  return Response.json({
    games: results,
    sync: sync.results,
    feedConfigured,
    week: serializeWeek(selectedWeek, currentKey, settings.seasonId),
    weeks: seasonWeeks.map((week) => serializeWeek(week, currentKey, settings.seasonId)),
    oddsStaleHours: settings.oddsStaleHours,
  });
}
