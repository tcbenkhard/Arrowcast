CREATE TABLE `api_tokens` (
	`naam` text NOT NULL,
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_date` integer NOT NULL,
	CONSTRAINT "api_tokens_name_valid" CHECK(length("api_tokens"."naam") BETWEEN 1 AND 100 AND "api_tokens"."naam" = trim("api_tokens"."naam"))
);
