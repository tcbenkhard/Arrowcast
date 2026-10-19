CREATE TABLE `competition_participants` (
	`competition_id` text NOT NULL,
	`participant_id` text NOT NULL,
	PRIMARY KEY(`competition_id`, `participant_id`),
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE no action
);
