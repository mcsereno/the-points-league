import { env } from "cloudflare:workers";
import type { LeagueSettings } from "./league-config";
import { getLeagueSettings } from "./league-settings";
import { gradeLeg, gradeTicket, type TicketLeg } from "./grading";

type League = "nfl" | "cfb";
type PendingLeg = { id: number; wagerId: number; market: "spread" | "moneyline" | "total"; side: string; lockedLine: number | null; teasedLine: number | null; awayScore: number; homeScore: number };
type PendingTicket = { id: number; playerKey: string; betType: "single" | "parlay" | "teaser"; stake: number };
type ScoreGame = { id: string; awayTeam: string; homeTeam: string; kickoffAt: string };
type EspnCompetitor = { homeAway?: "home" | "away"; score?: string; team?: { displayName?: string; shortDisplayName?: string; location?: string } };
type EspnEvent = { status?: { type?: { completed?: boolean; name?: string } }; competitions?: Array<{ competitors?: EspnCompetitor[] }> };
type EspnScoreboard = { events?: EspnEvent[] };

async function settleTicket(wagerId: number, settings: LeagueSettings) {
  const ticket = await env.DB.prepare(`SELECT id,player_key AS playerKey,bet_type AS betType,stake FROM wagers WHERE id=? AND status='pending'`).bind(wagerId).first<PendingTicket>();
  if (!ticket) return false;
  const legs = await env.DB.prepare(`SELECT result,locked_price AS lockedPrice FROM wager_legs WHERE wager_id=? ORDER BY id`).bind(wagerId).all<TicketLeg>();
  const grade = gradeTicket(ticket, legs.results as TicketLeg[], settings);
  if (!grade) return false;
  const reference = `wager:${wagerId}:settlement`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE members SET balance=ROUND(balance+?,2),updated_at=CURRENT_TIMESTAMP WHERE email=? AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE reference=?)`).bind(grade.payout, ticket.playerKey, reference),
    env.DB.prepare(`INSERT OR IGNORE INTO ledger_entries (member_email,entry_type,amount,reference,note) VALUES (?,'wager_settlement',?,?,?)`).bind(ticket.playerKey, grade.payout, reference, grade.reason),
    env.DB.prepare(`UPDATE wagers SET status=?,payout=?,grading_reason=?,settled_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`).bind(grade.status, grade.payout, grade.reason, wagerId),
  ]);
  return true;
}

export async function settleCompletedGames() {
  const settings = await getLeagueSettings();
  const legs = await env.DB.prepare(`
    SELECT wl.id,wl.wager_id AS wagerId,wl.market,o.side,wl.locked_line AS lockedLine,wl.teased_line AS teasedLine,g.away_score AS awayScore,g.home_score AS homeScore
    FROM wager_legs wl
    JOIN wagers w ON w.id=wl.wager_id
    JOIN outcomes o ON o.id=wl.outcome_id
    JOIN games g ON g.id=wl.game_id
    WHERE w.status='pending' AND wl.result='pending' AND g.status='completed' AND g.away_score IS NOT NULL AND g.home_score IS NOT NULL
  `).all<PendingLeg>();
  const touched = new Set<number>();
  for (const leg of legs.results as PendingLeg[]) {
    const result = gradeLeg(leg);
    await env.DB.prepare("UPDATE wager_legs SET result=? WHERE id=? AND result='pending'").bind(result, leg.id).run();
    touched.add(Number(leg.wagerId));
  }
  let settled = 0;
  for (const wagerId of touched) if (await settleTicket(wagerId, settings)) settled += 1;
  return { gradedLegs: legs.results.length, settledWagers: settled };
}

function centralDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}`;
}

function normalizeTeam(value: string) {
  return value.toLowerCase().replace(/\bst\.?\b/g, "state").replace(/[^a-z0-9]+/g, " ").trim();
}

function sameTeam(expected: string, competitor: EspnCompetitor | undefined) {
  const target = normalizeTeam(expected);
  const candidates = [competitor?.team?.displayName, competitor?.team?.shortDisplayName, competitor?.team?.location]
    .filter((value): value is string => Boolean(value))
    .map(normalizeTeam);
  return candidates.some((candidate) => candidate === target || (candidate.length >= 5 && (candidate.startsWith(target) || target.startsWith(candidate))));
}

function matchingScore(game: ScoreGame, events: EspnEvent[]) {
  return events.find((event) => {
    const competitors = event.competitions?.[0]?.competitors ?? [];
    return sameTeam(game.awayTeam, competitors.find((item) => item.homeAway === "away"))
      && sameTeam(game.homeTeam, competitors.find((item) => item.homeAway === "home"));
  });
}

export async function syncLeagueScores(league: League) {
  const games = await env.DB.prepare(`
    SELECT id,away_team AS awayTeam,home_team AS homeTeam,kickoff_at AS kickoffAt
    FROM games
    WHERE league=? AND status!='completed'
      AND datetime(kickoff_at)>=datetime('now','-3 days')
      AND datetime(kickoff_at)<=datetime('now','+1 day')
  `).bind(league).all<ScoreGame>();
  if (!games.results.length) return { league, ok: true, skipped: true, reason: "No unsettled games need scores.", gamesUpdated: 0 };

  const byDate = new Map<string, ScoreGame[]>();
  for (const game of games.results) {
    const date = centralDateKey(new Date(game.kickoffAt));
    byDate.set(date, [...(byDate.get(date) ?? []), game]);
  }
  const sport = league === "nfl" ? "nfl" : "college-football";
  let updated = 0;
  for (const [date, dateGames] of byDate) {
    const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/football/${sport}/scoreboard`);
    url.searchParams.set("dates", date);
    url.searchParams.set("limit", "1000");
    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: "application/json" } });
    } catch {
      return { league, ok: false, skipped: false, reason: "Score service unavailable." };
    }
    if (!response.ok) return { league, ok: false, skipped: false, reason: `Score request failed (${response.status}).` };
    const board = await response.json() as EspnScoreboard;
    for (const game of dateGames) {
      const event = matchingScore(game, board.events ?? []);
      const competitors = event?.competitions?.[0]?.competitors ?? [];
      const away = competitors.find((item) => item.homeAway === "away");
      const home = competitors.find((item) => item.homeAway === "home");
      const awayScore = Number(away?.score);
      const homeScore = Number(home?.score);
      const completed = Boolean(event?.status?.type?.completed) || event?.status?.type?.name === "STATUS_FINAL";
      const status = completed ? "completed" : Number.isFinite(awayScore) && Number.isFinite(homeScore) ? "live" : "scheduled";
      if (!event) continue;
      const result = await env.DB.prepare("UPDATE games SET status=?,home_score=?,away_score=? WHERE id=?")
        .bind(status, Number.isFinite(homeScore) ? homeScore : null, Number.isFinite(awayScore) ? awayScore : null, game.id).run();
      if (Number(result.meta.changes ?? 0) > 0) updated += 1;
    }
  }
  return { league, ok: true, skipped: false, reason: null, gamesUpdated: updated };
}
