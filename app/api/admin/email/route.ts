import { env } from "cloudflare:workers";
import { sendEmail } from "../../../lib/email";
import { isSameOrigin, requireCommissioner } from "../../../lib/portal-auth";
import { recordAudit } from "../../../lib/audit";

type Recipient = {
  email: string;
};

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const commissioner=await requireCommissioner();if (!commissioner) return Response.json({ error: "Commissioner access required." }, { status: 403 });

  const body = await request.json() as { subject?: string; message?: string };
  const subject = body.subject?.trim() ?? "";
  const message = body.message?.trim() ?? "";
  if (!subject || subject.length > 140) {
    return Response.json({ error: "Enter a subject between 1 and 140 characters." }, { status: 400 });
  }
  if (!message || message.length > 10000) {
    return Response.json({ error: "Enter a message between 1 and 10,000 characters." }, { status: 400 });
  }

  const recipients = await env.DB.prepare(`
    SELECT email
    FROM members
    WHERE status='approved'
    ORDER BY email
  `).all<Recipient>();
  if (!recipients.results.length) {
    return Response.json({ error: "There are no approved players to email." }, { status: 400 });
  }

  let sent = 0;
  const failed: string[] = [];
  for (const recipient of recipients.results) {
    const result = await sendEmail({
      to: recipient.email,
      subject,
      text: `${message}

Gridiron Ledger`,
    });
    if (result.sent) sent += 1;
    else failed.push(recipient.email);
  }

  await recordAudit("league_email_sent","league","approved-members",commissioner.member.email,{subject,recipients:recipients.results.length,sent,failed:failed.length});
  return Response.json({
    ok: failed.length === 0,
    sent,
    failed: failed.length,
    total: recipients.results.length,
    error: failed.length ? `${failed.length} message${failed.length === 1 ? "" : "s"} could not be sent.` : undefined,
  }, { status: failed.length ? 502 : 200 });
}
