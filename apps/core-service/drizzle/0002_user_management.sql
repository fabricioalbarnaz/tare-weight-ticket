-- Hand-edited after `drizzle-kit generate`: SQLite can't ADD a NOT NULL
-- column without a default to a table that may already have rows, so
-- `name`/`updated_at` get a placeholder default here, then are backfilled
-- from the existing row's own `username`/`created_at` below.
ALTER TABLE `admin_users` ADD `name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `role` text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `must_change_password` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `admin_users` SET `name` = `username`, `updated_at` = `created_at`;
