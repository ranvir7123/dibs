/**
 * Lane A: money. Every PayPal call lives in this folder (in ./paypal.ts).
 * The names, inputs and outputs of the five functions below are agreed in
 * docs/CONTRACT.md and must not change.
 *
 * How every money move is made safe:
 *   1. In one short database transaction, lock the row, work out the amount
 *      and write the money move as "pending".
 *   2. End the transaction. Only then call PayPal.
 *   3. Mark the move "done" (with PayPal's reference) or "failed" (with why).
 * Each move's own id is sent to PayPal as the request's id, so asking twice
 * can never move money twice. If PayPal could not be reached, nobody knows
 * whether it happened: the move stays "pending" and is asked again later with
 * the same id.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { formatCents, isCents } from "../contract/money";
import type { HoldStart, MoneyMove, PayOutcome, Sale } from "../contract/types";
import { getDb } from "../db/client";
import { newId } from "../db/ids";
import { claims, jobs, moneyMoves, people, results, sales, trackedLinks } from "../db/schema";
import { settings } from "../settings";
import { getPayPal, JOB_LABEL, PayPalProblem, type PayPalPayout } from "./paypal";
import { siteBase } from "./site";

/** Waiting times, kept in one place so tests can shorten them. */
export const moneyTiming = {
  /** How long payWorker waits for PayPal to finish a payout before leaving it "pending". PayPal usually needs about 17 seconds. */
  payoutWaitMs: 40_000,
  /** How often PayPal is asked whether the payout has finished. */
  payoutLookEveryMs: 2_000,
  /** A "pending" move older than this was left behind by a stopped program and is picked up again. */
  staleAfterMs: 120_000,
};

/**
 * A plain "no" with a sentence a person can read (unknown job, not approved
 * yet, job not open). Trying the same thing again would give the same answer.
 * Anything else that goes wrong is a fault worth another try.
 */
export class MoneyRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyRefusal";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sum = (moves: { amountCents: number }[]) => moves.reduce((total, m) => total + m.amountCents, 0);
const counts = (m: { status: string }) => m.status === "done" || m.status === "pending";
const NOTHING: PayOutcome = { paidCents: 0, take: null, payout: null };

/** True when nobody can know whether PayPal did the thing: it could not be reached, or it broke while answering. */
function unknownOutcome(error: unknown): boolean {
  return !(error instanceof PayPalProblem) || error.status === 0 || error.status >= 500;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function setMove(id: string, values: Partial<typeof moneyMoves.$inferInsert>): Promise<MoneyMove> {
  const db = await getDb();
  return (await db.update(moneyMoves).set(values).where(eq(moneyMoves.id, id)).returning())[0];
}

// ---------------------------------------------------------------- the hold

/**
 * Starts the hold for a draft job's full budget and returns PayPal's approval
 * page for the poster. Saves PayPal's order number on the job.
 */
export async function startHold(jobId: string): Promise<HoldStart> {
  const db = await getDb();
  const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0];
  if (!job) throw new MoneyRefusal("No such job.");
  if (job.status !== "draft") throw new MoneyRefusal("This job's money is already locked.");
  const base = siteBase();
  const returnUrl = `${base}/api/paypal/hold/return?job=${encodeURIComponent(job.id)}`;
  const paypal = getPayPal();

  // Asked before? Use the same PayPal order while it is still good, so
  // pressing the button twice cannot make two holds.
  if (job.paypalOrderId) {
    try {
      const order = await paypal.getOrder(job.paypalOrderId);
      if (order.approveUrl && (order.status === "PAYER_ACTION_REQUIRED" || order.status === "CREATED")) {
        return { paypalOrderId: order.id, approveUrl: order.approveUrl };
      }
      // Already approved: nothing more to do on PayPal, go straight to locking it.
      const holdAlive = order.authorization?.status === "CREATED" || order.authorization?.status === "PARTIALLY_CAPTURED";
      if (order.status === "APPROVED" || (order.status === "COMPLETED" && holdAlive)) return { paypalOrderId: order.id, approveUrl: returnUrl };
      // Otherwise the old order is of no use any more (its hold ran out or was let go): make a new one below.
    } catch (error) {
      if (unknownOutcome(error)) throw error; // PayPal is down: do not make a second order blindly
    }
  }

  const order = await paypal.createHoldOrder({
    requestId: `hold-${job.id}-${randomBytes(6).toString("hex")}`,
    amountCents: job.budgetCents,
    description: `Dibs job: ${job.title}`,
    customId: JOB_LABEL + job.id,
    returnUrl,
    cancelUrl: `${base}/api/paypal/hold/cancel?job=${encodeURIComponent(job.id)}`,
  });
  if (!order.approveUrl) throw new MoneyRefusal("PayPal did not give a page to approve the hold on.");
  await db.update(jobs).set({ paypalOrderId: order.id }).where(eq(jobs.id, job.id));
  return { paypalOrderId: order.id, approveUrl: order.approveUrl };
}

