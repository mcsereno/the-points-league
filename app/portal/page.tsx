import Link from "next/link";
import { env } from "cloudflare:workers";
import { PortalHeader } from "../components/PortalHeader";
import { leagueWeekWindow } from "../lib/league-config";
import { getLeagueSettings } from "../lib/league-settings";
import { requirePortalMember } from "../lib/portal-auth";
import { canMemberRebuy, memberRequirementApplies } from "../lib/season-lifecycle";
import { RebuyButton } from "./RebuyButton";

export const dynamic = "force-dynamic";

type WagerRow = {
  id: number;
  betType: string;
  stake: number;
  combinedOdds: number | null;
  status: string;
  payout: number | null;
  gradingReason: string | null;
  placedAt: string;
  settledAt: string | null;
};

type LegRow = {
  wagerId: number;
  selection: string;
  market: string;
  lockedLine: number | null;
  lockedPrice: number;
  teasedLine: number | null;
  result: string;
  awayTeam: string;
  homeTeam: string;
  kickoffAt: string;
  gameStatus: string;
  awayScore: number | null;
  homeScore: number | null;
};

function price(value: number | null) {
  if (value == null) return "—";
  return value > 0 ? `+${value}` : String(value);
}

function points(value: number) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default async function PortalPage() {
  const { member } = await requirePortalMember("/portal");
  const settings = await getLeagueSettings();
  const week = leagueWeekWindow();
  const [wagers, legs, action, weekly, rebuyAvailable] = await Promise.all([
    env.DB.prepare(`
      SELECT
        id,bet_type AS betType,stake,combined_odds AS combinedOdds,status,payout,
        grading_reason AS gradingReason,placed_at AS placedAt,settled_at AS settledAt
      FROM wagers
      WHERE player_key=?
      ORDER BY placed_at DESC
      LIMIT 50
    `).bind(member.email).all<WagerRow>(),
    env.DB.prepare(`
      SELECT
        wl.wager_id AS wagerId,wl.selection,wl.market,wl.locked_line AS lockedLine,
        wl.locked_price AS lockedPrice,wl.teased_line AS teasedLine,wl.result,
        g.away_team AS awayTeam,g.home_team AS homeTeam,g.kickoff_at AS kickoffAt,
        g.status AS gameStatus,g.away_score AS awayScore,g.home_score AS homeScore
      FROM wager_legs wl
      JOIN wagers w ON w.id=wl.wager_id
      JOIN games g ON g.id=wl.game_id
      WHERE w.player_key=?
      ORDER BY wl.wager_id DESC,wl.id
    `).bind(member.email).all<LegRow>(),
    env.DB.prepare(`
      SELECT COUNT(*) AS pending,COALESCE(SUM(stake),0) AS openStake
      FROM wagers
      WHERE player_key=? AND status='pending'
    `).bind(member.email).first<{ pending: number; openStake: number }>(),
    env.DB.prepare(`
      SELECT COALESCE(SUM(w.stake),0) AS wagered
      FROM wagers w
      WHERE w.player_key=?
        AND EXISTS (
          SELECT 1
          FROM wager_legs wl
          JOIN games g ON g.id=wl.game_id
          WHERE wl.wager_id=w.id
            AND datetime(g.kickoff_at)>=datetime(?)
            AND datetime(g.kickoff_at)<datetime(?)
        )
    `).bind(member.email, week.start.toISOString(), week.end.toISOString())
      .first<{ wagered: number }>(),
    canMemberRebuy(member),
  ]);

  const pending = Number(action?.pending ?? 0);
  const openStake = Number(action?.openStake ?? 0);
  const equity = Number(member.balance) + openStake;
  const net = equity - Number(member.startingBalance);
  const weeklyWagered = Number(weekly?.wagered ?? 0);
  const requirementApplies = member.status === "approved" && memberRequirementApplies(member.createdAt, week);
  const weeklyRemaining = Math.max(0, Math.min(
    settings.weeklyMinimumPoints,
    settings.weeklyMinimumPoints - weeklyWagered,
  ));
  const progress = Math.min(100, weeklyWagered / settings.weeklyMinimumPoints * 100);
  const legsByWager = new Map<number, LegRow[]>();
  for (const leg of legs.results as LegRow[]) {
    legsByWager.set(leg.wagerId, [...(legsByWager.get(leg.wagerId) ?? []), leg]);
  }

  return <main>
    <PortalHeader admin={member.role === "commissioner"} />
    <section className="portal-hero shell">
      <div><p className="eyebrow">MEMBER PORTAL</p><h1>{member.displayName}</h1><p>Your current balance and weekly requirement are below, followed by your full ticket history.</p></div>
      <span className={`member-status status-${member.status}`}>{member.status}</span>
    </section>
    <section className="content-band">
      <div className="shell">
        {member.status === "pending" && <div className="portal-notice"><strong>Your account is waiting for approval.</strong><span>You can view the board, but wagering stays closed until a commissioner approves your account.</span></div>}
        {member.status === "suspended" && <div className="portal-notice"><strong>Your entry is suspended.</strong><span>Wagering is closed. This week’s minimum is exempt while the suspension is in effect.</span></div>}
        {member.status === "eliminated" && <div className="portal-notice"><strong>Your season is complete.</strong><span>The rebuy window has closed. Your entry remains in the final standings.</span></div>}
        <div className="portal-stats">
          <article><span>AVAILABLE</span><strong>{points(Number(member.balance))}</strong><small>POINTS</small></article>
          <article><span>SEASON NET</span><strong>{net >= 0 ? "+" : ""}{points(net)}</strong><small>POINTS</small></article>
          <article><span>OPEN ACTION</span><strong>{pending}</strong><small>WAGERS</small></article>
          <article><span>TOTAL EQUITY</span><strong>{points(equity)}</strong><small>AVAILABLE + OPEN</small></article>
        </div>
        <section className="weekly-progress" aria-label="Weekly wagering requirement">
          <div>
            <span>THIS WEEK</span>
            <strong>{requirementApplies ? `${points(weeklyWagered)} of ${points(settings.weeklyMinimumPoints)} Points wagered` : "Requirement begins next league week"}</strong>
            <small>{requirementApplies ? weeklyRemaining > 0 ? `${points(weeklyRemaining)} Points remaining` : "Requirement met" : "Entries created this week are exempt until the following Tuesday."}</small>
          </div>
          <div className="progress-track" aria-hidden="true"><i style={{ width: `${requirementApplies ? progress : 0}%` }} /></div>
        </section>
        {rebuyAvailable && <div className="portal-notice rebuy-notice"><strong>Your balance is at zero.</strong><span>Rebuys are available until the first CFB Week 8 kickoff and restore the configured starting points.</span><RebuyButton /></div>}
        <div className="portal-section-heading"><div><p className="eyebrow">YOUR LEDGER</p><h2>Wager history</h2></div>{member.status === "approved" && <Link className="button button-primary" href="/#board">Build a wager <span>↗</span></Link>}</div>
        <div className="portal-table-wrap">
          <table className="portal-table"><thead><tr><th>Ticket</th><th>Type</th><th>Placed</th><th>Stake</th><th>Price</th><th>Status</th><th>Return</th></tr></thead>
            <tbody>{wagers.results.length ? (wagers.results as WagerRow[]).map((wager) => {
              const ticketLegs = legsByWager.get(wager.id) ?? [];
              return <tr key={wager.id}>
                <td>
                  <details className="ticket-details">
                    <summary>#{String(wager.id).padStart(5, "0")}</summary>
                    <div>
                      {ticketLegs.map((leg, index) => <article key={`${wager.id}-${index}`}>
                        <span>{leg.market} · {leg.result}</span>
                        <strong>{leg.selection}{leg.teasedLine != null ? ` ${leg.teasedLine > 0 ? "+" : ""}${leg.teasedLine}` : leg.lockedLine != null ? ` ${leg.lockedLine > 0 ? "+" : ""}${leg.lockedLine}` : ""}</strong>
                        <small>{leg.awayTeam} at {leg.homeTeam} · {price(leg.lockedPrice)}{leg.gameStatus === "completed" ? ` · ${leg.awayScore}-${leg.homeScore}` : ""}</small>
                      </article>)}
                      {wager.gradingReason && <p>{wager.gradingReason}</p>}
                    </div>
                  </details>
                </td>
                <td>{wager.betType}</td>
                <td>{new Date(wager.placedAt).toLocaleDateString()}</td>
                <td>{points(Number(wager.stake))}</td>
                <td>{price(wager.combinedOdds)}</td>
                <td><span className={`ticket-status ticket-${wager.status}`}>{wager.status}</span></td>
                <td>{wager.payout == null ? "—" : points(Number(wager.payout))}</td>
              </tr>;
            }) : <tr><td colSpan={7}><div className="empty-ledger"><strong>No wagers yet.</strong><span>Open and settled tickets will appear here.</span></div></td></tr>}</tbody>
          </table>
        </div>
      </div>
    </section>
  </main>;
}
