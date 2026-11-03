CREATE TABLE `synchronization_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`requested_at` integer NOT NULL,
	`request_date` text,
	`request_time` text,
	`competition_id` text,
	`competition_name` text
);
