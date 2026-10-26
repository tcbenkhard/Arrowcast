CREATE TABLE `logbook_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`rounds` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `logbook_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `logbook_entries_session_id_unique` ON `logbook_entries` (`session_id`);--> statement-breakpoint
CREATE INDEX `logbook_entries_participant_completed_index` ON `logbook_entries` (`participant_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `logbook_pins` (
	`participant_id` text PRIMARY KEY NOT NULL,
	`pin_hash` text NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `logbook_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `logbook_sessions_token_hash_unique` ON `logbook_sessions` (`token_hash`);