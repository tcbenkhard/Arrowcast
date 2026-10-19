CREATE TABLE `bow_types` (
	`name` text PRIMARY KEY NOT NULL,
	CONSTRAINT "bow_types_name_valid" CHECK(length(trim("bow_types"."name")) BETWEEN 1 AND 100 AND "bow_types"."name" = trim("bow_types"."name"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bow_types_name_case_insensitive_unique` ON `bow_types` (lower("name"));
--> statement-breakpoint
INSERT INTO `bow_types` (`name`) VALUES
  ('Recurve'),
  ('Compound'),
  ('Barebow'),
  ('Traditional'),
  ('Longbow');
