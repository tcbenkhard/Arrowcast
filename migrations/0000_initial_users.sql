CREATE TABLE `users` (
  `username` text PRIMARY KEY NOT NULL,
  `password_hash` text NOT NULL,
  `role` text DEFAULT 'admin' NOT NULL
);
