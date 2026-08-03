import { env } from "cloudflare:workers";
import { getSessionMember, loginPath } from "../../lib/auth";

type Standing = {
  id: number;
  displayName: string;
  balance: number;
  startingBalance: number;
  openStake: number;
  equity: number;
  rebuyCount: number;
  wins: number;
  losses: number;
};

async function getStandings() {
  const rows = await env.DB.prepare(`
    SELECT
      m.id,
      m.display_name AS displayName,
      m.balance,
      m.starting_balance AS startingBalance,
      m.rebuy_count AS rebuyCount,
      COALESCE(SUM(CASE WHEN w.status='pending' THEN w.stake ELSE 0 END), 0) AS openStake,
      m.balance + COALESCE(SUM(CASE WHEN w.status='pending' THEN w.stake ELSE 0 END), 0) AS equity,
      COALESCE(SUM(CASE WHEN w.status='won' THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN w.status='lost' THEN 1 ELSE 0 END), 0) AS losses
    FROM members m
    LEFT JOIN wagers w ON w.player_key=m.email
    WHERE m.status IN ('approved','eliminated')
    GROUP BY m.id,m.display_name,m.balance,m.starting_balance,m.rebuy_count
    ORDER BY equity DESC,m.rebuy_count ASC,m.display_name ASC
  `).all<Standing>();

  return (rows.results as Standing[]).map((row, index) => ({
    memberId: row.id,
    rank: index + 1,
    displayName: row.displayName,
    balance: Number(row.balance),
    openStake: Number(row.openStake),
    equity: Number(row.equity),
    net: Number(row.equity) - Number(row.startingBalance),
    rebuyCount: Number(row.rebuyCount),
    wins: Number(row.wins),
    losses: Number(row.losses),
  }));
}

export async function GET() {
  const [member, standings] = await Promise.all([getSessionMember(), getStandings()]);
  if (!member) {
    return Response.json({
      authenticated: false,
      signInPath: loginPath("/"),
      standings,
    });
  }

  const rank = standings.findIndex((row) => row.memberId === member.id) + 1;
  const standing = standings.find((row) => row.memberId === member.id);
  const approved = member.status === "approved" || member.status === "eliminated";
  return Response.json({
    authenticated: true,
    member: approved ? {
      displayName: member.displayName,
      status: member.status,
      role: member.role,
      balance: Number(member.balance),
      equity: Number(standing?.equity ?? member.balance),
      openStake: Number(standing?.openStake ?? 0),
      startingBalance: Number(member.startingBalance),
      rebuyCount: Number(member.rebuyCount),
      rank: rank || null,
      seasonNet: Number(standing?.equity ?? member.balance) - Number(member.startingBalance),
      approvedMemberCount: standings.length,
    } : {
      displayName: member.displayName,
      status: member.status,
      role: member.role,
    },
    standings,
  });
}
