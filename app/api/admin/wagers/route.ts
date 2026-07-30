import { env } from "cloudflare:workers";
import { isSameOrigin, requireCommissioner } from "../../../lib/portal-auth";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const commissioner = await requireCommissioner();
  if (!commissioner) {
    return Response.json({ error: "Commissioner access required." }, { status: 403 });
  }

  const body = await request.json() as { wagerId?: number; reason?: string };
  const wagerId = Number(body.wagerId);
  const reason = String(body.reason ?? "").trim();
  if (!Number.isInteger(wagerId) || wagerId <= 0) {
    return Response.json({ error: "A valid ticket is required." }, { status: 400 });
  }
  if (reason.length < 8 || reason.length > 300) {
    return Response.json({ error: "Enter a reason between 8 and 300 characters." }, { status: 400 });
  }

  const wager = await env.DB.prepare(`
    SELECT id,player_key AS playerKey,stake,status,COALESCE(payout,0) AS payout
    FROM wagers
    WHERE id=?
  `).bind(wagerId).first<{
    id: number;
    playerKey: string;
    stake: number;
    status: string;
    payout: number;
  }>();
  if (!wager) return Response.json({ error: "Ticket not found." }, { status: 404 });
  if (wager.status === "void") return Response.json({ ok: true, duplicate: true });

  const adjustment = Number(wager.stake) - Number(wager.payout);
  const reference = `wager:${wagerId}:void`;
  const note = `${reason} Voided by ${commissioner.user.email.toLowerCase()}.`;
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE members
      SET balance=ROUND(balance+?,2),updated_at=CURRENT_TIMESTAMP
      WHERE email=?
        AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE reference=?)
    `).bind(adjustment, wager.playerKey, reference),
    env.DB.prepare(`
      INSERT OR IGNORE INTO ledger_entries (member_email,entry_type,amount,reference,note)
      VALUES (?,'wager_void',?,?,?)
    `).bind(wager.playerKey, adjustment, reference, note),
    env.DB.prepare("UPDATE wager_legs SET result='void' WHERE wager_id=?")
      .bind(wagerId),
    env.DB.prepare(`
      UPDATE wagers
      SET status='void',payout=stake,grading_reason=?,settled_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(note, wagerId),
  ]);

  return Response.json({ ok: true, status: "void", payout: Number(wager.stake) });
}
