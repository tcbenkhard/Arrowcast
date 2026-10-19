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
	CONSTRAINT "competition_lanes_target_count_positive_integer" CHECK("__new_competition_lanes"."number_of_targets" IS NULL OR ("__new_competition_lanes"."number_of_targets" BETWEEN 1 AND 2 AND typeof("__new_competition_lanes"."number_of_targets") = 'integer'))
);
--> statement-breakpoint
INSERT INTO `__new_competition_lanes`("competition_id", "range_id", "lane_id", "distance_meters", "target_type", "number_of_targets") SELECT "competition_id", "range_id", "lane_id", "distance_meters", "target_type", min("number_of_targets", 2) FROM `competition_lanes`;--> statement-breakpoint
DROP TABLE `competition_lanes`;--> statement-breakpoint
ALTER TABLE `__new_competition_lanes` RENAME TO `competition_lanes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_competition_participants` (
	`competition_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`bow_type` text,
	`target_type` text,
	`checked_in` integer DEFAULT false NOT NULL,
	`lane_id` text,
	`target_letter` text,
	PRIMARY KEY(`competition_id`, `participant_id`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bow_type`) REFERENCES `bow_types`(`name`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_type`) REFERENCES `target_types`(`name`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competition_id`,`lane_id`) REFERENCES `competition_lanes`(`competition_id`,`lane_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "competition_participants_check_in_boolean" CHECK("__new_competition_participants"."checked_in" IN (0, 1)),
	CONSTRAINT "competition_participants_place_valid" CHECK(("__new_competition_participants"."lane_id" IS NULL AND "__new_competition_participants"."target_letter" IS NULL) OR ("__new_competition_participants"."lane_id" IS NOT NULL AND "__new_competition_participants"."target_letter" IS NOT NULL AND "__new_competition_participants"."target_letter" IN ('A', 'B', 'C', 'D')))
);
--> statement-breakpoint
INSERT INTO `__new_competition_participants`("competition_id", "participant_id", "bow_type", "target_type") SELECT "competition_id", "participant_id", "bow_type", "target_type" FROM `competition_participants`;--> statement-breakpoint
DROP TABLE `competition_participants`;--> statement-breakpoint
ALTER TABLE `__new_competition_participants` RENAME TO `competition_participants`;--> statement-breakpoint
CREATE UNIQUE INDEX `competition_participants_place_unique` ON `competition_participants` (`competition_id`,`lane_id`,`target_letter`);