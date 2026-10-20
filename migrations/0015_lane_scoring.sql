CREATE TABLE `arrow_scores` (
	`round_score_id` text NOT NULL,
	`arrow_index` integer NOT NULL,
	`symbol` text NOT NULL,
	PRIMARY KEY(`round_score_id`, `arrow_index`),
	FOREIGN KEY (`round_score_id`) REFERENCES `round_scores`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "arrow_scores_index_valid" CHECK("arrow_scores"."arrow_index" > 0 AND typeof("arrow_scores"."arrow_index") = 'integer'),
	CONSTRAINT "arrow_scores_symbol_valid" CHECK("arrow_scores"."symbol" IN ('M', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'))
);
--> statement-breakpoint
CREATE TABLE `lane_scoring_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`lane_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`competition_id`,`lane_id`) REFERENCES `competition_lanes`(`competition_id`,`lane_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lane_scoring_grants_token_hash_unique` ON `lane_scoring_grants` (`token_hash`);--> statement-breakpoint
CREATE INDEX `lane_scoring_grants_scope_index` ON `lane_scoring_grants` (`competition_id`,`lane_id`);--> statement-breakpoint
CREATE TABLE `lane_scoring_state` (
	`competition_id` text NOT NULL,
	`lane_id` text NOT NULL,
	`current_round_number` integer DEFAULT 1 NOT NULL,
	`current_participant_id` text,
	`participant_order` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`competition_id`, `lane_id`),
	FOREIGN KEY (`competition_id`,`lane_id`) REFERENCES `competition_lanes`(`competition_id`,`lane_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competition_id`,`current_participant_id`) REFERENCES `competition_participants`(`competition_id`,`participant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lane_scoring_state_round_positive" CHECK("lane_scoring_state"."current_round_number" > 0 AND typeof("lane_scoring_state"."current_round_number") = 'integer')
);
--> statement-breakpoint
CREATE TABLE `round_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`scorecard_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` integer,
	FOREIGN KEY (`scorecard_id`) REFERENCES `scorecards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "round_scores_round_valid" CHECK("round_scores"."round_number" > 0 AND typeof("round_scores"."round_number") = 'integer'),
	CONSTRAINT "round_scores_status_valid" CHECK("round_scores"."status" IN ('draft', 'submitted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `round_scores_number_unique` ON `round_scores` (`scorecard_id`,`round_number`);--> statement-breakpoint
CREATE TABLE `score_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`scorecard_id` text NOT NULL,
	`session_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`round_number` integer NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`submitted` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`scorecard_id`) REFERENCES `scorecards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `scoring_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mutation_id`) REFERENCES `scoring_mutations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scorecards` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`competition_id`,`participant_id`) REFERENCES `competition_participants`(`competition_id`,`participant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scorecards_participant_unique` ON `scorecards` (`competition_id`,`participant_id`);--> statement-breakpoint
CREATE TABLE `scoring_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `scoring_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scoring_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`grant_id`) REFERENCES `lane_scoring_grants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scoring_sessions_token_hash_unique` ON `scoring_sessions` (`token_hash`);--> statement-breakpoint
ALTER TABLE `competitions` ADD `number_of_rounds` integer DEFAULT 10 NOT NULL CONSTRAINT competitions_rounds_valid CHECK(typeof(number_of_rounds) = 'integer' AND number_of_rounds BETWEEN 1 AND 1000);
--> statement-breakpoint
ALTER TABLE `competitions` ADD `arrows_per_round` integer DEFAULT 3 NOT NULL CONSTRAINT competitions_arrows_valid CHECK(typeof(arrows_per_round) = 'integer' AND arrows_per_round BETWEEN 1 AND 36);
--> statement-breakpoint
ALTER TABLE `competitions` ADD `scoring_locked` integer DEFAULT false NOT NULL CONSTRAINT competitions_scoring_lock_valid CHECK(scoring_locked IN (0, 1));
