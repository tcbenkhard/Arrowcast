ALTER TABLE `users` ADD `force_change_password` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `session_version` integer DEFAULT 0 NOT NULL;