CREATE TABLE `target_types` (
	`name` text PRIMARY KEY NOT NULL,
	CONSTRAINT "target_types_name_valid" CHECK(length(trim("target_types"."name")) BETWEEN 1 AND 100 AND "target_types"."name" = trim("target_types"."name"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `target_types_name_case_insensitive_unique` ON `target_types` (lower("name"));
--> statement-breakpoint
-- Standard Dutch competition faces and field/3D targets; names are extensible.
-- Sources: https://mijn.handboogsport.nl/bondscompetities/info/
-- https://mijn.handboogsport.nl/static/introductie-voor-leden.pdf
-- https://sportinfrastructuur.nl/voorschriften/C0255
-- https://www.sportinfrastructuur.nl/voorschriften/C0251
-- https://www.ogio.nl/wp-content/uploads/2015/02/Colored%20Field%20Manual%20ENG.pdf
-- https://www.handboogsport.nl/voor-schutters/3d/
INSERT OR IGNORE INTO `target_types` (`name`) VALUES
  ('40 cm blazoen (10-rings)'),
  ('60 cm blazoen (10-rings)'),
  ('80 cm blazoen (10-rings)'),
  ('122 cm blazoen (10-rings)'),
  ('Dutch Target 40 cm (3-spot)'),
  ('Dutch Target 60 cm (3-spot)'),
  ('Las Vegas 40 cm (3-spot)'),
  ('Las Vegas 60 cm (3-spot)'),
  ('40 cm horizontaal (3-spot)'),
  ('Compound 40 cm (4-spot)'),
  ('80 cm blazoen (6-rings)'),
  ('Hit/Mis blazoen'),
  ('Veldblazoen 20 cm'),
  ('Veldblazoen 40 cm'),
  ('Veldblazoen 60 cm'),
  ('Veldblazoen 80 cm'),
  ('3D dierdoel'),
  ('Dierenblazoen (papier)');
--> statement-breakpoint
-- Keep names already used by existing competitions available in the selector.
INSERT OR IGNORE INTO `target_types` (`name`)
SELECT DISTINCT trim(`target_type`) FROM `competition_lanes`
WHERE `target_type` IS NOT NULL AND length(trim(`target_type`)) BETWEEN 1 AND 100;
