import { env } from "cloudflare:workers";
import { PortalHeader } from "../components/PortalHeader";
import { requirePortalMember } from "../lib/portal-auth";

export const dynamic = "force-dynamic";

type ActionLeg = {
  wagerId: number;
  displayName: string;
  betType: string;
  stake: number;
  ticketStatus: string;
  payout: number | null;
  placedAt: string;
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
  totalLegs: number;
};

function price(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export default async function LeagueActionPage() {
  const { member } = await requirePortalMember("/action");
  const result = member.status === "approved"
    ? await env.DB.prepare(`
      SELECT
        w.id AS wagerId,m.display_name AS displayName,w.bet_type AS betType,
        w.stake,w.status AS ticketStatus,w.payout,w.placed_at AS placedAt,
        wl.selection,wl.market,wl.locked_line AS lockedLine,
        wl.locked_price AS lockedPrice,wl.teased_line AS teasedLine,wl.result,
        g.away_team AS awayTeam,g.home_team AS homeTeam,g.kickoff_at AS kickoffAt,
        g.status AS gameStatus,g.away_score AS awayScore,g.home_score AS homeScore,
        (SELECT COUNT(*) FROM wager_legs count_legs WHERE count_legs.wager_id=w.id) AS totalLegs
      FROM wager_legs wl
      JOIN wagers w ON w.id=wl.wager_id
      JOIN members m ON m.email=w.player_key
      JOIN games g ON g.id=wl.game_id
      WHERE m.status='approved'
        AND datetime(g.kickoff_at)<=datetime('now')
      ORDER BY w.placed_at DESC,wl.id
      LIMIT 500
    `).all<ActionLeg>()
    : { results: [] as ActionLeg[] };

  const tickets = new Map<number, ActionLeg[]>();
  for (const leg of result.results as ActionLeg[]) {
    tickets.set(leg.wagerId, [...(tickets.get(leg.wagerId) ?? []), leg]);
  }

  return <main>
    <PortalHeader admin={member.role === "commissioner"} />
    <section className="portal-hero shell">
      <div><p className="eyebrow">LEAGUE ACTION</p><h1>Open tickets</h1><p>Each pick appears here when its game kicks off. Later legs stay hidden until their own start time.</p></div>
    </section>
    <section className="content-band">
      <div className="shell action-feed">
        {member.status !== "approved" ? <div className="portal-notice"><strong>Commissioner approval is required.</strong><span>League tickets become available after your entry is approved.</span></div> : null}
        {tickets.size ? [...tickets.entries()].map(([wagerId, ticketLegs]) => {
          const first = ticketLegs[0]!;
          const hidden = Number(first.totalLegs) - ticketLegs.length;
          return <article className="action-ticket" key={wagerId}>
            <header>
              <div><span>{first.displayName}</span><strong>#{String(wagerId).padStart(5, "0")} · {first.betType}</strong></div>
              <div><span>{Number(first.stake).toLocaleString()} Points</span><b className={`ticket-status ticket-${first.ticketStatus}`}>{first.ticketStatus}</b></div>
            </header>
            <div className="action-legs">
              {ticketLegs.map((leg, index) => <div key={`${wagerId}-${index}`}>
                <span>{leg.market} · {leg.result}</span>
                <strong>{leg.selection}{leg.teasedLine != null ? ` ${leg.teasedLine > 0 ? "+" : ""}${leg.teasedLine}` : leg.lockedLine != null ? ` ${leg.lockedLine > 0 ? "+" : ""}${leg.lockedLine}` : ""}</strong>
                <small>{leg.awayTeam} at {leg.homeTeam} · {price(Number(leg.lockedPrice))}{leg.gameStatus === "completed" ? ` · ${leg.awayScore}-${leg.homeScore}` : ""}</small>
              </div>)}
              {hidden > 0 && <div className="hidden-legs"><span>{hidden} {hidden === 1 ? "pick" : "picks"} still hidden</span><small>Reveals at kickoff</small></div>}
            </div>
          </article>;
        }) : member.status === "approved" ? <div className="empty-action"><strong>No picks have kicked off yet.</strong><span>Tickets will appear here as games begin.</span></div> : null}
      </div>
    </section>
  </main>;
}
