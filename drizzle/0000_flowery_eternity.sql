CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`source` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_events_event_key_unique` ON `bank_events` (`event_key`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`type` text NOT NULL,
	`reference` text NOT NULL,
	`raw_content` text NOT NULL,
	`parsed_json` text
);
--> statement-breakpoint
CREATE TABLE `exceptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`evidence_summary` text,
	`proposal` text,
	`review_status` text NOT NULL,
	`resolution` text
);
--> statement-breakpoint
CREATE TABLE `mismatches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`field` text NOT NULL,
	`invoice_value` text NOT NULL,
	`erp_value` text NOT NULL,
	`severity` text NOT NULL,
	`evidence` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`source_currency` text NOT NULL,
	`supplier` text NOT NULL,
	`state` text NOT NULL,
	`document_status` text NOT NULL,
	`approval_status` text NOT NULL,
	`exception_status` text NOT NULL,
	`bank_status` text NOT NULL,
	`maker_id` text,
	`correction_proposer_id` text,
	`investigated` integer DEFAULT false NOT NULL,
	`correction_drafted` integer DEFAULT false NOT NULL,
	`correction_reviewed` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
