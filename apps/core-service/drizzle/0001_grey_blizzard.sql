CREATE TABLE `conjuntos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conjuntos_name_unique` ON `conjuntos` (`name`);--> statement-breakpoint
CREATE TABLE `internal_trucks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plate` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_trucks_plate_unique` ON `internal_trucks` (`plate`);--> statement-breakpoint
CREATE TABLE `truck_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`truck_id` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`truck_id`) REFERENCES `internal_trucks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `truck_conjuntos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`truck_id` integer NOT NULL,
	`conjunto_id` integer NOT NULL,
	`tare_weight_kg` real NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`truck_id`) REFERENCES `internal_trucks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conjunto_id`) REFERENCES `conjuntos`(`id`) ON UPDATE no action ON DELETE no action
);
