-- Preserve child rows when rebuilding the parent table with foreign keys enabled.
CREATE TEMP TABLE `status_migration_lanes` AS SELECT * FROM `competition_lanes`;
--> statement-breakpoint
CREATE TEMP TABLE `status_migration_participants` AS SELECT * FROM `competition_participants`;
--> statement-breakpoint
CREATE TABLE `__new_competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`starting_time` text NOT NULL,
	`ending_time` text NOT NULL,
	`range_id` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	FOREIGN KEY (`range_id`) REFERENCES `ranges`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "competitions_name_not_blank" CHECK(length(trim("__new_competitions"."name")) > 0),
	CONSTRAINT "competitions_time_order" CHECK("__new_competitions"."ending_time" > "__new_competitions"."starting_time"),
	CONSTRAINT "competitions_status_valid" CHECK("__new_competitions"."status" IN ('Draft', 'Scheduled', 'Check-in', 'Active', 'Closed'))
);
--> statement-breakpoint
INSERT INTO `__new_competitions`("id", "name", "date", "starting_time", "ending_time", "range_id", "status") SELECT "id", "name", "date", "starting_time", "ending_time", "range_id", CASE WHEN "active" = 1 THEN 'Active' ELSE 'Draft' END FROM `competitions`;--> statement-breakpoint
DROP TABLE `competitions`;--> statement-breakpoint
ALTER TABLE `__new_competitions` RENAME TO `competitions`;--> statement-breakpoint
CREATE INDEX `competitions_date_time_index` ON `competitions` (`date`,`starting_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `competitions_id_range_unique` ON `competitions` (`id`,`range_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `competition_lanes` SELECT * FROM `status_migration_lanes`;
--> statement-breakpoint
INSERT OR IGNORE INTO `competition_participants` SELECT * FROM `status_migration_participants`;
--> statement-breakpoint
DROP TABLE `status_migration_lanes`;
--> statement-breakpoint
DROP TABLE `status_migration_participants`;
