ALTER TABLE `users` ADD `name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `users` SET `name` = CASE WHEN `username` = 'admin' THEN 'Administrator' ELSE `username` END;
