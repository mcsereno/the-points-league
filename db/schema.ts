import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  authUserId: text("auth_user_id").unique(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: text("email_verified_at"),
  displayName: text("display_name").notNull(),
  status: text("status", { enum: ["pending", "approved", "suspended"] }).notNull().default("pending"),
  role: text("role", { enum: ["member", "commissioner"] }).notNull().default("member"),
  startingBalance: real("starting_balance").notNull().default(10000),
  balance: real("balance").notNull().default(10000),
  rebuyCount: integer("rebuy_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("members_status_idx").on(table.status)]);

export const authChallenges = sqliteTable("auth_challenges", {
  email: text("email").primaryKey(),
  displayName: text("display_name"),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").notNull().references(() => members.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("auth_sessions_member_idx").on(table.memberId)]);

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  league: text("league", { enum: ["nfl", "cfb"] }).notNull(),
  awayTeam: text("away_team").notNull(),
  homeTeam: text("home_team").notNull(),
  kickoffAt: text("kickoff_at").notNull(),
  status: text("status").notNull().default("scheduled"),
  awayScore: integer("away_score"),
  homeScore: integer("home_score"),
  oddsProvider: text("odds_provider"),
  oddsCapturedAt: text("odds_captured_at"),
}, (table) => [index("games_league_kickoff_idx").on(table.league, table.kickoffAt)]);

export const outcomes = sqliteTable("outcomes", {
  id: text("id").primaryKey(),
  gameId: text("game_id").notNull().references(() => games.id),
  market: text("market", { enum: ["spread", "moneyline", "total"] }).notNull(),
  side: text("side").notNull(),
  label: text("label").notNull(),
  line: real("line"),
  price: integer("price").notNull(),
  oddsProvider: text("odds_provider"),
  capturedAt: text("captured_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("outcomes_game_market_idx").on(table.gameId, table.market)]);

export const oddsSyncState = sqliteTable("odds_sync_state", {
  league: text("league", { enum: ["nfl", "cfb"] }).primaryKey(),
  lastAttemptAt: text("last_attempt_at"),
  lastSuccessAt: text("last_success_at"),
  creditsRemaining: integer("credits_remaining"),
  creditsUsed: integer("credits_used"),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const seasonSettings = sqliteTable("season_settings", {
  id: text("id").primaryKey(),
  settingsJson: text("settings_json").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const wagers = sqliteTable("wagers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").unique(),
  playerKey: text("player_key").notNull(),
  betType: text("bet_type", { enum: ["single", "parlay", "teaser"] }).notNull(),
  stake: real("stake").notNull(),
  combinedOdds: integer("combined_odds"),
  teaserPoints: real("teaser_points"),
  status: text("status", { enum: ["pending", "won", "lost", "push", "void"] }).notNull().default("pending"),
  payout: real("payout"),
  gradingReason: text("grading_reason"),
  placedAt: text("placed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  settledAt: text("settled_at"),
}, (table) => [index("wagers_player_placed_idx").on(table.playerKey, table.placedAt)]);

export const wagerLegs = sqliteTable("wager_legs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  wagerId: integer("wager_id").notNull().references(() => wagers.id),
  gameId: text("game_id").notNull().references(() => games.id),
  outcomeId: text("outcome_id").notNull(),
  market: text("market").notNull(),
  lockedSide: text("locked_side"),
  selection: text("selection").notNull(),
  lockedLine: real("locked_line"),
  lockedPrice: integer("locked_price").notNull(),
  teasedLine: real("teased_line"),
  result: text("result", { enum: ["pending", "won", "lost", "push", "void"] }).notNull().default("pending"),
}, (table) => [index("wager_legs_wager_idx").on(table.wagerId), index("wager_legs_game_idx").on(table.gameId)]);

export const ledgerEntries = sqliteTable("ledger_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberEmail: text("member_email").notNull(),
  entryType: text("entry_type", {
    enum: ["wager_stake", "wager_settlement", "wager_void", "weekly_penalty", "rebuy", "adjustment"],
  }).notNull(),
  amount: real("amount").notNull(),
  reference: text("reference").notNull().unique(),
  note: text("note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("ledger_member_created_idx").on(table.memberEmail, table.createdAt),
]);

export const emailDeliveries = sqliteTable("email_deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventKey: text("event_key").notNull().unique(),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("email_deliveries_status_idx").on(table.status),
  index("email_deliveries_recipient_idx").on(table.recipient),
]);
