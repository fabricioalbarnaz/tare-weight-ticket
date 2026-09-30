CREATE TABLE `admin_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_unique` ON `admin_users` (`username`);--> statement-breakpoint
CREATE TABLE `raw_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`raw_payload` text NOT NULL,
	`received_at` integer NOT NULL,
	`linked_ticket_id` integer,
	FOREIGN KEY (`linked_ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ticket_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_number` integer NOT NULL,
	`plate` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`entry_at` integer,
	`entry_weight_kg` real,
	`entry_camera_id` text,
	`entry_capture_failed` integer DEFAULT false NOT NULL,
	`exit_at` integer,
	`exit_weight_kg` real,
	`exit_camera_id` text,
	`exit_capture_failed` integer DEFAULT false NOT NULL,
	`net_weight_kg` real,
	`printed_at` integer,
	`created_by_admin` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_ticket_number_unique` ON `tickets` (`ticket_number`);