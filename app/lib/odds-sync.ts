import { env } from "cloudflare:workers";
import { getLeagueSettings } from "./league-settings";
import { settleCompletedGames, syncLeagueScores } from "./settlement";
import { alertCommissionerOnce } from "./operations";

type ProviderOutcome = { name: string; description?: string; point?: number; price: number };
type ProviderMarket = { key: "h2h" | "spreads" | "totals"; outcomes: ProviderOutcome[] };
type ProviderEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: { key: string; title: string; markets: ProviderMarket[] }[];
};
type ProviderBookmaker = NonNullable<ProviderEvent["bookmakers"]>[number];

const QUOTA_RESERVE = 75;
const MINIMUM_INTERVAL_MINUTES = 15;

function quotaValue(value: string | null) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function recordState(league: "nfl" | "cfb", success: boolean, response: Response | null, error: string | null) {
  await env.DB.prepare("INSERT INTO odds_sync_state (league,last_attempt_at,last_success_at,credits_remaining,credits_used,last_error,updated_at) VALUES (?,CURRENT_TIMESTAMP,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(league) DO UPDATE SET last_attempt_at=CURRENT_TIMESTAMP,last_success_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_success_at END,credits_remaining=COALESCE(excluded.credits_remaining,credits_remaining),credits_used=COALESCE(excluded.credits_used,credits_used),last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP")
    .bind(league, success ? 1 : 0, quotaValue(response?.headers.get("x-requests-remaining") ?? null), quotaValue(response?.headers.get("x-requests-used") ?? null), error, success ? 1 : 0).run();
}

function outcomeIdentity(eventId: string, market: string, outcome: ProviderOutcome) {
  return `${eventId}:${market}:${outcome.name}:${outcome.description ?? ""}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-");
}

function validMarket(
  market: ProviderMarket | undefined,
  event: ProviderEvent,
) {
  if (!market) return false;
  if (market.key === "totals") {
    const sides = new Set(market.outcomes.map((outcome) => outcome.name.toLowerCase()));
    return sides.has("over") && sides.has("under");
  }
  const teams = new Set(market.outcomes.map((outcome) => outcome.name));
  return teams.has(event.away_team) && teams.has(event.home_team);
}

function selectMarket(
  event: ProviderEvent,
  key: ProviderMarket["key"],
  primary: ProviderBookmaker | undefined,
  backup: ProviderBookmaker | undefined,
) {
  const primaryMarket = primary?.markets.find((market) => market.key === key);
  if (validMarket(primaryMarket, event)) return { market: primaryMarket!, bookmaker: primary! };
  const backupMarket = backup?.markets.find((market) => market.key === key);
  if (validMarket(backupMarket, event)) return { market: backupMarket!, bookmaker: backup! };
  return null;
}

export async function syncLeagueOdds(league: "nfl" | "cfb", force = false) {
  const values = env as unknown as Record<string, string | undefined>;
  const apiKey = values.ODDS_API_KEY;
  const settings = await getLeagueSettings();
  const bookmakerKeys = [settings.primarySportsbook, settings.backupSportsbook];
  if (!apiKey) return { league, ok: false, skipped: true, reason: "ODDS_API_KEY is not configured." };

  const state = await env.DB.prepare("SELECT last_attempt_at AS lastAttemptAt,credits_remaining AS remaining FROM odds_sync_state WHERE league=?").bind(league).first<{ lastAttemptAt: string | null; remaining: number | null }>();
  if (!force && state?.remaining != null && state.remaining <= QUOTA_RESERVE) return { league, ok: true, skipped: true, reason: `Quota reserve active (${state.remaining} remaining).` };
  if (!force && state?.lastAttemptAt && Date.now() - new Date(state.lastAttemptAt).getTime() < MINIMUM_INTERVAL_MINUTES * 60_000) return { league, ok: true, skipped: true, reason: "A recent refresh already ran." };

  const sport = league === "nfl" ? "americanfootball_nfl" : "americanfootball_ncaaf";
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds/`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("bookmakers", bookmakerKeys.join(","));
  url.searchParams.set("markets", "h2h,spreads,totals");
  url.searchParams.set("oddsFormat", "american");

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    await recordState(league, false, null, "Odds service unavailable.");
    return { league, ok: false, skipped: false, reason: "Odds service unavailable." };
  }
  if (!response.ok) {
    const reason = `Odds request failed (${response.status}).`;
    await recordState(league, false, response, reason);
    return { league, ok: false, skipped: false, reason };
  }

  const events = await response.json() as ProviderEvent[];
  for (const event of events) {
    const primary = event.bookmakers?.find((item) => item.key === settings.primarySportsbook);
    const backup = event.bookmakers?.find((item) => item.key === settings.backupSportsbook);
    if (!primary && !backup) continue;
    await env.DB.prepare("INSERT INTO games (id,league,away_team,home_team,kickoff_at,status,odds_provider,odds_captured_at) VALUES (?,?,?,?,?,'scheduled',?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET away_team=excluded.away_team,home_team=excluded.home_team,kickoff_at=excluded.kickoff_at,odds_provider=excluded.odds_provider,odds_captured_at=CURRENT_TIMESTAMP")
      .bind(event.id, league, event.away_team, event.home_team, event.commence_time, "DraftKings · FanDuel backup").run();
    for (const marketKey of ["h2h", "spreads", "totals"] as ProviderMarket["key"][]) {
      const selected = selectMarket(event, marketKey, primary, backup);
      const marketName = marketKey === "h2h" ? "moneyline" : marketKey === "spreads" ? "spread" : "total";
      if (!selected) {
        await env.DB.prepare("DELETE FROM outcomes WHERE game_id=? AND market=?")
          .bind(event.id, marketName).run();
        continue;
      }
      const { market, bookmaker } = selected;
      const currentIds: string[] = [];
      for (const outcome of market.outcomes) {
        const side = market.key === "totals" ? outcome.name.toLowerCase() : outcome.name === event.away_team ? "away" : "home";
        const id = outcomeIdentity(event.id, marketName, outcome);
        currentIds.push(id);
        await env.DB.prepare("INSERT INTO outcomes (id,game_id,market,side,label,line,price,odds_provider,captured_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET label=excluded.label,line=excluded.line,price=excluded.price,odds_provider=excluded.odds_provider,captured_at=CURRENT_TIMESTAMP")
          .bind(id, event.id, marketName, side, outcome.name, outcome.point ?? null, outcome.price, bookmaker.title).run();
      }
      const placeholders = currentIds.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM outcomes WHERE game_id=? AND market=? AND id NOT IN (${placeholders})`)
        .bind(event.id, marketName, ...currentIds).run();
    }
  }
  await recordState(league, true, response, null);
  return { league, ok: true, skipped: false, reason: null, games: events.length };
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
  if (!isScheduledFeedTime(new Date(scheduledTime))) return [...scores, settlement];
  const odds = await Promise.all([syncLeagueOdds("nfl"), syncLeagueOdds("cfb")]);
  const failures=[...scores,...odds].filter((item)=>!item.ok&&!item.skipped);
  const day=new Date(scheduledTime).toISOString().slice(0,10);
  await Promise.all(failures.map((item)=>alertCommissionerOnce(`automation:${day}:${item.league}:${item.reason}`,`Points League automation issue: ${item.league.toUpperCase()}`,`The scheduled ${item.league.toUpperCase()} feed did not finish.\n\n${item.reason??"No reason was returned."}\n\nOpen the Commissioner dashboard to review the feed status.`)));
  return [...scores, settlement, ...odds];
}
