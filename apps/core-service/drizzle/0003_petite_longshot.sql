ALTER TABLE `tickets` ADD `reweigh_of_ticket_id` integer REFERENCES tickets(id);--> statement-breakpoint
ALTER TABLE `tickets` ADD `reweighed_by_ticket_id` integer REFERENCES tickets(id);