/**
 * Finishes the hold after the poster approved it on PayPal: locks the money,
 * records a "hold" money move and opens the job. Safe to call twice.
 */
export async function confirmHold(jobId: string): Promise<MoneyMove> {
  const db = await getDb();
  const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0];
  if (!job) throw new MoneyRefusal("No such job.");
  const holdMove = async (from: Pick<typeof db, "select"> = db) =>
    (await from.select().from(moneyMoves).where(and(eq(moneyMoves.jobId, jobId), eq(moneyMoves.kind, "hold"), eq(moneyMoves.status, "done"))))[0];
  const already = await holdMove();
  if (already) return already;
  if (!job.paypalOrderId) throw new MoneyRefusal("This job's hold has not been started yet.");

  const paypal = getPayPal();
  let order = await paypal.getOrder(job.paypalOrderId);
  if (order.customId !== JOB_LABEL + job.id || order.amountCents !== job.budgetCents || order.currency !== settings.currency) {
    throw new MoneyRefusal("PayPal's order does not match this job, so nothing was locked.");
  }
  if (!order.authorization && order.status === "APPROVED") {
    try {
      order = await paypal.authorizeOrder(order.id, `authorize-${order.id}`);
    } catch (error) {
      // Two calls at once: the other one got there first. Read what it made.
      if (error instanceof PayPalProblem && error.issues.includes("ORDER_ALREADY_AUTHORIZED")) order = await paypal.getOrder(order.id);
      else throw error;
    }
  }
  const hold = order.authorization;
  if (!hold) throw new MoneyRefusal("The hold has not been approved on PayPal yet.");
  if (hold.status !== "CREATED" && hold.status !== "PARTIALLY_CAPTURED") {
    throw new MoneyRefusal(`PayPal did not hold the money (it says ${hold.status}).`);
  }
  if (hold.amountCents !== job.budgetCents) throw new MoneyRefusal("PayPal held a different amount than the job's budget, so the job was not opened.");

  return db.transaction(async (tx) => {
    const locked = (await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update"))[0];
    const existing = await holdMove(tx);
    if (existing) return existing;
    const move = (
      await tx
        .insert(moneyMoves)
        .values({
          id: newId("mov"),
          jobId,
          personId: locked.posterId,
          kind: "hold",
          amountCents: locked.budgetCents,
          currency: settings.currency,
          status: "done",
          paypalRef: hold.id,
          note: `${formatCents(locked.budgetCents)} held for "${locked.title}"`,
        })
        .returning()
    )[0];
    await tx.update(jobs).set({ status: "open", paypalAuthorizationId: hold.id }).where(and(eq(jobs.id, jobId), eq(jobs.status, "draft")));
    return move;
  });
}

// ---------------------------------------------------------------- paying a worker

type Finish = { status: "done" | "failed" | "pending"; paypalRef?: string; error: string | null };

/** What a payout's row should become, from what PayPal says about it. */
function payoutFinish(info: PayPalPayout): Finish {
  const item = info.itemStatus;
  if (item === "SUCCESS") return { status: "done", paypalRef: info.transactionId ?? info.itemId ?? info.batchId, error: null };
  if (item === "UNCLAIMED") {
    // The money was sent. PayPal keeps it for 30 days until someone opens an account with that email.
    return { status: "done", paypalRef: info.itemId ?? info.batchId, error: "Sent, but no PayPal account uses this email yet. PayPal holds it for 30 days for the worker to collect." };
  }
  const ended = item === "FAILED" || item === "RETURNED" || item === "BLOCKED" || item === "REFUNDED" || item === "REVERSED" || info.batchStatus === "DENIED" || info.batchStatus === "CANCELED";
  if (ended) return { status: "failed", error: `PayPal did not deliver the payout (${item ?? info.batchStatus}${info.problem ? `: ${info.problem}` : ""}).` };
  return { status: "pending", paypalRef: info.batchId, error: null };
}

