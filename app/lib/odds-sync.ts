import { env } from "cloudflare:workers";
import { leagueWeekWindow } from "./league-config";
import { alertCommissionerOnce } from "./operations";
import { settleCompletedGames, syncLeagueScores } from "./settlement";

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

const MINIMUM_INTERVAL_MINUTES = 15;
const RUNDOWN_AFFILIATE_IDS = { draftkings: "19", fanduel: "23" } as const;

function quotaValue(value: string | null) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function upcomingLeagueDates(now = new Date()) {
  const week = leagueWeekWindow(now);
  const start = Math.max(centralDateSerial(now), centralDateSerial(week.start));
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
  if (month === 8) return [25];
  if (month === 1 || month === 2) return [2, 26];
  return [2];
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

function selectedMarket(event: RundownEvent, market: RundownMarket, provider: "draftkings" | "fanduel") {
  const name = marketName(market.market_id);
  if (!name || market.period_id && market.period_id !== 0) return null;
  const affiliateId = RUNDOWN_AFFILIATE_IDS[provider];
  const outcomes = (market.participants ?? []).flatMap((participant) => {
    const line = mainLine(participant, affiliateId);
    const price = line?.prices?.[affiliateId]?.price;
    if (!line || !validPrice(price)) return [];
    const point = line.value == null || line.value === "" ? null : Number(line.value);
    if (point != null && !Number.isFinite(point)) return [];
    return [{ name: participant.name, point, price: Math.trunc(price) }];
  });
  const teams = eventTeams(event);
  const isComplete = name === "total"
    ? new Set(outcomes.map((outcome) => outcome.name.toLowerCase())).size === 2
      && outcomes.some((outcome) => outcome.name.toLowerCase() === "over")
      && outcomes.some((outcome) => outcome.name.toLowerCase() === "under")
    : Boolean(teams && outcomes.some((outcome) => outcome.name === teams.away) && outcomes.some((outcome) => outcome.name === teams.home));
  return isComplete ? { market: name, provider: provider === "draftkings" ? "DraftKings" : "FanDuel", outcomes } satisfies SelectedMarket : null;
}

function chooseMarket(event: RundownEvent, marketNameToFind: MarketName) {
  const marketId = marketNameToFind === "moneyline" ? 1 : marketNameToFind === "spread" ? 2 : 3;
  const providerMarket = event.markets?.find((market) => market.market_id === marketId && (!market.period_id || market.period_id === 0));
  if (!providerMarket) return null;
  return selectedMarket(event, providerMarket, "draftkings") ?? selectedMarket(event, providerMarket, "fanduel");
}

function outcomeIdentity(gameId: string, market: MarketName, outcome: SelectedOutcome) {
  return `${gameId}:${market}:${outcome.name}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-");
}

async function fetchRundownEvents(league: League, apiKey: string) {
  const events: RundownEvent[] = [];
  let lastResponse: Response | null = null;
  let firstRequest = true;

  for (const date of upcomingLeagueDates()) {
    for (const sportId of sportIdsFor(league, date)) {
      if (!firstRequest) await new Promise((resolve) => setTimeout(resolve, 1_050));
      firstRequest = false;
      const url = new URL(`https://therundown.io/api/v2/sports/${sportId}/events/${date}`);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("affiliate_ids", "19,23");
      url.searchParams.set("market_ids", "1,2,3");
      url.searchParams.set("main_line", "true");
      url.searchParams.set("offset", "300");

      try {
        lastResponse = await fetch(url, { headers: { accept: "application/json" } });
      } catch {
        return { events, response: lastResponse, error: "TheRundown service unavailable." };
      }
      if (!lastResponse.ok) {
        return { events, response: lastResponse, error: `TheRundown request failed (${lastResponse.status}).` };
      }
      const payload = await lastResponse.json() as RundownPayload;
      events.push(...(payload.events ?? []));
    }
  }
  return { events, response: lastResponse, error: null };
}

export async function syncLeagueOdds(league: League, force = false) {
  const apiKey = (env as unknown as Record<string, string | undefined>).RUNDOWN_API_KEY;
  if (!apiKey) return { league, ok: false, skipped: true, reason: "RUNDOWN_API_KEY is not configured." };

  const state = await env.DB.prepare("SELECT last_attempt_at AS lastAttemptAt FROM odds_sync_state WHERE league=?").bind(league).first<{ lastAttemptAt: string | null }>();
  if (!force && state?.lastAttemptAt && Date.now() - new Date(state.lastAttemptAt).getTime() < MINIMUM_INTERVAL_MINUTES * 60_000) {
    return { league, ok: true, skipped: true, reason: "A recent refresh already ran." };
  }

  const result = await fetchRundownEvents(league, apiKey);
  if (result.error) {
    await recordState(league, false, result.response, result.error);
    return { league, ok: false, skipped: false, reason: result.error };
  }

  let games = 0;
  for (const event of result.events) {
    const teams = eventTeams(event);
    const gameId = `rundown:${event.event_id}`;
    const selected = (["moneyline", "spread", "total"] as MarketName[])
      .map((market) => chooseMarket(event, market))
      .filter((market): market is SelectedMarket => market != null);
    if (!teams || !selected.length) continue;

    await env.DB.prepare("INSERT INTO games (id,league,away_team,home_team,kickoff_at,status,odds_provider,odds_captured_at) VALUES (?,?,?,?,?,'scheduled',?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET away_team=excluded.away_team,home_team=excluded.home_team,kickoff_at=excluded.kickoff_at,odds_provider=excluded.odds_provider,odds_captured_at=CURRENT_TIMESTAMP")
      .bind(gameId, league, teams.away, teams.home, event.event_date, "DraftKings · FanDuel backup").run();
    games += 1;

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
  return { league, ok: true, skipped: false, reason: null, games };
}

export function isScheduledFeedTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return weekday === "Mon" && hour === 6 || hour === 8 && ["Sun", "Tue", "Thu", "Fri", "Sat"].includes(weekday ?? "") || hour === 16 && ["Thu", "Fri", "Sat"].includes(weekday ?? "");
}

export async function runScheduledFeeds(scheduledTime: number) {
  const scores = await Promise.all([syncLeagueScores("nfl"), syncLeagueScores("cfb")]);
  const settlement = await settleCompletedGames();
  const odds = isScheduledFeedTime(new Date(scheduledTime))
    ? [await syncLeagueOdds("nfl"), await syncLeagueOdds("cfb")]
    : [];
  const failures = [...scores, ...odds].filter((item) => !item.ok && !item.skipped);
  const day = new Date(scheduledTime).toISOString().slice(0, 10);
  await Promise.all(failures.map((item) => alertCommissionerOnce(`automation:${day}:${item.league}:${item.reason}`, `Gridiron Ledger automation issue: ${item.league.toUpperCase()}`, `The scheduled ${item.league.toUpperCase()} feed did not finish.\n\n${item.reason ?? "No reason was returned."}\n\nOpen the Commissioner dashboard to review the feed status.`)));
  return [...scores, settlement, ...odds];
}
