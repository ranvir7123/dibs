ALTER TABLE "jobs" ADD COLUMN "hold_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "paypal_account_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "paypal_verified" boolean;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "paypal_capture_id" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "people_paypal_account_unique" ON "people" USING btree ("paypal_account_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_refunded_not_negative" CHECK ("sales"."refunded_cents" >= 0);