import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { PortalHeader } from "../components/PortalHeader";
import { requireCommissioner } from "../lib/portal-auth";
import { getLeagueSettings } from "../lib/league-settings";
import { AdminPortal } from "./AdminPortal";
import { isEmailConfigured } from "../lib/email";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!await requireCommissioner()) redirect("/portal");
  const [members, wagers, sync, settings, audit] = await Promise.all([
    env.DB.prepare("SELECT id,email,display_name AS displayName,status,role,starting_balance AS startingBalance,balance,email_verified_at AS emailVerifiedAt,created_at AS createdAt FROM members ORDER BY created_at DESC").all(),
    env.DB.prepare("SELECT id,player_key AS playerKey,bet_type AS betType,stake,status,payout,grading_reason AS gradingReason,placed_at AS placedAt,settled_at AS settledAt FROM wagers ORDER BY placed_at DESC LIMIT 100").all(),
    env.DB.prepare("SELECT league,last_success_at AS lastSuccessAt,credits_remaining AS creditsRemaining,last_error AS lastError FROM odds_sync_state ORDER BY league").all(),
    getLeagueSettings(),
    env.DB.prepare("SELECT actor_email AS actorEmail,event_type AS eventType,subject_type AS subjectType,subject_id AS subjectId,details_json AS detailsJson,created_at AS createdAt FROM audit_events ORDER BY id DESC LIMIT 50").all(),
  ]);
  return <main><PortalHeader admin /><section className="portal-hero shell"><div><p className="eyebrow">COMMISSIONER CONTROL</p><h1>Commissioner dashboard</h1><p>Approve members, email the league, manage the season, refresh scores and markets, and review tickets.</p></div></section><section className="content-band"><AdminPortal initialMembers={members.results as never[]} initialWagers={wagers.results as never[]} sync={sync.results as never[]} initialSettings={settings} initialAudit={audit.results as never[]} emailConfigured={isEmailConfigured()} /></section></main>;
}
