CREATE TABLE `season_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`settings_json` text NOT NULL,
	`updated_by` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `members` ADD `rebuy_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `outcomes` ADD `odds_provider` text;