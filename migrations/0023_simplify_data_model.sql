PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_logbook_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`rounds` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_logbook_entries` (
	`id`, `participant_id`, `token_hash`, `expires_at`, `rounds`, `version`, `total`, `created_at`, `completed_at`
)
SELECT
	e.`id`, e.`participant_id`, s.`token_hash`, s.`expires_at`, e.`rounds`, e.`version`, e.`total`, e.`created_at`, e.`completed_at`
FROM `logbook_entries` e
INNER JOIN `logbook_sessions` s ON s.`id` = e.`session_id`;--> statement-breakpoint
DROP TABLE `logbook_entries`;--> statement-breakpoint
DROP TABLE `logbook_sessions`;--> statement-breakpoint
ALTER TABLE `__new_logbook_entries` RENAME TO `logbook_entries`;--> statement-breakpoint
CREATE UNIQUE INDEX `logbook_entries_token_hash_unique` ON `logbook_entries` (`token_hash`);--> statement-breakpoint
CREATE INDEX `logbook_entries_participant_completed_index` ON `logbook_entries` (`participant_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `__new_scoring_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`scorecard_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_version` integer NOT NULL,
	`round_number` integer NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`submitted` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `scoring_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scorecard_id`) REFERENCES `scorecards`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_scoring_mutations` (
	`id`, `session_id`, `scorecard_id`, `request_hash`, `result_version`, `round_number`, `before`, `after`, `submitted`, `created_at`
)
SELECT
	m.`id`, m.`session_id`, c.`scorecard_id`, m.`request_hash`, CAST(json_extract(m.`result`, '$.version') AS integer),
	c.`round_number`, c.`before`, c.`after`, c.`submitted`, m.`created_at`
FROM `scoring_mutations` m
INNER JOIN `score_changes` c ON c.`mutation_id` = m.`id`;--> statement-breakpoint
DROP TABLE `score_changes`;--> statement-breakpoint
DROP TABLE `scoring_mutations`;--> statement-breakpoint
ALTER TABLE `__new_scoring_mutations` RENAME TO `scoring_mutations`;--> statement-breakpoint
CREATE TABLE `__new_round_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`scorecard_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`submitted_at` integer,
	FOREIGN KEY (`scorecard_id`) REFERENCES `scorecards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "round_scores_round_valid" CHECK("__new_round_scores"."round_number" > 0 AND typeof("__new_round_scores"."round_number") = 'integer')
);--> statement-breakpoint
INSERT INTO `__new_round_scores` (`id`, `scorecard_id`, `round_number`, `submitted_at`)
SELECT `id`, `scorecard_id`, `round_number`, CASE WHEN `status` = 'submitted' THEN COALESCE(`submitted_at`, 0) ELSE NULL END
FROM `round_scores`;--> statement-breakpoint
CREATE TABLE `__new_arrow_scores` (
	`round_score_id` text NOT NULL,
	`arrow_index` integer NOT NULL,
	`symbol` text NOT NULL,
	PRIMARY KEY(`round_score_id`, `arrow_index`),
	FOREIGN KEY (`round_score_id`) REFERENCES `__new_round_scores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "arrow_scores_index_valid" CHECK("__new_arrow_scores"."arrow_index" > 0 AND typeof("__new_arrow_scores"."arrow_index") = 'integer'),
	CONSTRAINT "arrow_scores_symbol_valid" CHECK("__new_arrow_scores"."symbol" IN ('M', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'))
);--> statement-breakpoint
INSERT INTO `__new_arrow_scores` (`round_score_id`, `arrow_index`, `symbol`)
SELECT `round_score_id`, `arrow_index`, `symbol` FROM `arrow_scores`;--> statement-breakpoint
DROP TABLE `arrow_scores`;--> statement-breakpoint
DROP TABLE `round_scores`;--> statement-breakpoint
ALTER TABLE `__new_round_scores` RENAME TO `round_scores`;--> statement-breakpoint
ALTER TABLE `__new_arrow_scores` RENAME TO `arrow_scores`;--> statement-breakpoint
CREATE UNIQUE INDEX `round_scores_number_unique` ON `round_scores` (`scorecard_id`,`round_number`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
