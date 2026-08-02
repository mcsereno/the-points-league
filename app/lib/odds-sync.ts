import { env } from "cloudflare:workers";
import { getLeagueSettings } from "./league-settings";
import { settleCompletedGames, syncLeagueScores } from "./settlement";
import { alertCommissionerOnce } from "./operations";
import { dayOffset, getRundownEvents, type League, type RundownMarket } from "./rundown";

const PRIMARY_BOOK = "19";
const BACKUP_BOOK = "23";
const MARKET_MAP: Record<number, "moneyline" | "spread" | "total"> = { 1: "moneyline", 2: "spread", 3: "total" };

async function recordState(league: League, success: boolean, error: string | null) {
  await env.DB.prepare("INSERT INTO odds_sync_state (league,last_attempt_at,last_success_at,last_error,updated_at) VALUES (?,CURRENT_TIMESTAMP,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,?,CURRENT_TIMESTAMP) ON CONFLICT(league) DO UPDATE SET last_attempt_at=CURRENT_TIMESTAMP,last_success_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_success_at END,last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP")
    .bind(league, success ? 1 : 0, error, success ? 1 : 0).run();
}

function outcomeIdentity(eventId: string, market: string, name: string) {
  return `${eventId}:${market}:${name}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-");
}

function bookFor(market: RundownMarket) {
  const eligible = market.participants.filter((participant) => participant.lines.some((line) => {
    const primary = line.prices[PRIMARY_BOOK]?.price;
    return Number.isFinite(primary) && primary !== 0.0001;
  }));
  if (eligible.length === market.participants.length) return PRIMARY_BOOK;
  const backupEligible = market.participants.filter((participant) => participant.lines.some((line) => {
    const backup = line.prices[BACKUP_BOOK]?.price;
    return Number.isFinite(backup) && backup !== 0.0001;
  }));
  return backupEligible.length === market.participants.length ? BACKUP_BOOK : null;
}

export async function syncLeagueOdds(league: League, force = false) {
  const settings = await getLeagueSettings();
  const source = await getRundownEvents(league, Array.from({ length: 11 }, (_, index) => dayOffset(index)), true);
  if (!source.ok) {
    await recordState(league, false, source.reason);
    return source;
  }

  for (const event of source.events) {
    const away = event.teams.find((team) => team.is_away)?.name;
    const home = event.teams.find((team) => team.is_home)?.name;
    if (!away || !home) continue;
    await env.DB.prepare("INSERT INTO games (id,league,away_team,home_team,kickoff_at,status,odds_provider,odds_captured_at) VALUES (?,?,?,?,?,'scheduled',?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET away_team=excluded.away_team,home_team=excluded.home_team,kickoff_at=excluded.kickoff_at,odds_provider=excluded.odds_provider,odds_captured_at=CURRENT_TIMESTAMP")
      .bind(event.event_id, league, away, home, event.event_date, "DraftKings · FanDuel backup").run();

    for (const market of event.markets ?? []) {
      const marketName = MARKET_MAP[market.market_id];
      if (!marketName || market.period_id !== 0) continue;
      const bookmaker = bookFor(market);
      if (!bookmaker) {
        await env.DB.prepare("DELETE FROM outcomes WHERE game_id=? AND market=?").bind(event.event_id, marketName).run();
        continue;
      }
      const ids: string[] = [];
      for (const participant of market.participants) {
        const line = participant.lines.find((candidate) => {
          const price = candidate.prices[bookmaker]?.price;
          return Number.isFinite(price) && price !== 0.0001;
        });
        if (!line) continue;
        const side = marketName === "total" ? participant.name.toLowerCase() : participant.name === away ? "away" : "home";
        const id = outcomeIdentity(event.event_id, marketName, participant.name);
        ids.push(id);
        await env.DB.prepare("INSERT INTO outcomes (id,game_id,market,side,label,line,price,odds_provider,captured_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET label=excluded.label,line=excluded.line,price=excluded.price,odds_provider=excluded.odds_provider,captured_at=CURRENT_TIMESTAMP")
          .bind(id, event.event_id, marketName, side, participant.name, marketName === "moneyline" ? null : Number(line.value), line.prices[bookmaker]!.price, bookmaker === PRIMARY_BOOK ? "DraftKings" : "FanDuel").run();
      }
      if (ids.length === market.participants.length) {
        const placeholders = ids.map(() => "?").join(",");
        await env.DB.prepare(`DELETE FROM outcomes WHERE game_id=? AND market=? AND id NOT IN (${placeholders})`).bind(event.event_id, marketName, ...ids).run();
      }
    }
  }
  await recordState(league, true, null);
  return { league, ok: true, skipped: false, reason: null, games: source.events.length, force, sportsbook: settings.primarySportsbook };
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
  const odds = isScheduledFeedTime(new Date(scheduledTime)) ? await Promise.all([syncLeagueOdds("nfl"), syncLeagueOdds("cfb")]) : [];
  const failures = [...scores, ...odds].filter((item) => !item.ok && !item.skipped);
  const day = new Date(scheduledTime).toISOString().slice(0, 10);
  await Promise.all(failures.map((item) => alertCommissionerOnce(`automation:${day}:${item.league}:${item.reason}`, `Gridiron Ledger automation issue: ${item.league.toUpperCase()}`, `The scheduled ${item.league.toUpperCase()} feed did not finish.\n\n${item.reason ?? "No reason was returned."}\n\nOpen the Commissioner dashboard to review the feed status.`)));
  return [...scores, settlement, ...odds];
}
