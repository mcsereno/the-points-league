import { env } from "cloudflare:workers";

export type League = "nfl" | "cfb";
export type RundownPrice = { price: number; is_main_line?: boolean; updated_at?: string };
export type RundownLine = { id: string; value: string; prices: Record<string, RundownPrice | undefined> };
export type RundownParticipant = { id: number; name: string; type: string; lines: RundownLine[] };
export type RundownMarket = { market_id: number; period_id: number; name: string; participants: RundownParticipant[] };
export type RundownEvent = {
  event_id: string;
  event_date: string;
  teams: Array<{ name: string; is_away?: boolean; is_home?: boolean }>;
  score?: { event_status?: string; score_away?: number | null; score_home?: number | null };
  markets?: RundownMarket[];
};

const settings = () => env as unknown as Record<string, string | undefined>;
const sportId = (league: League) => league === "nfl" ? 2 : 1;

export const dayOffset = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

export async function getRundownEvents(league: League, dates: string[], hideClosed: boolean) {
  const apiKey = settings().THERUNDOWN_API_KEY ?? settings().ODDS_API_KEY;
  if (!apiKey) return { league, ok: false, skipped: true, reason: "THERUNDOWN_API_KEY is not configured.", events: [] as RundownEvent[] };

  const events = new Map<string, RundownEvent>();
  for (const date of dates) {
    const url = new URL(`https://therundown.io/api/v2/sports/${sportId(league)}/events/${date}`);
    url.searchParams.set("market_ids", "1,2,3");
    url.searchParams.set("affiliate_ids", "19,23");
    url.searchParams.set("main_line", "true");
    if (hideClosed) url.searchParams.set("hide_closed", "true");
    let response: Response;
    try {
      response = await fetch(url, { headers: { "X-TheRundown-Key": apiKey, accept: "application/json" } });
    } catch {
      return { league, ok: false, skipped: false, reason: "TheRundown service is unavailable.", events: [] as RundownEvent[] };
    }
    if (!response.ok) return { league, ok: false, skipped: false, reason: `TheRundown request failed (${response.status}).`, events: [] as RundownEvent[] };
    const body = await response.json().catch(() => null) as { events?: RundownEvent[] } | null;
    if (!body?.events) return { league, ok: false, skipped: false, reason: "TheRundown returned an invalid event response.", events: [] as RundownEvent[] };
    for (const event of body.events) events.set(event.event_id, event);
  }
  return { league, ok: true, skipped: false, reason: null, events: [...events.values()] };
}