/** Writes a payout's outcome and, when the money went out, marks the result paid. */
async function finishPayout(move: MoneyMove, finish: Finish): Promise<MoneyMove> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const updated = (
      await tx
        .update(moneyMoves)
        .set({ status: finish.status, error: finish.error, ...(finish.paypalRef ? { paypalRef: finish.paypalRef } : {}) })
        .where(and(eq(moneyMoves.id, move.id), eq(moneyMoves.status, "pending")))
        .returning()
    )[0];
    if (!updated) return (await tx.select().from(moneyMoves).where(eq(moneyMoves.id, move.id)))[0]; // someone else finished it
    if (finish.status === "done" && move.resultId) {
      // A blocked result stays blocked: lane B decided that.
      await tx.update(results).set({ status: "paid" }).where(and(eq(results.id, move.resultId), inArray(results.status, ["checking", "waiting", "paid"])));
    }
    return updated;
  });
}

/** Asks PayPal about a payout until it has finished or the wait is over. */
async function watchPayout(move: MoneyMove, batchId: string, waitMs: number): Promise<MoneyMove> {
  const paypal = getPayPal();
  const started = Date.now();
  for (;;) {
    let finish: Finish;
    try {
      finish = payoutFinish(await paypal.getPayout(batchId));
    } catch {
      // Could not look it up right now. The money may have moved, so it stays "pending" and is looked up again later.
      finish = { status: "pending", error: null };
    }
    if (finish.status !== "pending") return finishPayout(move, finish);
    if (Date.now() - started >= waitMs) return move;
    await sleep(moneyTiming.payoutLookEveryMs);
  }
}

/** Sends a payout row to PayPal and waits for it. The row's own id is PayPal's batch id, so it can only ever be sent once. */
async function sendPayout(move: MoneyMove, email: string): Promise<MoneyMove> {
  let info: PayPalPayout;
  try {
    info = await getPayPal().sendPayout({ batchId: move.id, email, amountCents: move.amountCents, note: move.note, subject: "You have been paid by Dibs (test mode)" });
  } catch (error) {
    if (unknownOutcome(error)) return setMove(move.id, { error: `Not known yet whether PayPal sent this: ${reason(error)}` });
    return finishPayout(move, { status: "failed", error: reason(error) });
  }
  const sent = await setMove(move.id, { paypalRef: info.batchId, error: null });
  const finish = payoutFinish(info);
  if (finish.status !== "pending") return finishPayout(sent, finish);
  return watchPayout(sent, info.batchId, moneyTiming.payoutWaitMs);
}

/** Takes a take row's amount from the hold. Asking again with the same row is safe: PayPal answers with the first result. */
async function sendTake(move: MoneyMove, authorizationId: string): Promise<{ take: MoneyMove; payout: MoneyMove | null }> {
  let captureId: string;
  try {
    const capture = await getPayPal().takeFromHold({ authorizationId, requestId: move.id, amountCents: move.amountCents, invoiceId: move.id, note: move.note });
    if (capture.status === "DECLINED" || capture.status === "FAILED") {
      return { take: await setMove(move.id, { status: "failed", paypalRef: capture.id, error: `PayPal did not take the money (it says ${capture.status}).` }), payout: null };
    }
    if (capture.status !== "COMPLETED") {
      // PayPal is still deciding. Nothing is sent to the worker until the money has really been taken.
      return { take: await setMove(move.id, { paypalRef: capture.id, error: `PayPal has not finished taking this yet (it says ${capture.status}).` }), payout: null };
    }
    captureId = capture.id;
  } catch (error) {
    // "Duplicate" means PayPal already has a take with this row's invoice number: it may well
    // have gone through, so it must never be marked failed (that would allow a second take).
    const maybeTaken = error instanceof PayPalProblem && error.issues.some((i) => i.startsWith("DUPLICATE"));
    if (maybeTaken) return { take: await setMove(move.id, { error: "PayPal says a take with this number already exists. A person needs to look at it in PayPal." }), payout: null };
    if (unknownOutcome(error)) return { take: await setMove(move.id, { error: `Not known yet whether PayPal took this: ${reason(error)}` }), payout: null };
    return { take: await setMove(move.id, { status: "failed", error: reason(error) }), payout: null };
  }
  // The take becomes "done" and its payout appears as "pending" in the same
  // moment, so no other call can ever see a finished take with no payout on
  // its way and send a second one.
  const db = await getDb();
  return db.transaction(async (tx) => {
    const take = (await tx.update(moneyMoves).set({ status: "done", paypalRef: captureId, error: null }).where(and(eq(moneyMoves.id, move.id), eq(moneyMoves.status, "pending"))).returning())[0];
    if (!take) return { take: (await tx.select().from(moneyMoves).where(eq(moneyMoves.id, move.id)))[0], payout: null }; // someone else finished it
    const payout = (
      await tx
        .insert(moneyMoves)
        .values({ id: newId("mov"), jobId: take.jobId, resultId: take.resultId, personId: take.personId, kind: "payout", amountCents: take.amountCents - take.feeCents, feeCents: take.feeCents, currency: take.currency, status: "pending", note: take.note })
        .returning()
    )[0];
    return { take, payout };
  });
}

