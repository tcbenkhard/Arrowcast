CREATE TABLE `competition_lanes` (
	`competition_id` text NOT NULL,
	`range_id` text NOT NULL,
	`lane_id` text NOT NULL,
	`distance_meters` real NOT NULL,
	PRIMARY KEY(`competition_id`, `lane_id`),
	FOREIGN KEY (`competition_id`,`range_id`) REFERENCES `competitions`(`id`,`range_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lane_id`,`range_id`) REFERENCES `lanes`(`id`,`range_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`range_id`,`distance_meters`) REFERENCES `range_distances`(`range_id`,`distance_meters`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`starting_time` text NOT NULL,
	`ending_time` text NOT NULL,
	`range_id` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`range_id`) REFERENCES `ranges`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "competitions_name_not_blank" CHECK(length(trim("competitions"."name")) > 0),
	CONSTRAINT "competitions_time_order" CHECK("competitions"."ending_time" > "competitions"."starting_time"),
	CONSTRAINT "competitions_active_boolean" CHECK("competitions"."active" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `competitions_date_time_index` ON `competitions` (`date`,`starting_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `competitions_id_range_unique` ON `competitions` (`id`,`range_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lanes_id_range_unique` ON `lanes` (`id`,`range_id`);