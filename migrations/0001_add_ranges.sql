CREATE TABLE `lanes` (
	`id` text PRIMARY KEY NOT NULL,
	`range_id` text NOT NULL,
	`number` integer NOT NULL,
	FOREIGN KEY (`range_id`) REFERENCES `ranges`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lanes_number_positive_integer" CHECK("lanes"."number" > 0 AND typeof("lanes"."number") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lanes_range_number_unique` ON `lanes` (`range_id`,`number`);--> statement-breakpoint
CREATE TABLE `range_distances` (
	`range_id` text NOT NULL,
	`distance_meters` real NOT NULL,
	PRIMARY KEY(`range_id`, `distance_meters`),
	FOREIGN KEY (`range_id`) REFERENCES `ranges`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "range_distances_positive" CHECK("range_distances"."distance_meters" > 0)
);
--> statement-breakpoint
CREATE TABLE `ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT "ranges_name_not_blank" CHECK(length(trim("ranges"."name")) > 0)
);
