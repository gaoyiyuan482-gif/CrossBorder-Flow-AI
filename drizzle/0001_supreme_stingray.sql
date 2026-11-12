CREATE TABLE `ai_recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`provider` text NOT NULL,
	`simulation` integer NOT NULL,
	`recommendation_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approval_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`approver_id` text NOT NULL,
	`decision` text NOT NULL,
	`previous_status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_entries_v2` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`previous_state` text NOT NULL,
	`next_state` text NOT NULL,
	`source` text NOT NULL,
	`result` text NOT NULL,
	`evidence_ref` text,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`verifier_id` text NOT NULL,
	`method` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`confirmed_account` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_snapshots` (
	`payment_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`scenario` text NOT NULL,
	`updated_at` text NOT NULL
);