/**
 * Picks up "pending" moves for a result. A payout PayPal already has is looked
 * up (at any age). A take or payout that never got PayPal's answer is asked
 * again with its own id, once it is old enough that no running call owns it.
 */
async function settlePending(resultId: string): Promise<MoneyMove[]> {
  const db = await getDb();
  const pending = await db.select().from(moneyMoves).where(and(eq(moneyMoves.resultId, resultId), eq(moneyMoves.status, "pending")));
  const settled: MoneyMove[] = [];
  for (const move of pending) {
    const stale = Date.now() - move.createdAt.getTime() > moneyTiming.staleAfterMs;
    if (move.kind === "payout" && move.paypalRef) {
      settled.push(await watchPayout(move, move.paypalRef, 0));
    } else if (move.kind === "payout" && stale && move.personId) {
      const worker = (await db.select().from(people).where(eq(people.id, move.personId)))[0];
      try {
        settled.push(await sendPayout(move, worker.paypalEmail));
      } catch (error) {
        settled.push(await setMove(move.id, { error: reason(error) }));
      }
    } else if (move.kind === "take" && stale) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, move.jobId)))[0];
      if (!job.paypalAuthorizationId || !move.personId) continue;
      const { take, payout } = await sendTake(move, job.paypalAuthorizationId);
      settled.push(take);
      if (payout) {
        const worker = (await db.select().from(people).where(eq(people.id, move.personId)))[0];
        settled.push(await sendPayout(payout, worker.paypalEmail));
      }
    }
  }
  return settled;
}

/**
 * Pays a worker what their result has earned and not yet been paid.
 * Owed = result.earnedCents minus this result's "take" moves that are done or
 * pending (never below 0, never more than is still held). Takes that part of
 * the hold, then sends it to the worker's PayPal email. If an earlier take
 * went through but its payout did not, sends that payout again instead of
 * taking again. Two calls at once must not both pay: lock the result's row,
 * work out what is owed and write the take as "pending" in one short
 * transaction, and only then call PayPal. Safe to call twice.
 * The full rules are in docs/CONTRACT.md, section 4.
 */
