CREATE TABLE `game_arena` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`map` text NOT NULL,
	`reason` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`final_state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_scores` (
	`match_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`score` integer NOT NULL,
	`radius` integer NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`match_id`, `user_id`),
	FOREIGN KEY (`match_id`) REFERENCES `game_matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `game_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scores_user` ON `game_scores` (`user_id`);--> statement-breakpoint
CREATE TABLE `game_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `game_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_expiry` ON `game_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `game_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_users_username_unique` ON `game_users` (`username`);