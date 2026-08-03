import { env } from "cloudflare:workers";
import { cfbWeekZeroKey, leagueSeasonWeeks, leagueWeekKey, leagueWeekWindowForStart, type LeagueWeek } from "./league-config";
import { getLeagueSettings } from "./league-settings";

type LifecycleMember = { id: number; email: string; balance: number; rebuyCount: number; createdAt: string; status: string };

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function cfbWeekKey(seasonId: string, number: number) {
  const weekZero = cfbWeekZeroKey(seasonId);
  const window = weekZero ? leagueWeekWindowForStart(weekZero) : null;
  if (!window) return null;
  return leagueWeekKey({ start: new Date(window.start.getTime() + number * 7 * 86_400_000) });
}

async function firstCfbKickoff(week: LeagueWeek) {
  return env.DB.prepare(`
    SELECT MIN(kickoff_at) AS kickoffAt
    FROM games
    WHERE league='cfb'
      AND datetime(kickoff_at)>=datetime(?)
      AND datetime(kickoff_at)<datetime(?)
  `).bind(week.start.toISOString(), week.end.toISOString()).first<{ kickoffAt: string | null }>();
}

async function rebuyDeadline(seasonId: string) {
  const key = cfbWeekKey(seasonId, 8);
  const week = key ? leagueWeekWindowForStart(key) : null;
  if (!week) return null;
  const firstGame = await firstCfbKickoff(week);
  return new Date(firstGame?.kickoffAt ?? week.end.toISOString());
}

export async function canCreateNewEntry(now = new Date()) {
  const settings = await getLeagueSettings();
  const deadline = await rebuyDeadline(settings.seasonId);
  // Before Week 8 data is on the board, the end of that league week is the
  // conservative temporary cutoff. Once a CFB game is available, its kickoff
  // becomes the exact entry and rebuy deadline.
  return !deadline || now.getTime() < deadline.getTime();
}

export function memberRequirementApplies(memberCreatedAt: string, week: LeagueWeek) {
  // A player who joined this league week starts the requirement next week.
  return new Date(memberCreatedAt).getTime() < week.start.getTime();
}

async function weeklyWagered(memberEmail: string, week: LeagueWeek) {
  const row = await env.DB.prepare(`
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
  `).bind(memberEmail, week.start.toISOString(), week.end.toISOString()).first<{ wagered: number }>();
  return Number(row?.wagered ?? 0);
}

async function wasSuspendedDuringWeek(memberId: number, week: LeagueWeek) {
  const event = await env.DB.prepare(`
    SELECT id
    FROM audit_events
    WHERE event_type='member_updated'
      AND subject_type='member'
      AND subject_id=?
      AND datetime(created_at)>=datetime(?)
      AND datetime(created_at)<datetime(?)
      AND details_json LIKE '%"status":"suspended"%'
    LIMIT 1
  `).bind(String(memberId), week.start.toISOString(), week.end.toISOString()).first<{ id: number }>();
  return Boolean(event);
}

export async function collectWeeklyShortfalls(now = new Date()) {
  const settings = await getLeagueSettings();
  const firstRequiredWeek = cfbWeekZeroKey(settings.seasonId);
  if (!firstRequiredWeek) return { processedWeeks: 0, collected: 0, deductions: 0 };
  const members = await env.DB.prepare(`
    SELECT id,email,balance,rebuy_count AS rebuyCount,created_at AS createdAt,status
    FROM members
    WHERE status='approved'
  `).all<LifecycleMember>();
  let processedWeeks = 0;
  let collected = 0;
  let deductions = 0;

  for (const week of leagueSeasonWeeks(settings.seasonId)) {
    if (week.key < firstRequiredWeek) continue;
    if (week.start.getTime() > now.getTime()) continue;
    const finalGame = await env.DB.prepare(`
      SELECT MAX(kickoff_at) AS kickoffAt
      FROM games
      WHERE league IN ('nfl','cfb')
        AND datetime(kickoff_at)>=datetime(?)
        AND datetime(kickoff_at)<datetime(?)
    `).bind(week.start.toISOString(), week.end.toISOString()).first<{ kickoffAt: string | null }>();
    if (!finalGame?.kickoffAt || new Date(finalGame.kickoffAt).getTime() > now.getTime()) continue;
    const eligibleMembers = members.results.filter((member) => memberRequirementApplies(member.createdAt, week));
    if (!eligibleMembers.length) continue;
    const processed = await env.DB.prepare("SELECT COUNT(*) AS total FROM ledger_entries WHERE reference LIKE ?")
      .bind(`weekly-shortfall:${settings.seasonId}:${week.key}:%`).first<{ total: number }>();
    if (Number(processed?.total ?? 0) >= eligibleMembers.length) continue;
    processedWeeks += 1;

    for (const member of eligibleMembers) {
      if (await wasSuspendedDuringWeek(member.id, week)) {
        const reference = `weekly-shortfall:${settings.seasonId}:${week.key}:${member.id}`;
        await env.DB.prepare(`
          INSERT OR IGNORE INTO ledger_entries (member_email,entry_type,amount,reference,note)
          VALUES (?,'weekly_shortfall',0,?,?)
        `).bind(member.email, reference, `Week ${week.label} requirement exempted while the entry was suspended.`).run();
        continue;
      }
      const wagered = await weeklyWagered(member.email, week);
      const shortfall = money(Math.max(0, settings.weeklyMinimumPoints - wagered));
      const deduction = money(Math.min(shortfall, Number(member.balance)));
      const reference = `weekly-shortfall:${settings.seasonId}:${week.key}:${member.id}`;
      const existing = await env.DB.prepare("SELECT id FROM ledger_entries WHERE reference=?").bind(reference).first<{ id: number }>();
      if (existing) continue;
      const statements = [
        ...(deduction > 0 ? [env.DB.prepare(`
          UPDATE members
          SET balance=ROUND(MAX(0,balance-?),2),updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND balance>0
        `).bind(deduction, member.id)] : []),
        env.DB.prepare(`
          INSERT OR IGNORE INTO ledger_entries (member_email,entry_type,amount,reference,note)
          VALUES (?,'weekly_shortfall',?,?,?)
        `).bind(member.email, -deduction, reference, deduction > 0
          ? `Week ${week.label} requirement: ${wagered.toFixed(2)} wagered; ${deduction.toFixed(2)} collected.`
          : `Week ${week.label} requirement met: ${wagered.toFixed(2)} wagered.`),
      ];
      await env.DB.batch(statements);
      if (deduction > 0) {
        collected += 1;
        deductions = money(deductions + deduction);
      }
    }
  }
  return { processedWeeks, collected, deductions };
}

