CREATE TABLE `club_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`club_number` text,
	FOREIGN KEY (`club_number`) REFERENCES `clubs`(`club_number`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "club_settings_singleton" CHECK("club_settings"."id" = 1)
);
