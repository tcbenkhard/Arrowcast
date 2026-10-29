CREATE TABLE `__new_api_tokens` (
  `id` text NOT NULL,
  `naam` text NOT NULL,
  `token_hash` text PRIMARY KEY NOT NULL,
  `created_date` integer NOT NULL,
  CONSTRAINT "api_tokens_name_valid" CHECK(length("naam") BETWEEN 1 AND 100 AND "naam" = trim("naam"))
);
--> statement-breakpoint
INSERT INTO `__new_api_tokens` (`id`, `naam`, `token_hash`, `created_date`)
SELECT lower(hex(randomblob(16))), `naam`, `token_hash`, `created_date` FROM `api_tokens`;
--> statement-breakpoint
DROP TABLE `api_tokens`;
--> statement-breakpoint
ALTER TABLE `__new_api_tokens` RENAME TO `api_tokens`;
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_id_unique` ON `api_tokens` (`id`);
