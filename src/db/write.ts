/**
 * The plain writes every lane needs: joining, storing a new job, calling dibs
 * and handing in. Built by the Start lane. Nothing here touches PayPal or AI:
 * money is lane A's (src/money) and checking is lane B's (src/checkers).
 */
import { and, eq } from "drizzle-orm";
import { isCents } from "../contract/money";
import type { Claim, Job, JobCard, Person, Result, TrackedLink } from "../contract/types";
import { settings } from "../settings";
import { getDb } from "./client";
import { newId, newLinkCode } from "./ids";
import { claims, jobs, people, results, trackedLinks } from "./schema";

const DAY_MS = 86_400_000;

function isWebLink(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Refuses a pay rule that is not whole cents or could never pay anything. */
function checkPayRule(card: JobCard): void {
  const rule = card.payRule;
  const amount = (n: number) => isCents(n) && n > 0;
  const ok =
    rule.kind === "per_unit"
      ? amount(rule.centsPerBatch) && Number.isInteger(rule.batchSize) && rule.batchSize > 0
      : rule.kind === "per_rule"
        ? amount(rule.centsPerRule) && rule.rules.length > 0
        : amount(rule.cents) && rule.cents <= card.capCents;
  if (!ok) {
    throw new Error("The job's pay rule does not work: amounts must be whole cents above zero, batches at least 1, and a one-off amount no more than the budget.");
  }
}

/**
 * Joins Dibs with a name and the email your PayPal uses, or finds the person
 * who already joined with that email. No passwords.
 */
export async function joinDibs(input: { name: string; paypalEmail: string }): Promise<Person> {
  const name = input.name.trim();
  const paypalEmail = input.paypalEmail.trim().toLowerCase();
  if (!name) throw new Error("Please give a name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail)) {
    throw new Error("Please give the email your PayPal uses.");
  }

  const db = await getDb();
  await db.insert(people).values({ id: newId("per"), name, paypalEmail }).onConflictDoNothing({ target: people.paypalEmail });
  return (await db.select().from(people).where(eq(people.paypalEmail, paypalEmail)))[0];
}

/**
 * Stores a job card the poster is happy with as a draft job. No money is
 * locked yet and the job is not on the board: lane A's startHold and
 * confirmHold do that.
 */
export async function createJob(input: { posterId: string; sentence: string; card: JobCard }): Promise<Job> {
  const { card } = input;
  if (!isCents(card.capCents) || card.capCents <= 0) {
    throw new Error("The job's budget must be whole cents, above zero.");
  }
  const endsAt = new Date(card.endsAt);
  if (Number.isNaN(endsAt.getTime())) throw new Error("The job's end date is not a date.");
  const now = Date.now();
  if (endsAt.getTime() <= now) throw new Error("The job's end date must be in the future.");
  if (endsAt.getTime() > now + settings.maxJobDays * DAY_MS) {
    throw new Error(`A job can run for ${settings.maxJobDays} days at most, because a PayPal hold does not last longer.`);
  }
  if (!card.title.trim()) throw new Error("The job needs a title.");
  checkPayRule(card);
  const { evidence } = card.checker;
  if ((evidence.includes("tracked_link") || evidence.includes("paypal_sale")) && !isWebLink(card.targetUrl ?? "")) {
    throw new Error("This job counts clicks or sales, so the card needs the link to the page visitors are sent to.");
  }

  const db = await getDb();
  const poster = (await db.select().from(people).where(eq(people.id, input.posterId)))[0];
  if (!poster) throw new Error("No such person is posting this job.");

  const rows = await db
    .insert(jobs)
    .values({
      id: newId("job"),
      posterId: poster.id,
      sentence: input.sentence.trim(),
      title: card.title.trim(),
      category: card.category,
      card,
      budgetCents: card.capCents,
      status: "draft",
      endsAt,
    })
    .returning();
  return rows[0];
}

/**
 * A worker calls dibs on an open job. One claim per worker per job: calling
 * again returns the same claim. The worker gets their own tracked link when
 * the job counts clicks or sales. When the job needs nothing handed in
 * (a sales job), measuring starts at once and the result is returned too.
 */
export async function callDibs(input: {
  jobId: string;
  workerId: string;
}): Promise<{ claim: Claim; link: TrackedLink | null; result: Result | null }> {
  const db = await getDb();
  const job = (await db.select().from(jobs).where(eq(jobs.id, input.jobId)))[0];
  if (!job) throw new Error("No such job.");
  const worker = (await db.select().from(people).where(eq(people.id, input.workerId)))[0];
  if (!worker) throw new Error("No such person is calling dibs.");

  const find = async () => {
    const claim = (
      await db
        .select()
        .from(claims)
        .where(and(eq(claims.jobId, job.id), eq(claims.workerId, worker.id)))
    )[0];
    if (!claim) return null;
    const link = (await db.select().from(trackedLinks).where(eq(trackedLinks.claimId, claim.id)))[0] ?? null;
    const result = (await db.select().from(results).where(eq(results.claimId, claim.id)))[0] ?? null;
    return { claim, link, result };
  };

  const already = await find();
  if (already) return already;

  if (job.status !== "open" || job.endsAt.getTime() <= Date.now()) {
    throw new Error("This job is not open, so nobody can call dibs on it.");
  }

  const { evidence, handIn: handInKind } = job.card.checker;
  const usesLink = evidence.includes("tracked_link") || evidence.includes("paypal_sale");
  const nothingToHandIn = handInKind === "none";

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(claims)
      .values({
        id: newId("clm"),
        jobId: job.id,
        workerId: worker.id,
        status: nothingToHandIn ? "handed_in" : "open",
      })
      .onConflictDoNothing({ target: [claims.jobId, claims.workerId] })
      .returning();
    const claim = inserted[0];
    if (!claim) return; // the same worker called dibs twice at the same moment; the first call made it

    if (usesLink && job.card.targetUrl) {
      await tx.insert(trackedLinks).values({
        code: newLinkCode(),
        claimId: claim.id,
        jobId: job.id,
        targetUrl: job.card.targetUrl,
      });
    }
    if (nothingToHandIn) {
      await tx.insert(results).values({
        id: newId("res"),
        claimId: claim.id,
        jobId: job.id,
        workerId: worker.id,
        handInKind: "none",
        status: "checking",
        nextCheckAt: new Date(),
      });
    }
  });

  return (await find())!;
}

