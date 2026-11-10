CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"result_id" text NOT NULL,
	"key" text NOT NULL,
	"group" text NOT NULL,
	"label" text NOT NULL,
	"passed" boolean NOT NULL,
	"passed_count" integer NOT NULL,
	"total_count" integer NOT NULL,
	"reason" text NOT NULL,
	"headline" text,
	"seen_at_seconds" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clicks" (
	"id" text PRIMARY KEY NOT NULL,
	"link_code" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"visitor_key" text NOT NULL,
	"counted" boolean DEFAULT true NOT NULL,
	"left_out_reason" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"poster_id" text NOT NULL,
	"sentence" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"card" jsonb NOT NULL,
	"budget_cents" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"paypal_order_id" text,
	"paypal_authorization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "jobs_budget_positive" CHECK ("jobs"."budget_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "money_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"result_id" text,
	"person_id" text,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paypal_ref" text,
	"note" text DEFAULT '' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_moves_amount_not_negative" CHECK ("money_moves"."amount_cents" >= 0),
	CONSTRAINT "money_moves_fee_not_negative" CHECK ("money_moves"."fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"paypal_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" text PRIMARY KEY NOT NULL,
	"result_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"clicks_total" integer,
	"clicks_real" integer
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"job_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"hand_in_kind" text NOT NULL,
	"hand_in_url" text,
	"hand_in_file" text,
	"handed_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'checking' NOT NULL,
	"measured" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"earned_cents" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"watch_label" text,
	"watch_note" text,
	"watch_ok" boolean,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"objection_ends_at" timestamp with time zone,
	"objected_at" timestamp with time zone,
	CONSTRAINT "results_earned_not_negative" CHECK ("results"."earned_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"link_code" text NOT NULL,
	"paypal_order_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_amount_not_negative" CHECK ("sales"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tracked_links" (
	"code" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"job_id" text NOT NULL,
	"target_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_worker_id_people_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_link_code_tracked_links_code_fk" FOREIGN KEY ("link_code") REFERENCES "public"."tracked_links"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_poster_id_people_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_moves" ADD CONSTRAINT "money_moves_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_moves" ADD CONSTRAINT "money_moves_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_moves" ADD CONSTRAINT "money_moves_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_worker_id_people_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_link_code_tracked_links_code_fk" FOREIGN KEY ("link_code") REFERENCES "public"."tracked_links"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_links" ADD CONSTRAINT "tracked_links_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checks_result_key_unique" ON "checks" USING btree ("result_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_job_worker_unique" ON "claims" USING btree ("job_id","worker_id");--> statement-breakpoint
CREATE INDEX "claims_worker_idx" ON "claims" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "clicks_link_at_idx" ON "clicks" USING btree ("link_code","at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "money_moves_job_idx" ON "money_moves" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "money_moves_result_idx" ON "money_moves" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "money_moves_person_idx" ON "money_moves" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_paypal_email_unique" ON "people" USING btree ("paypal_email");--> statement-breakpoint
CREATE INDEX "readings_result_at_idx" ON "readings" USING btree ("result_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "results_claim_unique" ON "results" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "results_job_idx" ON "results" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "results_next_check_idx" ON "results" USING btree ("next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_paypal_order_unique" ON "sales" USING btree ("paypal_order_id");--> statement-breakpoint
CREATE INDEX "sales_claim_idx" ON "sales" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_links_claim_unique" ON "tracked_links" USING btree ("claim_id");