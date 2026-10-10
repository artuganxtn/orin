CREATE TABLE `account_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`profile` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `lab_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chart_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `lab_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `market_configuration` (
	`id` integer PRIMARY KEY NOT NULL,
	`configuration` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`admin_id` text NOT NULL,
	CONSTRAINT "market_configuration_singleton" CHECK("market_configuration"."id" = 1)
);
