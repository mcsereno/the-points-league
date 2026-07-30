CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`league` text NOT NULL,
	`away_team` text NOT NULL,
	`home_team` text NOT NULL,
	`kickoff_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`away_score` integer,
	`home_score` integer,
	`odds_provider` text,
	`odds_captured_at` text
);
--> statement-breakpoint
CREATE INDEX `games_league_kickoff_idx` ON `games` (`league`,`kickoff_at`);--> statement-breakpoint
CREATE TABLE `odds_sync_state` (
	`league` text PRIMARY KEY NOT NULL,
	`last_attempt_at` text,
	`last_success_at` text,
	`credits_remaining` integer,
	`credits_used` integer,
	`last_error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`market` text NOT NULL,
	`side` text NOT NULL,
	`label` text NOT NULL,
	`line` real,
	`price` integer NOT NULL,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `outcomes_game_market_idx` ON `outcomes` (`game_id`,`market`);--> statement-breakpoint
CREATE TABLE `wager_legs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wager_id` integer NOT NULL,
	`game_id` text NOT NULL,
	`outcome_id` text NOT NULL,
	`market` text NOT NULL,
	`selection` text NOT NULL,
	`locked_line` real,
	`locked_price` integer NOT NULL,
	`teased_line` real,
	`result` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`wager_id`) REFERENCES `wagers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wager_legs_wager_idx` ON `wager_legs` (`wager_id`);--> statement-breakpoint
CREATE INDEX `wager_legs_game_idx` ON `wager_legs` (`game_id`);--> statement-breakpoint
CREATE TABLE `wagers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_key` text NOT NULL,
	`bet_type` text NOT NULL,
	`stake` real NOT NULL,
	`combined_odds` integer,
	`teaser_points` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`payout` real,
	`placed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wagers_player_placed_idx` ON `wagers` (`player_key`,`placed_at`);