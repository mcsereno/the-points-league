import { env } from "cloudflare:workers";
import { leagueSeasonWeeks, leagueWeekWindow, leagueWeekWindowForStart, nflPreseasonWeekKeys } from "./league-config";
import { getLeagueSettings } from "./league-settings";
import { alertCommissionerOnce } from "./operations";
import { settleCompletedGames, syncLeagueScores } from "./settlement";
import { runSeasonLifecycle } from "./season-lifecycle";

type League = "nfl" | "cfb";
type MarketName = "moneyline" | "spread" | "total";
type RundownPrice = { price: number; is_main_line?: boolean };
type RundownLine = { value?: string | number | null; prices: Record<string, RundownPrice | undefined> };
type RundownParticipant = { name: string; lines?: RundownLine[] };
type RundownMarket = { market_id: number; period_id?: number; participants?: RundownParticipant[] };
type RundownTeam = { name: string; is_away?: boolean; is_home?: boolean };
type RundownEvent = {
  event_id: string;
  event_date: string;
  teams?: RundownTeam[];
  markets?: RundownMarket[];
};
type RundownPayload = { events?: RundownEvent[] };
type SelectedOutcome = { name: string; point: number | null; price: number };
type SelectedMarket = { market: MarketName; provider: string; outcomes: SelectedOutcome[] };
type EspnTeam = { displayName?: string; abbreviation?: string };
type EspnCompetitor = { homeAway?: "home" | "away"; team?: EspnTeam };
type EspnOdds = {
  provider?: { name?: string };
  details?: string;
  spread?: number;
  awayTeamOdds?: { spreadOdds?: number };
  homeTeamOdds?: { spreadOdds?: number };
};
type EspnEvent = { id?: string; date?: string; competitions?: Array<{ competitors?: EspnCompetitor[]; odds?: EspnOdds[] }> };
type EspnScoreboard = { events?: EspnEvent[] };

const MINIMUM_INTERVAL_MINUTES = 15;
const RUNDOWN_AFFILIATE_IDS = { pinnacle: "3", draftkings: "19", fanduel: "23" } as const;
const RUNDOWN_PROVIDER_NAMES: Record<string, string> = {
  [RUNDOWN_AFFILIATE_IDS.draftkings]: "DraftKings",
  [RUNDOWN_AFFILIATE_IDS.fanduel]: "FanDuel",
  [RUNDOWN_AFFILIATE_IDS.pinnacle]: "Pinnacle",
};
const RUNDOWN_PROVIDER_PRIORITY = [
  RUNDOWN_AFFILIATE_IDS.draftkings,
  RUNDOWN_AFFILIATE_IDS.fanduel,
  RUNDOWN_AFFILIATE_IDS.pinnacle,
];
const RUNDOWN_REQUEST_INTERVAL_MS = 1_050;
let nextRundownRequestAt = 0;

function quotaValue(value: string | null) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pause(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRundownRequestSlot() {
  const delay = Math.max(0, nextRundownRequestAt - Date.now());
  if (delay) await pause(delay);
  nextRundownRequestAt = Date.now() + RUNDOWN_REQUEST_INTERVAL_MS;
}

async function requestRundown(url: URL, apiKey: string) {
  await waitForRundownRequestSlot();
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json", "x-therundown-key": apiKey } });
  } catch {
    return { response: null, error: "TheRundown service unavailable." };
  }
  if (response.ok) return { response, error: null };
  if (response.status !== 429) return { response, error: `TheRundown request failed (${response.status}).` };
  if (quotaValue(response.headers.get("x-datapoints-remaining")) === 0) {
    return { response, error: "TheRundown daily data-point limit is exhausted." };
  }

  const retryAfter = Math.min(5, Math.max(1, Number(response.headers.get("retry-after") ?? "1")));
  await pause(retryAfter * 1_000);
  await waitForRundownRequestSlot();
  try {
    response = await fetch(url, { headers: { accept: "application/json", "x-therundown-key": apiKey } });
  } catch {
    return { response: null, error: "TheRundown service unavailable." };
  }
  return response.ok
    ? { response, error: null }
    : { response, error: response.status === 429 ? "TheRundown request was rate-limited (429)." : `TheRundown request failed (${response.status}).` };
}

