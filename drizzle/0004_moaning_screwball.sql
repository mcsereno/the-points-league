CREATE TABLE `ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_email` text NOT NULL,
	`entry_type` text NOT NULL,
	`amount` real NOT NULL,
	`reference` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entries_reference_unique` ON `ledger_entries` (`reference`);--> statement-breakpoint
CREATE INDEX `ledger_member_created_idx` ON `ledger_entries` (`member_email`,`created_at`);--> statement-breakpoint
ALTER TABLE `wagers` ADD `grading_reason` text;--> statement-breakpoint
ALTER TABLE `wagers` ADD `settled_at` text;