/**
 * A worker hands in a link or a file for their claim. Makes the result (one
 * per claim) and marks it to be checked on the next tick. Handing in again
 * before the job ends replaces the link or file and asks for a fresh check.
 */
export async function handIn(input: { claimId: string; url?: string; file?: string }): Promise<Result> {
  const db = await getDb();
  const claim = (await db.select().from(claims).where(eq(claims.id, input.claimId)))[0];
  if (!claim) throw new Error("No such claim. Call dibs on the job first.");
  if (claim.status === "closed") throw new Error("This claim is closed, so nothing more can be handed in.");
  const job = (await db.select().from(jobs).where(eq(jobs.id, claim.jobId)))[0];
  if (job.status !== "open") throw new Error("This job is not open, so nothing can be handed in.");
  if (job.endsAt.getTime() <= Date.now()) throw new Error("This job has ended, so nothing more can be handed in.");

  const kind = job.card.checker.handIn;
  const url = input.url?.trim() || null;
  const file = input.file?.trim() || null;
  if (kind === "none") throw new Error("This job needs nothing handed in. It is measured by itself.");
  if (kind === "link" && (!url || !isWebLink(url))) {
    throw new Error("This job is checked from a link. Please paste the full link, starting with https://");
  }
  if (kind === "file" && !file) throw new Error("This job is checked from a file. Please upload the file.");

  const handed = {
    handInKind: kind,
    handInUrl: kind === "link" ? url : null,
    handInFile: kind === "file" ? file : null,
    handedInAt: new Date(),
    nextCheckAt: new Date(),
  };

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(results)
      .values({ id: newId("res"), claimId: claim.id, jobId: claim.jobId, workerId: claim.workerId, status: "checking", ...handed })
      .onConflictDoUpdate({ target: results.claimId, set: handed })
      .returning();
    await tx.update(claims).set({ status: "handed_in" }).where(eq(claims.id, claim.id));
    return rows[0];
  });
}

/**
 * The poster objects to an AI opinion on a result, inside the objection
 * window. From then on a person decides: nothing is paid by itself and the
 * tick leaves the result alone. Objecting twice changes nothing.
 */
export async function objectToOpinion(input: { resultId: string; posterId: string }): Promise<Result> {
  const db = await getDb();
  const result = (await db.select().from(results).where(eq(results.id, input.resultId)))[0];
  if (!result) throw new Error("No such result.");
  const job = (await db.select().from(jobs).where(eq(jobs.id, result.jobId)))[0];
  if (job.posterId !== input.posterId) throw new Error("Only the poster of this job can object.");
  if (result.objectedAt) return result;
  if (result.status !== "waiting" || !result.objectionEndsAt) {
    throw new Error("There is nothing to object to on this result.");
  }
  if (result.objectionEndsAt.getTime() <= Date.now()) {
    throw new Error(`The ${settings.objectionWindowDays} days to object have passed, so the AI's answer stands.`);
  }
  const rows = await db
    .update(results)
    .set({ objectedAt: new Date(), nextCheckAt: null })
    .where(eq(results.id, result.id))
    .returning();
  return rows[0];
}