async function recordState(league: League, success: boolean, response: Response | null, error: string | null) {
  await env.DB.prepare("INSERT INTO odds_sync_state (league,last_attempt_at,last_success_at,credits_remaining,credits_used,last_error,updated_at) VALUES (?,CURRENT_TIMESTAMP,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(league) DO UPDATE SET last_attempt_at=CURRENT_TIMESTAMP,last_success_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_success_at END,credits_remaining=COALESCE(excluded.credits_remaining,credits_remaining),credits_used=COALESCE(excluded.credits_used,credits_used),last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP")
    .bind(
      league,
      success ? 1 : 0,
      quotaValue(response?.headers.get("x-datapoints-remaining") ?? null),
      quotaValue(response?.headers.get("x-datapoints-used") ?? null),
      error,
      success ? 1 : 0,
    ).run();
}

function centralDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function centralDateSerial(date: Date) {
  const [year, month, day] = centralDateKey(date).split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

function refreshWeekDates(seasonId: string, weekKey?: string) {
  const week = weekKey ? leagueWeekWindowForStart(weekKey) : leagueWeekWindow();
  if (!week || weekKey && !leagueSeasonWeeks(seasonId).some((candidate) => candidate.key === weekKey)) return [];
  const start = centralDateSerial(week.start);
  const end = centralDateSerial(week.end);
  const dates: string[] = [];
  for (let cursor = start; cursor < end; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

function sportIdsFor(league: League, date: string) {
  if (league === "cfb") return [1];
  const month = Number(date.slice(5, 7));
  if (month === 7 || month === 8) return [25];
  if (month === 1 || month === 2) return [2, 26];
  return [2];
}

function rundownEventsUrl(sportId: number, date: string) {
  const url = new URL(`https://therundown.io/api/v2/sports/${sportId}/events/${date}`);
  url.searchParams.set("affiliate_ids", "3,19,23");
  url.searchParams.set("market_ids", "1,2,3");
  url.searchParams.set("main_line", "true");
  url.searchParams.set("offset", "300");
  return url;
}

function marketName(marketId: number): MarketName | null {
  if (marketId === 1) return "moneyline";
  if (marketId === 2) return "spread";
  if (marketId === 3) return "total";
  return null;
}

function eventTeams(event: RundownEvent) {
  const teams = event.teams ?? [];
  const away = teams.find((team) => team.is_away) ?? teams[0];
  const home = teams.find((team) => team.is_home) ?? teams[1];
  return away?.name && home?.name ? { away: away.name, home: home.name } : null;
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0.0001;
}

function mainLine(participant: RundownParticipant, affiliateId: string) {
  return participant.lines?.find((line) => {
    const price = line.prices?.[affiliateId];
    return validPrice(price?.price) && price?.is_main_line !== false;
  });
}

function selectedMarket(event: RundownEvent, market: RundownMarket) {
  const name = marketName(market.market_id);
  if (!name || market.period_id && market.period_id !== 0) return null;
  const teams = eventTeams(event);
  const availableIds = [...new Set((market.participants ?? []).flatMap((participant) => (
    participant.lines?.flatMap((line) => Object.keys(line.prices ?? {})) ?? []
  )))];
  const affiliateIds = [...RUNDOWN_PROVIDER_PRIORITY, ...availableIds.filter((id) => !RUNDOWN_PROVIDER_PRIORITY.includes(id))];

  for (const affiliateId of affiliateIds) {
    const outcomes = (market.participants ?? []).flatMap((participant) => {
      const line = mainLine(participant, affiliateId);
      const price = line?.prices?.[affiliateId]?.price;
      if (!line || !validPrice(price)) return [];
      const point = line.value == null || line.value === "" ? null : Number(line.value);
      if (point != null && !Number.isFinite(point)) return [];
      return [{ name: participant.name, point, price: Math.trunc(price) }];
    });
    const isComplete = name === "total"
      ? new Set(outcomes.map((outcome) => outcome.name.toLowerCase())).size === 2
        && outcomes.some((outcome) => outcome.name.toLowerCase() === "over")
        && outcomes.some((outcome) => outcome.name.toLowerCase() === "under")
      : Boolean(teams && outcomes.some((outcome) => outcome.name === teams.away) && outcomes.some((outcome) => outcome.name === teams.home));
    if (isComplete) return { market: name, provider: RUNDOWN_PROVIDER_NAMES[affiliateId] ?? "Available sportsbook", outcomes } satisfies SelectedMarket;
  }
  return null;
}

function chooseMarket(event: RundownEvent, marketNameToFind: MarketName) {
  const marketId = marketNameToFind === "moneyline" ? 1 : marketNameToFind === "spread" ? 2 : 3;
  const providerMarket = event.markets?.find((market) => market.market_id === marketId && (!market.period_id || market.period_id === 0));
  if (!providerMarket) return null;
  return selectedMarket(event, providerMarket);
}

function outcomeIdentity(gameId: string, market: MarketName, outcome: SelectedOutcome) {
  return `${gameId}:${market}:${outcome.name}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-");
}

function likelyNflGameDate(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 1 || weekday >= 4;
}

function espnFavoriteSide(odds: EspnOdds, away: EspnTeam, home: EspnTeam) {
  const details = odds.details?.toLowerCase() ?? "";
  const matches = (team: EspnTeam) => [team.displayName, team.abbreviation]
    .filter((value): value is string => Boolean(value))
    .some((value) => details.startsWith(value.toLowerCase()));
  if (matches(away)) return "away" as const;
  if (matches(home)) return "home" as const;
  return null;
}

function espnProvider(odds: EspnOdds[]) {
  return odds.find((item) => item.provider?.name === "DraftKings")
    ?? odds.find((item) => item.provider?.name === "FanDuel")
    ?? odds[0]
    ?? null;
}

async function syncEspnNflPreseasonOdds(seasonId: string) {
  const dates = nflPreseasonWeekKeys(seasonId)
    .flatMap((weekKey) => refreshWeekDates(seasonId, weekKey))
    .filter(likelyNflGameDate);
  const responses = await Promise.all(dates.map(async (date) => {
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date}&limit=100`);
      if (!response.ok) return [] as EspnEvent[];
      const payload = await response.json() as EspnScoreboard;
      return payload.events ?? [];
    } catch {
      return [] as EspnEvent[];
    }
  }));

  let games = 0;
  for (const event of responses.flat()) {
    const competition = event.competitions?.[0];
    const away = competition?.competitors?.find((item) => item.homeAway === "away")?.team;
    const home = competition?.competitors?.find((item) => item.homeAway === "home")?.team;
    const odds = espnProvider(competition?.odds ?? []);
    const favorite = odds && away && home ? espnFavoriteSide(odds, away, home) : null;
    const spread = Number(odds?.spread);
    if (!event.id || !event.date || !away?.displayName || !home?.displayName || !favorite || !Number.isFinite(spread)) continue;

    const favoriteLine = spread <= 0 ? spread : -spread;
    const awayLine = favorite === "away" ? favoriteLine : -favoriteLine;
    const homeLine = favorite === "home" ? favoriteLine : -favoriteLine;
    const awayPrice = Number(odds?.awayTeamOdds?.spreadOdds ?? -110);
    const homePrice = Number(odds?.homeTeamOdds?.spreadOdds ?? -110);
    const gameId = `espn:${event.id}`;
    const provider = odds.provider?.name ?? "ESPN available sportsbook";

    await env.DB.batch([
      env.DB.prepare("INSERT INTO games (id,league,away_team,home_team,kickoff_at,status,odds_provider,odds_captured_at) VALUES (?,?,?,?,?,'scheduled',?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET away_team=excluded.away_team,home_team=excluded.home_team,kickoff_at=excluded.kickoff_at,odds_provider=excluded.odds_provider,odds_captured_at=CURRENT_TIMESTAMP")
        .bind(gameId, "nfl", away.displayName, home.displayName, event.date, provider),
      env.DB.prepare("INSERT INTO outcomes (id,game_id,market,side,label,line,price,odds_provider,captured_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET label=excluded.label,line=excluded.line,price=excluded.price,odds_provider=excluded.odds_provider,captured_at=CURRENT_TIMESTAMP")
        .bind(`${gameId}:spread:away`, gameId, "spread", "away", away.displayName, awayLine, Number.isFinite(awayPrice) ? Math.trunc(awayPrice) : -110, provider),
      env.DB.prepare("INSERT INTO outcomes (id,game_id,market,side,label,line,price,odds_provider,captured_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET label=excluded.label,line=excluded.line,price=excluded.price,odds_provider=excluded.odds_provider,captured_at=CURRENT_TIMESTAMP")
        .bind(`${gameId}:spread:home`, gameId, "spread", "home", home.displayName, homeLine, Number.isFinite(homePrice) ? Math.trunc(homePrice) : -110, provider),
    ]);
    games += 1;
  }
  return { games, spreadGames: games };
}