export async function payWorker(resultId: string): Promise<PayOutcome> {
  const db = await getDb();
  const first = (await db.select().from(results).where(eq(results.id, resultId)))[0];
  if (!first) throw new MoneyRefusal("No such result.");

  // A payout that finished since the last call counts as paid by this call.
  const settled = await settlePending(resultId);
  const settledPayout = settled.find((m) => m.kind === "payout" && m.status === "done") ?? null;

  // The one short transaction: lock, work out, write "pending".
  const plan = await db.transaction(async (tx) => {
    const job = (await tx.select().from(jobs).where(eq(jobs.id, first.jobId)).for("update"))[0];
    const result = (await tx.select().from(results).where(eq(results.id, resultId)).for("update"))[0];
    const worker = (await tx.select().from(people).where(eq(people.id, result.workerId)))[0];
    const jobMoves = await tx.select().from(moneyMoves).where(eq(moneyMoves.jobId, job.id));
    const mine = jobMoves.filter((m) => m.resultId === resultId);
    const myTakes = mine.filter((m) => m.kind === "take");
    const myPayouts = mine.filter((m) => m.kind === "payout");

    // Something for this result is still on its way to PayPal: do not start another.
    if (mine.some((m) => m.status === "pending")) return null;

    // A take that went through whose money has not reached the worker: send that, take nothing.
    const reachedHold = sum(myTakes.filter((m) => m.status === "done").map((m) => ({ amountCents: m.amountCents - m.feeCents })));
    const unsent = reachedHold - sum(myPayouts.filter(counts));
    if (unsent > 0) {
      const payout = (
        await tx
          .insert(moneyMoves)
          .values({ id: newId("mov"), jobId: job.id, resultId, personId: worker.id, kind: "payout", amountCents: unsent, currency: settings.currency, status: "pending", note: payNote(job.title, unsent, result.earnedCents) })
          .returning()
      )[0];
      return { job, worker, take: null, payout };
    }

    if (job.status !== "open" || !job.paypalAuthorizationId) return null;
    if (result.status === "blocked" || result.objectedAt) return null;
    if (jobMoves.some((m) => m.kind === "let_go" && counts(m))) return null;

    const held = job.budgetCents - sum(jobMoves.filter((m) => m.kind === "take" && counts(m)));
    const owed = Math.min(Math.max(0, result.earnedCents - sum(myTakes.filter(counts))), Math.max(0, held));
    if (owed <= 0) return null;
    const fee = settings.feeTakenFromPayouts ? Math.round((owed * settings.feePercent) / 100) : 0;
    const take = (
      await tx
        .insert(moneyMoves)
        .values({ id: newId("mov"), jobId: job.id, resultId, personId: worker.id, kind: "take", amountCents: owed, feeCents: fee, currency: settings.currency, status: "pending", note: payNote(job.title, owed - fee, result.earnedCents) })
        .returning()
    )[0];
    return { job, worker, take, payout: null };
  });

  if (!plan) return settledPayout ? { paidCents: settledPayout.amountCents, take: null, payout: settledPayout } : NOTHING;

  let take: MoneyMove | null = plan.take;
  let payout: MoneyMove | null = plan.payout;
  if (take) {
    ({ take, payout } = await sendTake(take, plan.job.paypalAuthorizationId!));
    if (!payout) return { paidCents: 0, take, payout: null };
  }
  payout = await sendPayout(payout!, plan.worker.paypalEmail);
  return { paidCents: payout.status === "done" ? payout.amountCents : 0, take, payout };
}

function payNote(jobTitle: string, amountCents: number, earnedCents: number): string {
  const title = jobTitle.length > 80 ? `${jobTitle.slice(0, 77)}...` : jobTitle;
  return `Dibs paid you ${formatCents(amountCents)} for "${title}". Earned on this job so far: ${formatCents(earnedCents)}. Test mode: pretend money.`;
}

/**
 * For PayPal's message that a payout finished: looks the payout up and writes
 * its outcome. The id is our own money move's id (sent to PayPal as the batch
 * and item id). Returns null when there is nothing waiting under that id.
 */
export async function settlePayout(moveId: string): Promise<MoneyMove | null> {
  const db = await getDb();
  const move = (await db.select().from(moneyMoves).where(and(eq(moneyMoves.id, moveId), eq(moneyMoves.kind, "payout"), eq(moneyMoves.status, "pending"))))[0];
  if (!move?.paypalRef) return null;
  return watchPayout(move, move.paypalRef, 0);
}

// ---------------------------------------------------------------- letting the rest go

/**
 * Lets the rest of a job's hold go back to the poster, records a "let_go"
 * money move, marks the job ended and closes its claims. Safe to call twice.
 */
