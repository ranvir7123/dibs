/**
 * The ledger: every money move on the jobs one business posted, as plain rows
 * a table or chart can draw. Answers "where did my money go?".
 *
 * Read only. Every number comes from stored rows: money moves (with PayPal's
 * own references), results and shop sales. Nothing is estimated except the
 * "stopped" amount on a blocked row, and that is worked out with the same pay
 * sum the checker uses (see stoppedCents below).
 *
 * Only the poster's own jobs are read, so one business never sees another's money.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { earnedFor } from "../checkers/pay";
import type { JobCard, Measured, MoneyMoveStatus } from "../contract/types";
import { getDb } from "./client";
import { checks, claims, jobs, moneyMoves, people, results, sales } from "./schema";

/** locked: the hold was made. paid: taken from the hold for a result. released: the rest went back. blocked: a result failed a cheat check. refunded: a shop sale went back to its buyer. */
export type LedgerKind = "locked" | "paid" | "released" | "blocked" | "refunded";

/** One line of the ledger. Plain values only, so it can be handed to the browser as it is. */
export interface LedgerRow {
  id: string;
  /** When it happened, as an ISO date-time. */
  when: string;
  jobId: string;
  job: string;
  /** The worker it was about. Null for locked and released. */
  worker: string | null;
  kind: LedgerKind;
  /** What was measured, in words: "830 views", "4 of 5 rules". Null when nothing was. */
  measured: string | null;
  /** For per-unit pay: how many units this payment paid for (830), and their name ("views"). */
  units: number | null;
  unit: string | null;
  /** The size of this line in whole cents. For blocked: what was stopped from being paid. */
  amountCents: number;
  /** On a job's newest locked line: how much of the job's money is still held in PayPal now. 0 on every other line. */
  stillLockedCents: number;
  status: MoneyMoveStatus;
  /** PayPal's reference: the hold's for locked and released, the payout's for paid, the buyer's order for refunded. */
  paypalRef: string | null;
  /** For paid: PayPal's reference for taking the money out of the hold. */
  takeRef: string | null;
  /** One plain sentence on what this line is. */
  note: string;
}

export interface LedgerTotals {
  /** Still held in PayPal right now, across all jobs. */
  lockedNowCents: number;
  /** Taken from holds for results. */
  paidCents: number;
  /** Let go back to the business. */
  releasedCents: number;
  /** Stopped from being paid by cheat checks. */
  blockedCents: number;
  /** How many results were blocked. */
  blockedCount: number;
  /** Shop sales refunded to buyers. */
  refundedCents: number;
}

export interface Ledger {
  /** Newest first. */
  rows: LedgerRow[];
  totals: LedgerTotals;
  /** Jobs this business has posted, drafts included. */
  jobCount: number;
}

const EMPTY_TOTALS: LedgerTotals = { lockedNowCents: 0, paidCents: 0, releasedCents: 0, blockedCents: 0, blockedCount: 0, refundedCents: 0 };

const number = (value: number) => value.toLocaleString("en-US");

/** "830 views" when the unit name is already plural (pay per 1,000 views), "4 sales" for a one-word unit, "3 x bug we can repeat" for a longer one. */
function unitsInWords(units: number, unitLabel: string, batchSize: number): string {
  if (batchSize > 1 || units === 1) return `${number(units)} ${unitLabel}`;
  return /^[a-z]+$/i.test(unitLabel) && !unitLabel.endsWith("s") ? `${number(units)} ${unitLabel}s` : `${number(units)} x ${unitLabel}`;
}

/** What a payment of this size paid for, read back from the job's own pay rule. */
function paidFor(card: JobCard, measured: Measured, amountCents: number): Pick<LedgerRow, "measured" | "units" | "unit"> {
  const rule = card.payRule;
  if (rule.kind === "per_unit" && rule.centsPerBatch > 0) {
    const units = Math.round((amountCents * rule.batchSize) / rule.centsPerBatch);
    return { measured: unitsInWords(units, rule.unitLabel, rule.batchSize), units, unit: rule.unitLabel };
  }
  if (rule.kind === "per_rule") {
    const passed = measured.rulesPassed ?? 0;
    const total = measured.rulesTotal ?? rule.rules.length;
    return { measured: `${passed} of ${total} rules`, units: null, unit: null };
  }
  return { measured: "Finish line met", units: null, unit: null };
}

