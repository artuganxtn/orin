CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`reference` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`asset` text NOT NULL,
	`direction` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`settlement_bps` integer NOT NULL,
	`eligibility` text NOT NULL,
	`opens_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`published_at` integer NOT NULL,
	`admin_id` text NOT NULL,
	`canonical` text NOT NULL,
	`hash` text NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `lab_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contracts_code_unique` ON `contracts` (`code`);--> statement-breakpoint
CREATE INDEX `idx_contracts_published` ON `contracts` (`published_at`);--> statement-breakpoint
CREATE TABLE `journals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`reference` text NOT NULL,
	`effective_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`journal_id` text NOT NULL,
	`account` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ledger_journal_account` ON `ledger_entries` (`journal_id`,`account`);--> statement-breakpoint
CREATE INDEX `idx_ledger_account` ON `ledger_entries` (`account`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`eligibility` text DEFAULT 'all' NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`contract_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_created` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`result_cents` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `lab_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_positions_user_contract` ON `positions` (`user_id`,`contract_id`);--> statement-breakpoint
CREATE INDEX `idx_positions_due` ON `positions` (`status`,`ends_at`);--> statement-breakpoint
CREATE INDEX `idx_positions_user` ON `positions` (`user_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`position_id` text NOT NULL,
	`user_id` text NOT NULL,
	`payload` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_position_id_unique` ON `receipts` (`position_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lab_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tier` text DEFAULT 'standard' NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	`seen_at` integer DEFAULT 0 NOT NULL
);
