PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_competition_lanes` (
	`competition_id` text NOT NULL,
	`range_id` text NOT NULL,
	`lane_id` text NOT NULL,
	`distance_meters` real NOT NULL,
	`target_type` text,
	`number_of_targets` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`competition_id`, `lane_id`),
	FOREIGN KEY (`competition_id`,`range_id`) REFERENCES `competitions`(`id`,`range_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lane_id`,`range_id`) REFERENCES `lanes`(`id`,`range_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`range_id`,`distance_meters`) REFERENCES `range_distances`(`range_id`,`distance_meters`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "competition_lanes_target_type_not_blank" CHECK("__new_competition_lanes"."target_type" IS NULL OR (length(trim("__new_competition_lanes"."target_type")) > 0 AND length("__new_competition_lanes"."target_type") <= 100)),
	CONSTRAINT "competition_lanes_target_count_positive_integer" CHECK("__new_competition_lanes"."number_of_targets" IS NULL OR ("__new_competition_lanes"."number_of_targets" > 0 AND typeof("__new_competition_lanes"."number_of_targets") = 'integer'))
);
--> statement-breakpoint
INSERT INTO `__new_competition_lanes`("competition_id", "range_id", "lane_id", "distance_meters", "target_type", "number_of_targets") SELECT "competition_id", "range_id", "lane_id", "distance_meters", "target_type", COALESCE("number_of_targets", 1) FROM `competition_lanes`;--> statement-breakpoint
DROP TABLE `competition_lanes`;--> statement-breakpoint
ALTER TABLE `__new_competition_lanes` RENAME TO `competition_lanes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;