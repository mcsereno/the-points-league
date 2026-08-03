import { requestMemberRebuy } from "../../lib/season-lifecycle";
import { isSameOrigin, requirePortalMember } from "../../lib/portal-auth";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const { member } = await requirePortalMember("/portal");
  try {
    const rebuy = await requestMemberRebuy(member);
    return Response.json({ ok: true, rebuy });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The rebuy could not be completed." }, { status: 400 });
  }
}