/**
 * What a blocked result was stopped from being paid: the pay its raw numbers
 * (cheat clicks included) would have earned at the job's own rate, never more
 * than the job's budget, minus what it had already been paid.
 */
export function stoppedCents(card: JobCard, measured: Measured, budgetCents: number, alreadyPaidCents: number): number {
  const raw: Measured = card.payRule.kind === "per_unit" && card.payRule.unit === "click" ? { ...measured, clicksReal: measured.clicksTotal ?? measured.clicksReal } : measured;
  return Math.max(0, Math.min(earnedFor(card, raw, false), budgetCents) - alreadyPaidCents);
}

/** What a blocked result claimed, in words: the number that tripped the check. */
function blockedMeasure(measured: Measured): string | null {
  if (measured.clicksTotal !== undefined && measured.clicksReal !== undefined && measured.clicksTotal > measured.clicksReal) {
    return `${number(measured.clicksTotal)} clicks, ${number(measured.clicksReal)} real`;
  }
  if (measured.views !== undefined) return `${number(measured.views)} views`;
  if (measured.clicksTotal !== undefined) return `${number(measured.clicksTotal)} clicks`;
  return null;
}

/** The ledger for one business. Empty for an unknown person or one who has posted nothing. */
export async function getLedger(posterId: string): Promise<Ledger> {
  const db = await getDb();
  const jobRows = await db.select().from(jobs).where(eq(jobs.posterId, posterId));
  if (jobRows.length === 0) return { rows: [], totals: EMPTY_TOTALS, jobCount: 0 };

  const jobIds = jobRows.map((j) => j.id);
  const jobFor = new Map(jobRows.map((j) => [j.id, j]));

  const [moves, resultRows, saleRows] = await Promise.all([
    db.select().from(moneyMoves).where(inArray(moneyMoves.jobId, jobIds)).orderBy(asc(moneyMoves.createdAt), asc(moneyMoves.id)),
    db.select().from(results).where(inArray(results.jobId, jobIds)),
    db.select().from(sales).where(inArray(sales.jobId, jobIds)),
  ]);
  const resultFor = new Map(resultRows.map((r) => [r.id, r]));

  const blocked = resultRows.filter((r) => r.status === "blocked");
  const refunded = saleRows.filter((s) => s.refundedCents > 0);
  const [failedChecks, saleClaims] = await Promise.all([
    blocked.length
      ? db
          .select()
          .from(checks)
          .where(
            inArray(
              checks.resultId,
              blocked.map((r) => r.id),
            ),
          )
          .orderBy(asc(checks.position), asc(checks.id))
      : Promise.resolve([]),
    refunded.length
      ? db
          .select()
          .from(claims)
          .where(inArray(claims.id, [...new Set(refunded.map((s) => s.claimId))]))
      : Promise.resolve([]),
  ]);
  const workerOfClaim = new Map(saleClaims.map((c) => [c.id, c.workerId]));

  const personIds = [...new Set([...resultRows.map((r) => r.workerId), ...moves.flatMap((m) => (m.personId ? [m.personId] : [])), ...workerOfClaim.values()])];
  const nameRows = personIds.length ? await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, personIds)) : [];
  const nameOf = new Map(nameRows.map((p) => [p.id, p.name]));

  const rows: LedgerRow[] = [];
  const totals: LedgerTotals = { ...EMPTY_TOTALS };

  // Each "take" (money leaving the hold) is one payment. Its payout (money
  // reaching the worker) is the payout with the same place in line for the
  // same result: the money lane always writes them as a pair, take first.
  const payoutsFor = new Map<string, typeof moves>();
  for (const move of moves) {
    if (move.kind !== "payout" || !move.resultId) continue;
    const list = payoutsFor.get(move.resultId);
    if (list) list.push(move);
    else payoutsFor.set(move.resultId, [move]);
  }
  const takesSeen = new Map<string, number>();
  const paidForResult = new Map<string, number>();
  const heldForJob = new Map<string, number>();

  for (const move of moves) {
    const job = jobFor.get(move.jobId)!;
    const base = { id: move.id, when: move.createdAt.toISOString(), jobId: job.id, job: job.title, amountCents: move.amountCents, stillLockedCents: 0, status: move.status };
    if (move.status === "done" && move.kind !== "payout") heldForJob.set(job.id, (heldForJob.get(job.id) ?? 0) + (move.kind === "hold" ? move.amountCents : -move.amountCents));
    const done = move.status === "done";

    if (move.kind === "hold") {
      if (done) totals.lockedNowCents += move.amountCents;
      rows.push({ ...base, worker: null, kind: "locked", measured: null, units: null, unit: null, paypalRef: move.paypalRef, takeRef: null, note: "The job's full budget was locked in PayPal." });
    } else if (move.kind === "let_go") {
      if (done) {
        totals.lockedNowCents -= move.amountCents;
        totals.releasedCents += move.amountCents;
      }
      rows.push({ ...base, worker: null, kind: "released", measured: null, units: null, unit: null, paypalRef: move.paypalRef, takeRef: null, note: "The job ended, so the rest of the hold went back to you." });
    } else if (move.kind === "take") {
      const result = move.resultId ? resultFor.get(move.resultId) : undefined;
      const place = move.resultId ? (takesSeen.get(move.resultId) ?? 0) : 0;
      if (move.resultId) takesSeen.set(move.resultId, place + 1);
      const payout = move.resultId ? payoutsFor.get(move.resultId)?.[place] : undefined;
      if (done) {
        totals.lockedNowCents -= move.amountCents;
        totals.paidCents += move.amountCents;
        if (move.resultId) paidForResult.set(move.resultId, (paidForResult.get(move.resultId) ?? 0) + move.amountCents);
      }
      const worker = nameOf.get(move.personId ?? result?.workerId ?? "") ?? null;
      const sent = !payout ? "Sending it to the worker has not started yet." : payout.status === "done" ? "PayPal sent it to the worker." : payout.status === "pending" ? "It is on its way to the worker." : "PayPal could not send it to the worker yet. It will be tried again.";
      rows.push({
        ...base,
        worker,
        kind: "paid",
        ...(result ? paidFor(job.card, result.measured, move.amountCents) : { measured: null, units: null, unit: null }),
        paypalRef: payout?.paypalRef ?? null,
        takeRef: move.paypalRef,
        note: move.status === "failed" ? (move.error ?? "PayPal could not take this from the hold.") : `Taken from the hold for a result that passed its checks. ${sent}`,
      });
    }
    // Payouts are not lines of their own: each is shown on its payment line.
  }

  for (const result of blocked) {
    const job = jobFor.get(result.jobId)!;
    const stopped = stoppedCents(job.card, result.measured, job.budgetCents, paidForResult.get(result.id) ?? 0);
    const failed = failedChecks.find((c) => c.resultId === result.id && !c.passed);
    totals.blockedCents += stopped;
    totals.blockedCount += 1;
    rows.push({
      id: `blocked:${result.id}`,
      when: (result.lastCheckedAt ?? result.handedInAt).toISOString(),
      jobId: job.id,
      job: job.title,
      worker: nameOf.get(result.workerId) ?? null,
      kind: "blocked",
      measured: blockedMeasure(result.measured),
      units: null,
      unit: null,
      amountCents: stopped,
      stillLockedCents: 0,
      status: "done",
      paypalRef: null,
      takeRef: null,
      note: `${failed?.headline ?? failed?.label ?? "A cheat check failed"}. Nothing more is paid for this result.`,
    });
  }

  for (const sale of refunded) {
    const job = jobFor.get(sale.jobId)!;
    totals.refundedCents += sale.refundedCents;
    rows.push({
      id: `refunded:${sale.id}`,
      when: (sale.refundedAt ?? sale.at).toISOString(),
      jobId: job.id,
      job: job.title,
      worker: nameOf.get(workerOfClaim.get(sale.claimId) ?? "") ?? null,
      kind: "refunded",
      measured: sale.refundedCents >= sale.amountCents ? "1 sale, all of it refunded" : "1 sale, part of it refunded",
      units: null,
      unit: null,
      amountCents: sale.refundedCents,
      stillLockedCents: 0,
      status: "done",
      paypalRef: sale.paypalOrderId,
      takeRef: null,
      note: sale.refundedCents >= sale.amountCents ? "A shop sale went back to its buyer, so it earns no commission." : "Part of a shop sale went back to its buyer.",
    });
  }

  // What is still held is shown once per job, on its newest lock (moves were read oldest first).
  for (const [jobId, held] of heldForJob) {
    const lock = rows.findLast((row) => row.jobId === jobId && row.kind === "locked" && row.status === "done");
    if (lock) lock.stillLockedCents = Math.max(0, held);
  }

  rows.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : a.id < b.id ? 1 : -1));
  return { rows, totals, jobCount: jobRows.length };
}
