ALTER TABLE `wagers` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `wagers_external_id_unique` ON `wagers` (`external_id`);