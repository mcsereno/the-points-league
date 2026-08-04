import { env } from "cloudflare:workers";
import { getSessionMember } from "../../lib/auth";
import { leagueWeekWindow } from "../../lib/league-config";
import { getLeagueSettings } from "../../lib/league-settings";
import { isSameOrigin } from "../../lib/portal-auth";
import { requestIdOrNew } from "../../lib/request-id";

type BetType = "single" | "parlay" | "teaser";
type WagerRequest = {
  betType?: BetType;
  stake?: number;
  teaserPoints?: number;
  requestId?: string;
  legs?: Array<{ outcomeId?: string }>;
};
type Outcome = {
  id: string;
  gameId: string;
  market: "spread" | "moneyline" | "total";
  side: string;
  label: string;
  line: number | null;
  price: number;
  league: "nfl" | "cfb";
  kickoffAt: string;
  gameStatus: string;
  capturedAt: string;
};

function combinedAmericanOdds(prices: number[]) {
  const decimal = prices.reduce(
    (product, price) => product * (price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price)),
    1,
  );
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

function teasedLine(outcome: Outcome, points: number) {
  if (outcome.line == null) return null;
  if (outcome.market === "spread") return outcome.line + points;
  if (outcome.market === "total") return outcome.side === "over" ? outcome.line - points : outcome.line + points;
  return null;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const member = await getSessionMember();
  if (!member) return Response.json({ error: "Sign in to place a wager." }, { status: 401 });
  if (member.status !== "approved") {
    return Response.json({ error: "Commissioner approval is required before wagering." }, { status: 403 });
  }

  const body = await request.json() as WagerRequest;
  const settings = await getLeagueSettings();
  const betType = body.betType;
  const stake = Number(body.stake);
  const legs = Array.isArray(body.legs) ? body.legs : [];
  const requestId = requestIdOrNew(body.requestId);
  if (!betType || !["single", "parlay", "teaser"].includes(betType)) {
    return Response.json({ error: "Choose a valid wager type." }, { status: 400 });
  }
  const stakeScale = 10 ** settings.wagerDecimals;
  if (!Number.isFinite(stake) || stake <= 0 || Math.abs(stake * stakeScale - Math.round(stake * stakeScale)) > 0.000001) {
    return Response.json({ error: `Enter a positive wager using no more than ${settings.wagerDecimals} decimal places.` }, { status: 400 });
  }
  const minimumLegs = betType === "parlay" ? settings.parlayMinLegs : settings.teaserMinLegs;
  const maximumLegs = betType === "parlay" ? settings.parlayMaxLegs : settings.teaserMaxLegs;
  if ((betType === "single" && legs.length !== 1) || (betType !== "single" && (legs.length < minimumLegs || legs.length > maximumLegs))) {
    return Response.json({ error: betType === "single" ? "A straight wager needs one selection." : `${betType === "parlay" ? "Parlays" : "Teasers"} need ${minimumLegs}–${maximumLegs} selections.` }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT id,player_key AS playerKey,bet_type AS betType,stake,combined_odds AS combinedOdds,status,placed_at AS placedAt FROM wagers WHERE external_id=?")
    .bind(requestId).first<Record<string, unknown>>();
  if (existing) {
    if (existing.playerKey !== member.email) return Response.json({ error: "That wager request ID is already in use." }, { status: 409 });
    const currentBalance = await env.DB.prepare("SELECT balance FROM members WHERE email=?").bind(member.email).first<{ balance: number }>();
    return Response.json({ ok: true, wager: existing, balance: Number(currentBalance?.balance ?? member.balance), duplicate: true });
  }

  const outcomeIds = legs.map((leg) => leg.outcomeId).filter((id): id is string => Boolean(id));
  if (outcomeIds.length !== legs.length || new Set(outcomeIds).size !== outcomeIds.length) {
    return Response.json({ error: "Every wager leg must be unique." }, { status: 400 });
  }

  const outcomeResults = await env.DB.batch<Outcome>(
    outcomeIds.map((id) => env.DB.prepare(`
      SELECT
        o.id,
        o.game_id AS gameId,
        o.market,
        o.side,
        o.label,
        o.line,
        o.price,
        o.captured_at AS capturedAt,
        g.league,
        g.kickoff_at AS kickoffAt,
        g.status AS gameStatus
      FROM outcomes o
      JOIN games g ON g.id=o.game_id
      WHERE o.id=?
    `).bind(id)),
  );
  const outcomes = (outcomeResults as Array<{ results: Outcome[] }>)
    .map((result) => result.results[0])
    .filter((outcome): outcome is Outcome => Boolean(outcome));
  if (outcomes.length !== outcomeIds.length) {
    return Response.json({ error: "One or more selections are no longer available." }, { status: 409 });
  }
  if (!settings.sameGameCombinations && new Set(outcomes.map((outcome) => outcome.gameId)).size !== outcomes.length) {
    return Response.json({ error: "Only one selection per game is allowed on a ticket." }, { status: 400 });
  }
  const now = Date.now();
  const week = leagueWeekWindow();
  if (outcomes.some((outcome) => outcome.gameStatus !== "scheduled"
    || new Date(outcome.kickoffAt).getTime() <= now
    || new Date(outcome.kickoffAt) < week.start
    || new Date(outcome.kickoffAt) >= week.end)) {
    return Response.json({ error: "A selected game has already started or closed." }, { status: 409 });
  }
  if (outcomes.some((outcome) => now - new Date(outcome.capturedAt).getTime() > settings.oddsStaleHours * 60 * 60 * 1000)) {
    return Response.json({ error: "A selected market is waiting for fresh odds." }, { status: 409 });
  }
  if (!settings.crossLeagueTickets && new Set(outcomes.map((outcome) => outcome.league)).size > 1) {
    return Response.json({ error: "This season does not allow NFL and CFB selections on one ticket." }, { status: 400 });
  }
  if (betType === "teaser" && outcomes.some((outcome) => outcome.market === "moneyline")) {
    return Response.json({ error: "Moneylines cannot be included in a teaser." }, { status: 400 });
  }

  const teaserPoints = betType === "teaser" ? Number(body.teaserPoints) : null;
  if (betType === "teaser" && teaserPoints !== settings.teaserPoints) {
    return Response.json({ error: `Only ${settings.teaserPoints}-point teasers are available.` }, { status: 400 });
  }
  const combinedOdds = betType === "single"
    ? outcomes[0]!.price
    : betType === "parlay"
      ? combinedAmericanOdds(outcomes.map((outcome) => outcome.price))
      : settings.teaserPrices[String(outcomes.length)]!;
  const externalId = requestId;

  const statements = [
    env.DB.prepare(`
      INSERT INTO wagers (external_id,player_key,bet_type,stake,combined_odds,teaser_points)
      SELECT ?,?,?,?,?,?
      WHERE EXISTS (
        SELECT 1 FROM members
        WHERE email=? AND status='approved' AND balance>=?
      )
    `).bind(externalId, member.email, betType, stake, combinedOdds, teaserPoints, member.email, stake),
    ...outcomes.map((outcome) => env.DB.prepare(`
      INSERT INTO wager_legs (
        wager_id,game_id,outcome_id,market,locked_side,selection,locked_line,locked_price,teased_line
      )
      SELECT id,?,?,?,?,?,?,?,?
      FROM wagers
      WHERE external_id=?
    `).bind(
      outcome.gameId,
      outcome.id,
      outcome.market,
      outcome.side,
      outcome.label,
      outcome.line,
      outcome.price,
      betType === "teaser" ? teasedLine(outcome, teaserPoints as number) : null,
      externalId,
    )),
    env.DB.prepare(`
      UPDATE members
      SET balance=balance-?,updated_at=CURRENT_TIMESTAMP
      WHERE email=? AND balance>=?
        AND EXISTS (SELECT 1 FROM wagers WHERE external_id=?)
    `).bind(stake, member.email, stake, externalId),
    env.DB.prepare(`
      INSERT OR IGNORE INTO ledger_entries (member_email,entry_type,amount,reference,note)
      SELECT player_key,'wager_stake',-stake,'wager:' || id || ':stake','Ticket #' || id || ' stake'
      FROM wagers
      WHERE external_id=?
    `).bind(externalId),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT id,player_key AS playerKey,bet_type AS betType,stake,combined_odds AS combinedOdds,status,placed_at AS placedAt FROM wagers WHERE external_id=?")
      .bind(externalId).first<Record<string, unknown>>();
    if (duplicate?.playerKey === member.email) {
      const currentBalance = await env.DB.prepare("SELECT balance FROM members WHERE email=?").bind(member.email).first<{ balance: number }>();
      return Response.json({ ok: true, wager: duplicate, balance: Number(currentBalance?.balance ?? member.balance), duplicate: true });
    }
    throw error;
  }

  const wager = await env.DB.prepare(`
    SELECT id,bet_type AS betType,stake,combined_odds AS combinedOdds,status,placed_at AS placedAt
    FROM wagers WHERE external_id=?
  `).bind(externalId).first<Record<string, unknown>>();
  if (!wager) {
    return Response.json({ error: "Your available balance is too low for this wager." }, { status: 409 });
  }
  const updated = await env.DB.prepare("SELECT balance FROM members WHERE email=?").bind(member.email).first<{ balance: number }>();
  return Response.json({ ok: true, wager, balance: Number(updated?.balance ?? member.balance - stake) });
}