export async function canMemberRebuy(member: Pick<LifecycleMember, "id" | "email" | "balance" | "status">, now = new Date()) {
  const settings = await getLeagueSettings();
  if (member.status !== "approved" || Number(member.balance) > 0) return false;
  const deadline = await rebuyDeadline(settings.seasonId);
  if (!deadline || now.getTime() >= deadline.getTime()) return false;
  const pending = await env.DB.prepare("SELECT 1 FROM wagers WHERE player_key=? AND status='pending' LIMIT 1").bind(member.email).first();
  return !pending;
}

export async function requestMemberRebuy(member: Pick<LifecycleMember, "id" | "email" | "balance" | "status">) {
  if (!await canMemberRebuy(member)) throw new Error("A rebuy is not available for this entry.");
  const settings = await getLeagueSettings();
  const current = await env.DB.prepare("SELECT id,email,balance,rebuy_count AS rebuyCount,status FROM members WHERE id=?").bind(member.id).first<LifecycleMember>();
  if (!current || !await canMemberRebuy(current)) throw new Error("A rebuy is not available for this entry.");
  const nextRebuy = Number(current.rebuyCount) + 1;
  const reference = `rebuy:${settings.seasonId}:${current.id}:${nextRebuy}`;
  const existing = await env.DB.prepare("SELECT id FROM ledger_entries WHERE reference=?").bind(reference).first<{ id: number }>();
  if (!existing) {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE members
        SET balance=ROUND(balance+?,2),rebuy_count=rebuy_count+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='approved' AND balance<=0
      `).bind(settings.rebuyStartingPoints, current.id),
      env.DB.prepare(`
        INSERT OR IGNORE INTO ledger_entries (member_email,entry_type,amount,reference,note)
        VALUES (?,'rebuy',?,?,?)
      `).bind(current.email, settings.rebuyStartingPoints, reference, `Rebuy ${nextRebuy}: restored ${settings.rebuyStartingPoints.toFixed(2)} Points.`),
    ]);
  }
  const updated = await env.DB.prepare("SELECT balance,rebuy_count AS rebuyCount FROM members WHERE id=?").bind(current.id).first<{ balance: number; rebuyCount: number }>();
  return { balance: Number(updated?.balance ?? 0), rebuyCount: Number(updated?.rebuyCount ?? current.rebuyCount) };
}

export async function eliminateBustedEntries(now = new Date()) {
  const settings = await getLeagueSettings();
  const deadline = await rebuyDeadline(settings.seasonId);
  if (!deadline || now.getTime() < deadline.getTime()) return { eliminated: 0 };
  const result = await env.DB.prepare(`
    UPDATE members
    SET status='eliminated',updated_at=CURRENT_TIMESTAMP
    WHERE status='approved' AND balance<=0
      AND NOT EXISTS (SELECT 1 FROM wagers WHERE player_key=members.email AND status='pending')
  `).run();
  return { eliminated: Number(result.meta.changes ?? 0) };
}

export async function runSeasonLifecycle(now = new Date()) {
  const [shortfalls, eliminations] = await Promise.all([collectWeeklyShortfalls(now), eliminateBustedEntries(now)]);
  return { shortfalls, eliminations };
}
