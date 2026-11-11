/**
 * A job's money trail: locked, each payment, released, oldest first, each with
 * PayPal's own reference. Built from the money moves; nothing is stored twice.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { formatCents } from "../contract/money";
import type { MoneyMove, MoneyTrail, MoneyTrailStep } from "../contract/types";
import { getDb } from "../db/client";
import { jobs, moneyMoves, people } from "../db/schema";

/**
 * The job's money moves as trail lines. A payment is ONE line: the take from
 * the hold and the payout to the worker together. Moves that failed moved no
 * money and are left out. Empty for a draft or an unknown job.
 */
export async function getMoneyTrail(jobId: string): Promise<MoneyTrail> {
  const db = await getDb();
  const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0];
  if (!job) return { jobId, holdEndsAt: null, steps: [] };
  const moves: MoneyMove[] = (await db.select().from(moneyMoves).where(eq(moneyMoves.jobId, jobId)).orderBy(asc(moneyMoves.createdAt))).filter((m) => m.status !== "failed");
  const workerIds = [...new Set(moves.map((m) => m.personId).filter((id): id is string => !!id))];
  const names = new Map((workerIds.length ? await db.select().from(people).where(inArray(people.id, workerIds)) : []).map((p) => [p.id, p.name]));

  // Each take is matched with the payout that carried its money on: the
  // first payout for the same result that is not already matched.
  const payouts = moves.filter((m) => m.kind === "payout");
  const used = new Set<string>();
  const steps: MoneyTrailStep[] = [];
  for (const move of moves) {
    if (move.kind === "hold") {
      steps.push({ id: move.id, kind: "locked", when: move.createdAt, amountCents: move.amountCents, status: move.status, paypalRef: move.paypalRef, takeRef: null, who: null, what: `${formatCents(move.amountCents)} locked in PayPal for this job` });
    } else if (move.kind === "let_go") {
      steps.push({ id: move.id, kind: "released", when: move.createdAt, amountCents: move.amountCents, status: move.status, paypalRef: move.paypalRef, takeRef: null, who: null, what: `${formatCents(move.amountCents)} was not earned and went back to the poster` });
    } else if (move.kind === "take") {
      const payout = payouts.find((p) => p.resultId === move.resultId && !used.has(p.id));
      if (payout) used.add(payout.id);
      const who = move.personId ? (names.get(move.personId) ?? null) : null;
      // Done only when the money has reached the worker.
      const status = move.status === "done" && payout ? payout.status : "pending";
      const sent = payout?.amountCents ?? move.amountCents - move.feeCents;
      steps.push({
        id: payout?.id ?? move.id,
        kind: "payment",
        when: move.createdAt,
        amountCents: move.amountCents,
        status,
        paypalRef: payout?.paypalRef ?? null,
        takeRef: move.paypalRef,
        who,
        what: status === "done" ? `${formatCents(sent)} paid to ${who ?? "the worker"} for a checked result` : `${formatCents(sent)} on its way to ${who ?? "the worker"} for a checked result`,
      });
    }
  }
  return { jobId, holdEndsAt: job.holdEndsAt, steps };
}
