CREATE TABLE `notification_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`audience` text NOT NULL,
	`language` text DEFAULT 'all' NOT NULL,
	`deep_link` text NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	`admin_id` text NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `lab_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_created` ON `notification_campaigns` (`created_at`);--> statement-breakpoint
CREATE TABLE `notification_reads` (
	`user_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `lab_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notice_reads_owner_notice` ON `notification_reads` (`user_id`,`notification_id`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `category` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `deep_link` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `campaign_id` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `notifications` ADD `image` text;