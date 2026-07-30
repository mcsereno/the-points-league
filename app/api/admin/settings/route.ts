import { isSameOrigin, requireCommissioner } from "../../../lib/portal-auth";
import { saveLeagueSettings } from "../../../lib/league-settings";
import { validateLeagueSettings } from "../../../lib/league-config";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const commissioner = await requireCommissioner();
  if (!commissioner) return Response.json({ error: "Commissioner access required." }, { status: 403 });
  try {
    const body = await request.json() as { settings?: unknown };
    const settings = validateLeagueSettings(body.settings);
    const saved = await saveLeagueSettings(settings, commissioner.user.email.toLowerCase());
    return Response.json({ ok: true, settings: saved });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Season settings could not be saved." }, { status: 400 });
  }
}
