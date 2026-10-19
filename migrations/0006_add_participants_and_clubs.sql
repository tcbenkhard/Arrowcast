CREATE TABLE `clubs` (
	`club_number` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT "clubs_number_not_blank" CHECK(length(trim("clubs"."club_number")) > 0),
	CONSTRAINT "clubs_name_not_blank" CHECK(length(trim("clubs"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`federation_number` text NOT NULL,
	`name` text NOT NULL,
	`club_number` text NOT NULL,
	FOREIGN KEY (`club_number`) REFERENCES `clubs`(`club_number`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "participants_federation_number_not_blank" CHECK(length(trim("participants"."federation_number")) > 0),
	CONSTRAINT "participants_name_not_blank" CHECK(length(trim("participants"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_federation_number_unique` ON `participants` (`federation_number`);--> statement-breakpoint
CREATE INDEX `participants_club_number_index` ON `participants` (`club_number`);