export async function letGo(jobId: string): Promise<MoneyMove> {
  const db = await getDb();
  const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0];
  if (!job) throw new MoneyRefusal("No such job.");
  const letGoMoves = async (from: Pick<typeof db, "select"> = db) => from.select().from(moneyMoves).where(and(eq(moneyMoves.jobId, jobId), eq(moneyMoves.kind, "let_go")));
  const done = (await letGoMoves()).find((m) => m.status === "done");
  if (done) return done;
  if (job.status !== "open" || !job.paypalAuthorizationId) throw new MoneyRefusal("This job has no money held, so there is nothing to let go.");
  const authorizationId = job.paypalAuthorizationId;

  // Takes and payouts left "pending" by a stopped program are finished first, so the amount let go is right and no worker is left unpaid.
  const waiting = await db.select().from(moneyMoves).where(and(eq(moneyMoves.jobId, jobId), eq(moneyMoves.status, "pending")));
  for (const resultId of new Set(waiting.map((m) => m.resultId).filter((id): id is string => !!id))) await settlePending(resultId);

  const move = await db.transaction(async (tx) => {
    const locked = (await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update"))[0];
    const moves = await tx.select().from(moneyMoves).where(eq(moneyMoves.jobId, jobId));
    const mine = moves.filter((m) => m.kind === "let_go" && counts(m))[0];
    if (mine) return mine; // done by a call at the same moment, or a "pending" one to try again
    if (moves.some((m) => m.kind === "take" && m.status === "pending")) {
      throw new MoneyRefusal("A payment on this job is still going through. Try letting the rest go again in a minute.");
    }
    const rest = locked.budgetCents - sum(moves.filter((m) => m.kind === "take" && m.status === "done"));
    return (
      await tx
        .insert(moneyMoves)
        .values({ id: newId("mov"), jobId, personId: locked.posterId, kind: "let_go", amountCents: Math.max(0, rest), currency: settings.currency, status: "pending", note: `${formatCents(Math.max(0, rest))} not earned on "${locked.title}", let go back to the poster` })
        .returning()
    )[0];
  });
  if (move.status === "done") return move;

  if (move.amountCents > 0) {
    try {
      await getPayPal().voidHold(authorizationId);
    } catch (error) {
      // Letting go twice is harmless at PayPal, so a failure here can simply be tried again.
      await db.update(moneyMoves).set({ status: "failed", error: reason(error) }).where(and(eq(moneyMoves.id, move.id), eq(moneyMoves.status, "pending")));
      throw new Error(`PayPal could not let the hold go, so the job is still open. ${reason(error)}`);
    }
  }

  return db.transaction(async (tx) => {
    await tx.update(moneyMoves).set({ status: "done", paypalRef: authorizationId, error: null }).where(and(eq(moneyMoves.id, move.id), inArray(moneyMoves.status, ["pending", "failed"])));
    const finished = (await tx.select().from(moneyMoves).where(eq(moneyMoves.id, move.id)))[0];
    await tx.update(jobs).set({ status: "ended", endedAt: new Date() }).where(eq(jobs.id, jobId));
    await tx.update(claims).set({ status: "closed" }).where(eq(claims.jobId, jobId));
    return finished;
  });
}

// ---------------------------------------------------------------- sales

/**
 * Records a sale PayPal saw that carried a worker's code. One sale per PayPal
 * order: a repeat of the same order returns the sale already stored.
 */
export async function recordSale(input: {
  paypalOrderId: string;
  /** The worker's code carried on the order (a tracked link's code). */
  linkCode: string;
  /** What the buyer paid, in cents. */
  amountCents: number;
}): Promise<Sale> {
  const paypalOrderId = input.paypalOrderId.trim();
  const linkCode = input.linkCode.trim();
  if (!paypalOrderId) throw new MoneyRefusal("A sale needs PayPal's order number.");
  if (!isCents(input.amountCents)) throw new MoneyRefusal("A sale's amount must be whole cents.");

  const db = await getDb();
  const stored = async () => (await db.select().from(sales).where(eq(sales.paypalOrderId, paypalOrderId)))[0];
  const already = await stored();
  if (already) return already;

  const link = (await db.select().from(trackedLinks).where(eq(trackedLinks.code, linkCode)))[0];
  if (!link) throw new MoneyRefusal(`No worker has the code "${linkCode}", so this sale was not counted for anyone.`);
  const job = (await db.select().from(jobs).where(eq(jobs.id, link.jobId)))[0];
  if (job.status !== "open") throw new MoneyRefusal("That worker's job is not open, so this sale was not counted.");

  await db
    .insert(sales)
    .values({ id: newId("sal"), jobId: link.jobId, claimId: link.claimId, linkCode: link.code, paypalOrderId, amountCents: input.amountCents })
    .onConflictDoNothing({ target: sales.paypalOrderId });
  return (await stored())!;
}
