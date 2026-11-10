/**
 * The database tables. Each table's columns mirror a shape in
 * src/contract/types.ts (src/db/schema.check.ts makes the type checker prove it).
 * Money columns are whole cents in integer columns.
 *
 * After changing this file run: npm run db:generate, then npm run db:migrate.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  CheckGroup,
  ClaimStatus,
  HandInKind,
  JobCard,
  JobCategory,
  JobStatus,
  Measured,
  MoneyMoveKind,
  MoneyMoveStatus,
  ResultStatus,
} from "../contract/types";

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const people = pgTable(
  "people",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    paypalEmail: text("paypal_email").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("people_paypal_email_unique").on(t.paypalEmail)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    posterId: text("poster_id")
      .notNull()
      .references(() => people.id),
    sentence: text("sentence").notNull(),
    title: text("title").notNull(),
    category: text("category").$type<JobCategory>().notNull(),
    card: jsonb("card").$type<JobCard>().notNull(),
    budgetCents: integer("budget_cents").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("draft"),
    endsAt: time("ends_at").notNull(),
    paypalOrderId: text("paypal_order_id"),
    paypalAuthorizationId: text("paypal_authorization_id"),
    createdAt: time("created_at").notNull().defaultNow(),
    endedAt: time("ended_at"),
  },
  (t) => [
    index("jobs_status_idx").on(t.status),
    check("jobs_budget_positive", sql`${t.budgetCents} > 0`),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    workerId: text("worker_id")
      .notNull()
      .references(() => people.id),
    status: text("status").$type<ClaimStatus>().notNull().default("open"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("claims_job_worker_unique").on(t.jobId, t.workerId),
    index("claims_worker_idx").on(t.workerId),
  ],
);

export const results = pgTable(
  "results",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    workerId: text("worker_id")
      .notNull()
      .references(() => people.id),
    handInKind: text("hand_in_kind").$type<HandInKind>().notNull(),
    handInUrl: text("hand_in_url"),
    handInFile: text("hand_in_file"),
    handedInAt: time("handed_in_at").notNull().defaultNow(),
    status: text("status").$type<ResultStatus>().notNull().default("checking"),
    measured: jsonb("measured").$type<Measured>().notNull().default({}),
    earnedCents: integer("earned_cents").notNull().default(0),
    summary: text("summary"),
    watchLabel: text("watch_label"),
    watchNote: text("watch_note"),
    watchOk: boolean("watch_ok"),
    lastCheckedAt: time("last_checked_at"),
    nextCheckAt: time("next_check_at"),
    objectionEndsAt: time("objection_ends_at"),
    objectedAt: time("objected_at"),
  },
  (t) => [
    uniqueIndex("results_claim_unique").on(t.claimId),
    index("results_job_idx").on(t.jobId),
    index("results_next_check_idx").on(t.nextCheckAt),
    check("results_earned_not_negative", sql`${t.earnedCents} >= 0`),
  ],
);

export const checks = pgTable(
  "checks",
  {
    id: text("id").primaryKey(),
    resultId: text("result_id")
      .notNull()
      .references(() => results.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    group: text("group").$type<CheckGroup>().notNull(),
    label: text("label").notNull(),
    passed: boolean("passed").notNull(),
    passedCount: integer("passed_count").notNull(),
    totalCount: integer("total_count").notNull(),
    reason: text("reason").notNull(),
    headline: text("headline"),
    seenAtSeconds: integer("seen_at_seconds"),
    position: integer("position").notNull().default(0),
    ranAt: time("ran_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("checks_result_key_unique").on(t.resultId, t.key)],
);

export const readings = pgTable(
  "readings",
  {
    id: text("id").primaryKey(),
    resultId: text("result_id")
      .notNull()
      .references(() => results.id, { onDelete: "cascade" }),
    at: time("at").notNull().defaultNow(),
    views: integer("views"),
    likes: integer("likes"),
    comments: integer("comments"),
    clicksTotal: integer("clicks_total"),
    clicksReal: integer("clicks_real"),
  },
  (t) => [index("readings_result_at_idx").on(t.resultId, t.at)],
);

export const moneyMoves = pgTable(
  "money_moves",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    resultId: text("result_id").references(() => results.id),
    personId: text("person_id").references(() => people.id),
    kind: text("kind").$type<MoneyMoveKind>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    status: text("status").$type<MoneyMoveStatus>().notNull().default("pending"),
    paypalRef: text("paypal_ref"),
    note: text("note").notNull().default(""),
    error: text("error"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("money_moves_job_idx").on(t.jobId),
    index("money_moves_result_idx").on(t.resultId),
    index("money_moves_person_idx").on(t.personId),
    check("money_moves_amount_not_negative", sql`${t.amountCents} >= 0`),
    check("money_moves_fee_not_negative", sql`${t.feeCents} >= 0`),
  ],
);

export const trackedLinks = pgTable(
  "tracked_links",
  {
    code: text("code").primaryKey(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    targetUrl: text("target_url").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tracked_links_claim_unique").on(t.claimId)],
);

export const clicks = pgTable(
  "clicks",
  {
    id: text("id").primaryKey(),
    linkCode: text("link_code")
      .notNull()
      .references(() => trackedLinks.code),
    at: time("at").notNull().defaultNow(),
    visitorKey: text("visitor_key").notNull(),
    counted: boolean("counted").notNull().default(true),
    leftOutReason: text("left_out_reason"),
  },
  (t) => [index("clicks_link_at_idx").on(t.linkCode, t.at)],
);

export const sales = pgTable(
  "sales",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id),
    linkCode: text("link_code")
      .notNull()
      .references(() => trackedLinks.code),
    paypalOrderId: text("paypal_order_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    at: time("at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_paypal_order_unique").on(t.paypalOrderId),
    index("sales_claim_idx").on(t.claimId),
    check("sales_amount_not_negative", sql`${t.amountCents} >= 0`),
  ],
);
