import { env } from "cloudflare:workers";
import type { LeagueSettings } from "./league-config";
import { getLeagueSettings } from "./league-settings";
import { gradeLeg, gradeTicket, type TicketLeg } from "./grading";

type PendingLeg = {
  id: number;
  wagerId: number;
  market: "spread" | "moneyline" | "total";
  side: string;
  lockedLine: number | null;
  teasedLine: number | null;
  awayScore: number;
  homeScore: number;
};

type PendingTicket = {
  id: number;
  playerKey: string;
  betType: "single" | "parlay" | "teaser";
  stake: number;
};

type ScoreEvent = {
  id: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
};

async function settleTicket(wagerId: number, settings: LeagueSettings) {
  const ticket = await env.DB.prepare(`
    SELECT id,player_key AS playerKey,bet_type AS betType,stake
    FROM wagers
    WHERE id=? AND status='pending'
  `).bind(wagerId).first<PendingTicket>();
  if (!ticket) return false;

  const legs = await env.DB.prepare(`
    SELECT result,locked_price AS lockedPrice
    FROM wager_legs
    WHERE wager_id=?
    ORDER BY id
  `).bind(wagerId).all<TicketLeg>();
  const grade = gradeTicket(ticket, legs.results as TicketLeg[], settings);
  if (!grade) return false;

  const reference = `wager:${wagerId}:settlement`;
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE members
      SET balance=ROUND(balance+?,2),updated_at=CURRENT_TIMESTAMP
      WHERE email=?
        AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE reference=?)
    `).bind(grade.payout, ticket.playerKey, reference),
    env.DB.prepare(`
      INSERT OR IGNORE INTO ledger_entries (member_email,entry_type,amount,reference,note)
      VALUES (?,'wager_settlement',?,?,?)
    `).bind(ticket.playerKey, grade.payout, reference, grade.reason),
    env.DB.prepare(`
      UPDATE wagers
      SET status=?,payout=?,grading_reason=?,settled_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending'
    `).bind(grade.status, grade.payout, grade.reason, wagerId),
  ]);
  return true;
}
export async function settleCompletedGames() {
  const settings = await getLeagueSettings();
  const legs = await env.DB.prepare(`
    SELECT
      wl.id,
      wl.wager_id AS wagerId,
      wl.market,
      o.side,
      wl.locked_line AS lockedLine,
      wl.teased_line AS teasedLine,
      g.away_score AS awayScore,
      g.home_score AS homeScore
    FROM wager_legs wl
    JOIN wagers w ON w.id=wl.wager_id
    JOIN outcomes o ON o.id=wl.outcome_id
    JOIN games g ON g.id=wl.game_id
    WHERE w.status='pending'
      AND wl.result='pending'
      AND g.status='completed'
      AND g.away_score IS NOT NULL
      AND g.home_score IS NOT NULL
  `).all<PendingLeg>();

  const touched = new Set<number>();
  for (const leg of legs.results as PendingLeg[]) {
    const result = gradeLeg(leg);
    await env.DB.prepare("UPDATE wager_legs SET result=? WHERE id=? AND result='pending'")
      .bind(result, leg.id).run();
    touched.add(Number(leg.wagerId));
  }

  let settled = 0;
  for (const wagerId of touched) {
    if (await settleTicket(wagerId, settings)) settled += 1;
  }
  return { gradedLegs: legs.results.length, settledWagers: settled };
}

export async function syncLeagueScores(league: "nfl" | "cfb") {
  const apiKey = (env as unknown as Record<string, string | undefined>).ODDS_API_KEY;
  if (!apiKey) return { league, ok: false, skipped: true, reason: "ODDS_API_KEY is not configured." };

  const sport = league === "nfl" ? "americanfootball_nfl" : "americanfootball_ncaaf";
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/scores/`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("daysFrom", "3");

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    return { league, ok: false, skipped: false, reason: "Score service unavailable." };
  }
  if (!response.ok) {
    return { league, ok: false, skipped: false, reason: `Score request failed (${response.status}).` };
  }

  const events = await response.json() as ScoreEvent[];
  let updated = 0;
  for (const event of events) {
    const homeScore = event.scores?.find((score) => score.name === event.home_team)?.score;
    const awayScore = event.scores?.find((score) => score.name === event.away_team)?.score;
    const status = event.completed ? "completed" : event.scores?.length ? "live" : "scheduled";
    const result = await env.DB.prepare(`
      UPDATE games
      SET status=?,home_score=?,away_score=?
      WHERE id=?
    `).bind(
      status,
      homeScore == null ? null : Number(homeScore),
      awayScore == null ? null : Number(awayScore),
      event.id,
    ).run();
    if (Number(result.meta.changes ?? 0) > 0) updated += 1;
  }

  return { league, ok: true, skipped: false, reason: null, gamesUpdated: updated };
}