async function fetchRundownEvents(league: League, apiKey: string, seasonId: string, weekKey?: string, scanDates = false) {
  const events: RundownEvent[] = [];
  let lastResponse: Response | null = null;
  const eligibleDates = new Set(refreshWeekDates(seasonId, weekKey));
  const dates = [...eligibleDates]
    .filter((date) => !scanDates || league !== "nfl" || likelyNflGameDate(date))
    .sort();
  const eventRequests = dates.flatMap((date) => sportIdsFor(league, date).map((sportId) => ({ sportId, date })));

  for (const { sportId, date } of eventRequests) {
    const request = await requestRundown(rundownEventsUrl(sportId, date), apiKey);
    if (!request.response || request.error) return { events, response: request.response ?? lastResponse, error: request.error ?? "TheRundown service unavailable." };
    lastResponse = request.response;
    let payload: RundownPayload;
    try {
      payload = await lastResponse.json() as RundownPayload;
    } catch {
      return { events, response: lastResponse, error: "TheRundown returned unreadable event data." };
    }
    events.push(...(payload.events ?? []));
  }

  return { events, response: lastResponse, error: null };
}

export async function syncLeagueOdds(league: League, force = false, weekKey?: string, scanDates = false) {
  const apiKey = (env as unknown as Record<string, string | undefined>).RUNDOWN_API_KEY;
  if (!apiKey) return { league, ok: false, skipped: true, reason: "RUNDOWN_API_KEY is not configured." };
  const settings = await getLeagueSettings();

  const state = await env.DB.prepare("SELECT last_attempt_at AS lastAttemptAt FROM odds_sync_state WHERE league=?").bind(league).first<{ lastAttemptAt: string | null }>();
  if (!force && state?.lastAttemptAt && Date.now() - new Date(state.lastAttemptAt).getTime() < MINIMUM_INTERVAL_MINUTES * 60_000) {
    return { league, ok: true, skipped: true, reason: "A recent refresh already ran." };
  }

  if (weekKey && !leagueSeasonWeeks(settings.seasonId).some((week) => week.key === weekKey)) {
    return { league, ok: false, skipped: false, reason: "The selected week is outside the current season." };
  }
  const result = await fetchRundownEvents(league, apiKey, settings.seasonId, weekKey, scanDates);
  if (result.error) {
    await recordState(league, false, result.response, result.error);
    return { league, ok: false, skipped: false, reason: result.error };
  }

  let games = 0;
  let spreadGames = 0;
  for (const event of result.events) {
    const teams = eventTeams(event);
    const gameId = `rundown:${event.event_id}`;
    const selected = (["moneyline", "spread", "total"] as MarketName[])
      .map((market) => chooseMarket(event, market))
      .filter((market): market is SelectedMarket => market != null);
    if (!teams || !selected.length) continue;

    await env.DB.prepare("INSERT INTO games (id,league,away_team,home_team,kickoff_at,status,odds_provider,odds_captured_at) VALUES (?,?,?,?,?,'scheduled',?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET away_team=excluded.away_team,home_team=excluded.home_team,kickoff_at=excluded.kickoff_at,odds_provider=excluded.odds_provider,odds_captured_at=CURRENT_TIMESTAMP")
      .bind(gameId, league, teams.away, teams.home, event.event_date, [...new Set(selected.map((market) => market.provider))].join(" · ")).run();
    games += 1;
    if (selected.some((market) => market.market === "spread")) spreadGames += 1;

    for (const market of selected) {
      const currentIds: string[] = [];
      for (const outcome of market.outcomes) {
        const side = market.market === "total" ? outcome.name.toLowerCase() : outcome.name === teams.away ? "away" : "home";
        const id = outcomeIdentity(gameId, market.market, outcome);
        currentIds.push(id);
        await env.DB.prepare("INSERT INTO outcomes (id,game_id,market,side,label,line,price,odds_provider,captured_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET label=excluded.label,line=excluded.line,price=excluded.price,odds_provider=excluded.odds_provider,captured_at=CURRENT_TIMESTAMP")
          .bind(id, gameId, market.market, side, outcome.name, outcome.point, outcome.price, market.provider).run();
      }
      const placeholders = currentIds.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM outcomes WHERE game_id=? AND market=? AND id NOT IN (${placeholders})`)
        .bind(gameId, market.market, ...currentIds).run();
    }
  }

  await recordState(league, true, result.response, null);
  return { league, ok: true, skipped: false, reason: null, games, spreadGames };
}

export async function syncNflPreseasonOdds(force = false) {
  const settings = await getLeagueSettings();
  const espn = await syncEspnNflPreseasonOdds(settings.seasonId);
  if (espn.games) {
    await recordState("nfl", true, null, null);
    return { league: "nfl" as const, ok: true, skipped: false, reason: null, weeks: nflPreseasonWeekKeys(settings.seasonId).length, ...espn };
  }
  const weeks = nflPreseasonWeekKeys(settings.seasonId);
  let games = 0;
  let spreadGames = 0;

  for (const weekKey of weeks) {
    const result = await syncLeagueOdds("nfl", force, weekKey, true);
    if (!result.ok) return { ...result, weeks: weeks.length, games, spreadGames };
    games += Number(result.games ?? 0);
    spreadGames += Number(result.spreadGames ?? 0);
  }

  return { league: "nfl" as const, ok: true, skipped: false, reason: null, weeks: weeks.length, games, spreadGames };
}

type CentralScheduleTarget = { weekdays: string[]; hour: number };

function happensInThreeHourWindow(date: Date, targets: CentralScheduleTarget[]) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const currentMinute = hour * 60 + minute;
  return targets.some((target) => target.weekdays.includes(weekday ?? "")
    && currentMinute >= target.hour * 60
    && currentMinute < (target.hour + 3) * 60);
}

export function isScheduledFeedTime(date: Date) {
  // The cron wakes every three hours in UTC. Treat each Central-time target as
  // a three-hour window so daylight saving time cannot cause a scheduled odds
  // refresh to be missed; it may run up to two hours after its target.
  return happensInThreeHourWindow(date, [
    { weekdays: ["Mon"], hour: 6 },
    { weekdays: ["Sun", "Tue", "Thu", "Fri", "Sat"], hour: 8 },
    { weekdays: ["Thu", "Fri", "Sat"], hour: 16 },
  ]);
}

function isSeasonLifecycleTime(date: Date) {
  // The league week ends Monday. One Tuesday morning pass avoids charging a
  // member before late Monday games and their scores have had time to settle.
  return happensInThreeHourWindow(date, [{ weekdays: ["Tue"], hour: 8 }]);
}

export async function runScheduledFeeds(scheduledTime: number) {
  const scheduledDate = new Date(scheduledTime);
  const scores = await Promise.all([syncLeagueScores("nfl"), syncLeagueScores("cfb")]);
  const settlement = await settleCompletedGames();
  const lifecycle = isSeasonLifecycleTime(scheduledDate) ? await runSeasonLifecycle(scheduledDate) : null;
  const odds = isScheduledFeedTime(scheduledDate)
    ? [await syncLeagueOdds("nfl"), await syncLeagueOdds("cfb")]
    : [];
  const failures = [...scores, ...odds].filter((item) => !item.ok && !item.skipped);
  const day = new Date(scheduledTime).toISOString().slice(0, 10);
  await Promise.all(failures.map((item) => alertCommissionerOnce(`automation:${day}:${item.league}:${item.reason}`, `Gridiron Ledger automation issue: ${item.league.toUpperCase()}`, `The scheduled ${item.league.toUpperCase()} feed did not finish.\n\n${item.reason ?? "No reason was returned."}\n\nOpen the Commissioner dashboard to review the feed status.`)));
  return [...scores, settlement, ...(lifecycle ? [lifecycle] : []), ...odds];
}
