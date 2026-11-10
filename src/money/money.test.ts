import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { JobCard, MoneyMove } from "@/contract/types";
import { closeDb, getDb, type Db } from "@/db/client";
import { getJobMoney } from "@/db/read";
import { claims, jobs, moneyMoves, results, sales } from "@/db/schema";
import { callDibs, createJob, handIn, joinDibs } from "@/db/write";
import { makeFakePayPal, type FakePayPal } from "./fake-paypal";
import { confirmHold, letGo, moneyTiming, payWorker, recordSale, settlePayout, startHold } from "./index";
import { centsToText, textToCents, usePayPal } from "./paypal";

let db: Db;
let fake: FakePayPal;
let n = 0;

beforeAll(async () => {
  db = await getDb();
  moneyTiming.payoutWaitMs = 30;
  moneyTiming.payoutLookEveryMs = 1;
});
afterAll(async () => {
  usePayPal(null);
  await closeDb();
});
beforeEach(() => {
  fake = makeFakePayPal();
  usePayPal(fake);
});

function card(overrides: Partial<JobCard> = {}): JobCard {
  return {
    title: "Get our launch video 10,000 views",
    category: "promotion",
    finishLine: "10,000 views on your launch video",
    target: { unit: "view", count: 10000 },
    howChecked: ["Views are read from the video site's own count."],
    checkedByLine: "The video site's own view count",
    cheatTestsLine: "Sudden jumps in views.",
    payRule: { kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 200, batchSize: 1000 },
    payLine: "$2.00 for every 1,000 views",
    payNote: "Up to $50.00 in total",
    capCents: 5000,
    endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    proofStrength: "weak",
    proofNote: "Views can be bought.",
    proofTip: null,
    targetUrl: null,
    checker: { evidence: ["public_page"], handIn: "link", mustShow: [], cheatTests: [], machineCheckable: true },
    ...overrides,
  };
}

async function draftJob(overrides: Partial<JobCard> = {}) {
  n += 1;
  const poster = await joinDibs({ name: `Poster ${n}`, paypalEmail: `poster${n}@example.com` });
  return createJob({ posterId: poster.id, sentence: "Get my video 10,000 views", card: card(overrides) });
}

async function openJob(overrides: Partial<JobCard> = {}) {
  const job = await draftJob(overrides);
  const start = await startHold(job.id);
  fake.approve(start.paypalOrderId);
  await confirmHold(job.id);
  return (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0];
}

async function resultOn(jobId: string, earnedCents = 0) {
  n += 1;
  const worker = await joinDibs({ name: `worker${n}`, paypalEmail: `worker${n}@example.com` });
  const { claim } = await callDibs({ jobId, workerId: worker.id });
  const result = await handIn({ claimId: claim.id, url: "https://example.com/video" });
  await earn(result.id, earnedCents);
  return { worker, claim, resultId: result.id };
}

const earn = (resultId: string, cents: number) => db.update(results).set({ earnedCents: cents }).where(eq(results.id, resultId));
const movesFor = async (resultId: string) => (await db.select().from(moneyMoves).where(eq(moneyMoves.resultId, resultId))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const kinds = (moves: MoneyMove[], kind: string) => moves.filter((m) => m.kind === kind);
const statusOf = async (resultId: string) => (await db.select().from(results).where(eq(results.id, resultId)))[0].status;

describe("money as text", () => {
  it("turns cents into PayPal's text and back", () => {
    expect(centsToText(1240)).toBe("12.40");
    expect(centsToText(5)).toBe("0.05");
    expect(centsToText(5000)).toBe("50.00");
    expect(textToCents("12.4")).toBe(1240);
    expect(textToCents("50.00")).toBe(5000);
    expect(textToCents("abc")).toBeNull();
    expect(() => centsToText(12.5)).toThrow("Not whole cents");
  });
});

describe("startHold and confirmHold", () => {
  it("asks PayPal to hold the full budget and saves the order number", async () => {
    const job = await draftJob();
    const start = await startHold(job.id);
    expect(start.approveUrl).toContain(start.paypalOrderId);
    expect(fake.calls[0]).toMatchObject({ action: "createHoldOrder", amountCents: 5000, customId: `dibs-job:${job.id}` });
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].paypalOrderId).toBe(start.paypalOrderId);
  });

  it("uses the same PayPal order when asked twice", async () => {
    const job = await draftJob();
    const a = await startHold(job.id);
    const b = await startHold(job.id);
    expect(b).toEqual(a);
    expect(fake.count("createHoldOrder")).toBe(1);
  });

  it("refuses a job that is not a draft", async () => {
    const job = await openJob();
    await expect(startHold(job.id)).rejects.toThrow("already locked");
  });

  it("does nothing until the poster approved on PayPal", async () => {
    const job = await draftJob();
    await startHold(job.id);
    await expect(confirmHold(job.id)).rejects.toThrow("has not been approved");
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].status).toBe("draft");
    expect(await getJobMoney(job.id)).toMatchObject({ lockedCents: 0 });
  });

  it("locks the money once, however often it is called", async () => {
    const job = await draftJob();
    const start = await startHold(job.id);
    fake.approve(start.paypalOrderId);
    const [a, b] = await Promise.all([confirmHold(job.id), confirmHold(job.id)]);
    const c = await confirmHold(job.id);
    expect(a.id).toBe(b.id);
    expect(c.id).toBe(a.id);
    expect(a).toMatchObject({ kind: "hold", status: "done", amountCents: 5000 });
    expect(a.paypalRef).toMatch(/^AUTH/);
    const after = (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0];
    expect(after).toMatchObject({ status: "open", paypalAuthorizationId: a.paypalRef });
    expect(await getJobMoney(job.id)).toEqual({ lockedCents: 5000, paidCents: 0, heldCents: 5000, letGoCents: 0 });
  });
});

describe("payWorker", () => {
  it("pays $4.00, then $8.40 more when the result has earned $12.40", async () => {
    const job = await openJob();
    const { resultId, worker } = await resultOn(job.id, 400);

    const first = await payWorker(resultId);
    expect(first.paidCents).toBe(400);
    expect(first.take).toMatchObject({ kind: "take", status: "done", amountCents: 400, feeCents: 0, personId: worker.id, resultId });
    expect(first.payout).toMatchObject({ kind: "payout", status: "done", amountCents: 400, personId: worker.id, resultId });
    expect(first.take!.paypalRef).toMatch(/^CAP/);
    expect(first.payout!.paypalRef).toMatch(/^TXN/);
    expect(first.payout!.note).toContain("$4.00");
    expect(first.payout!.note).toContain("Get our launch video");
    expect(await statusOf(resultId)).toBe("paid");

    await earn(resultId, 1240);
    const second = await payWorker(resultId);
    expect(second.paidCents).toBe(840);

    const moves = await movesFor(resultId);
    expect(kinds(moves, "take").map((m) => m.amountCents)).toEqual([400, 840]);
    expect(kinds(moves, "payout").map((m) => m.amountCents)).toEqual([400, 840]);
    expect(moves.every((m) => m.status === "done" && m.paypalRef)).toBe(true);
    expect(await getJobMoney(job.id)).toEqual({ lockedCents: 5000, paidCents: 1240, heldCents: 3760, letGoCents: 0 });
    expect(fake.heldCents(job.paypalAuthorizationId!)).toBe(3760);
    const sent = fake.calls.filter((c) => c.action === "sendPayout");
    expect(sent.map((c) => c.email)).toEqual([worker.paypalEmail, worker.paypalEmail]);
  });

  it("pays once when called twice at the same moment", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    const outcomes = await Promise.all([payWorker(resultId), payWorker(resultId), payWorker(resultId)]);
    expect(outcomes.map((o) => o.paidCents).sort()).toEqual([0, 0, 400]);
    const moves = await movesFor(resultId);
    expect(kinds(moves, "take")).toHaveLength(1);
    expect(kinds(moves, "payout")).toHaveLength(1);
    expect(fake.count("takeFromHold")).toBe(1);
    expect(fake.count("sendPayout")).toBe(1);
    expect(fake.heldCents(job.paypalAuthorizationId!)).toBe(4600);
  });

  it("returns nothing when nothing is owed", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 0);
    expect(await payWorker(resultId)).toEqual({ paidCents: 0, take: null, payout: null });
    await earn(resultId, 400);
    await payWorker(resultId);
    expect(await payWorker(resultId)).toEqual({ paidCents: 0, take: null, payout: null });
    await expect(payWorker("res_nope")).rejects.toThrow("No such result");
  });

  it("marks a refused take failed, counts nothing, and pays on the next call", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.failNext("takeFromHold", "AUTHORIZATION_DENIED");
    const first = await payWorker(resultId);
    expect(first.paidCents).toBe(0);
    expect(first.take).toMatchObject({ status: "failed" });
    expect(first.take!.error).toContain("AUTHORIZATION_DENIED");
    expect(first.payout).toBeNull();
    expect(await statusOf(resultId)).toBe("checking");
    expect(await getJobMoney(job.id)).toMatchObject({ paidCents: 0, heldCents: 5000 });

    const second = await payWorker(resultId);
    expect(second.paidCents).toBe(400);
    expect(fake.heldCents(job.paypalAuthorizationId!)).toBe(4600);
  });

  it("keeps a take pending when PayPal could not be reached, and never takes twice for it", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.failNext("takeFromHold", "UNREACHABLE", 0);
    const first = await payWorker(resultId);
    expect(first.take).toMatchObject({ status: "pending" });
    expect((await payWorker(resultId)).paidCents).toBe(0); // still young: left alone
    expect(kinds(await movesFor(resultId), "take")).toHaveLength(1);

    // Once it is old enough to have been left behind, it is asked again with the same id.
    await db.update(moneyMoves).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(moneyMoves.id, first.take!.id));
    const later = await payWorker(resultId);
    expect(later.paidCents).toBe(400);
    const moves = await movesFor(resultId);
    expect(kinds(moves, "take")).toHaveLength(1);
    expect(kinds(moves, "payout")).toHaveLength(1);
    expect(fake.heldCents(job.paypalAuthorizationId!)).toBe(4600);
  });

  it("sends the payout again, without taking again, when the take worked and the payout did not", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.failNext("sendPayout", "INSUFFICIENT_FUNDS");
    const first = await payWorker(resultId);
    expect(first).toMatchObject({ paidCents: 0, take: { status: "done" }, payout: { status: "failed" } });
    expect(await statusOf(resultId)).toBe("checking");

    const second = await payWorker(resultId);
    expect(second.paidCents).toBe(400);
    expect(second.take).toBeNull();
    expect(second.payout).toMatchObject({ status: "done", amountCents: 400 });
    const moves = await movesFor(resultId);
    expect(kinds(moves, "take")).toHaveLength(1);
    expect(kinds(moves, "payout").map((m) => m.status)).toEqual(["failed", "done"]);
    expect(fake.count("takeFromHold")).toBe(1);
    expect(await statusOf(resultId)).toBe("paid");
  });

  it("does the same when PayPal accepted the payout and later could not deliver it", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.payoutEnds("RETURNED");
    expect((await payWorker(resultId)).payout).toMatchObject({ status: "failed" });
    fake.payoutEnds("SUCCESS");
    expect((await payWorker(resultId)).paidCents).toBe(400);
    expect(fake.count("takeFromHold")).toBe(1);
  });

  it("sends nothing to the worker while PayPal has not finished taking the money", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.takeStatus = "PENDING";
    const outcome = await payWorker(resultId);
    expect(outcome).toMatchObject({ paidCents: 0, take: { status: "pending" }, payout: null });
    expect(fake.count("sendPayout")).toBe(0);
    expect(await statusOf(resultId)).toBe("checking");
  });

  it("marks a take PayPal declined as failed and sends nothing", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.takeStatus = "DECLINED";
    expect(await payWorker(resultId)).toMatchObject({ paidCents: 0, take: { status: "failed" }, payout: null });
    expect(fake.count("sendPayout")).toBe(0);
  });

  it("never marks a take failed when PayPal says one with its number already exists", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.failNext("takeFromHold", "DUPLICATE_TRANSACTION");
    const outcome = await payWorker(resultId);
    expect(outcome.take).toMatchObject({ status: "pending" });
    expect(outcome.take!.error).toContain("already exists");
    expect((await payWorker(resultId)).paidCents).toBe(0);
    expect(kinds(await movesFor(resultId), "take")).toHaveLength(1);
  });

  it("never pays twice when the program stopped right after sending a payout", async () => {
    const job = await openJob();
    const { resultId, worker } = await resultOn(job.id, 400);
    // PayPal accepted the payout, but our program never heard the answer.
    fake.failNext("sendPayout", "UNREACHABLE", 0);
    const first = await payWorker(resultId);
    expect(first.payout).toMatchObject({ status: "pending", paypalRef: null });
    await fake.sendPayout({ batchId: first.payout!.id, email: worker.paypalEmail, amountCents: 400, note: "", subject: "" });
    expect(fake.payoutsMade).toBe(1);

    await db.update(moneyMoves).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(moneyMoves.id, first.payout!.id));
    const later = await payWorker(resultId);
    expect(later).toMatchObject({ paidCents: 400, take: null, payout: { id: first.payout!.id, status: "done" } });
    expect(fake.payoutsMade).toBe(1);
    expect(kinds(await movesFor(resultId), "payout")).toHaveLength(1);
  });

  it("leaves a slow payout pending and settles it on the next call", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.payoutEnds("PENDING");
    const first = await payWorker(resultId);
    expect(first.paidCents).toBe(0);
    expect(first.payout).toMatchObject({ status: "pending" });
    expect(first.payout!.paypalRef).toMatch(/^BATCH/);
    expect(await statusOf(resultId)).toBe("checking");

    fake.payoutEnds("SUCCESS");
    const second = await payWorker(resultId);
    expect(second).toMatchObject({ paidCents: 400, take: null, payout: { status: "done", id: first.payout!.id } });
    expect(fake.count("takeFromHold")).toBe(1);
    expect(fake.count("sendPayout")).toBe(1);
    expect(await statusOf(resultId)).toBe("paid");
  });

  it("settles a pending payout when PayPal's message about it arrives", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.payoutEnds("PENDING");
    const first = await payWorker(resultId);
    fake.payoutEnds("SUCCESS");
    expect(await settlePayout(first.payout!.id)).toMatchObject({ status: "done" });
    expect(await settlePayout(first.payout!.id)).toBeNull();
    expect(await statusOf(resultId)).toBe("paid");
  });

  it("counts money sent to an email with no PayPal account as sent, and says so", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.payoutEnds("UNCLAIMED");
    const outcome = await payWorker(resultId);
    expect(outcome.payout).toMatchObject({ status: "done" });
    expect(outcome.payout!.error).toContain("no PayPal account");
  });

  it("never takes more than is still held", async () => {
    const job = await openJob();
    const a = await resultOn(job.id, 3000);
    const b = await resultOn(job.id, 3000);
    const [one, two] = await Promise.all([payWorker(a.resultId), payWorker(b.resultId)]);
    expect([one.paidCents, two.paidCents].sort((x, y) => x - y)).toEqual([2000, 3000]);
    expect(await getJobMoney(job.id)).toEqual({ lockedCents: 5000, paidCents: 5000, heldCents: 0, letGoCents: 0 });
    expect(fake.heldCents(job.paypalAuthorizationId!)).toBe(0);
  });

  it("pays nothing more to a blocked result, or one the poster objected to", async () => {
    const job = await openJob();
    const blocked = await resultOn(job.id, 400);
    await db.update(results).set({ status: "blocked" }).where(eq(results.id, blocked.resultId));
    expect((await payWorker(blocked.resultId)).paidCents).toBe(0);
    const objected = await resultOn(job.id, 400);
    await db.update(results).set({ status: "waiting", objectedAt: new Date() }).where(eq(results.id, objected.resultId));
    expect((await payWorker(objected.resultId)).paidCents).toBe(0);
    expect(fake.count("takeFromHold")).toBe(0);
  });

  it("does not turn a blocked result back to paid when an old payout lands", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.payoutEnds("PENDING");
    await payWorker(resultId);
    await db.update(results).set({ status: "blocked" }).where(eq(results.id, resultId));
    fake.payoutEnds("SUCCESS");
    expect((await payWorker(resultId)).paidCents).toBe(400);
    expect(await statusOf(resultId)).toBe("blocked");
  });
});

describe("letGo", () => {
  it("lets the rest go, ends the job and closes its claims, once", async () => {
    const job = await openJob();
    const { resultId, claim } = await resultOn(job.id, 1240);
    await payWorker(resultId);

    const move = await letGo(job.id);
    expect(move).toMatchObject({ kind: "let_go", status: "done", amountCents: 3760, paypalRef: job.paypalAuthorizationId, personId: job.posterId });
    const after = (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0];
    expect(after.status).toBe("ended");
    expect(after.endedAt).toBeInstanceOf(Date);
    expect((await db.select().from(claims).where(eq(claims.id, claim.id)))[0].status).toBe("closed");
    expect(await getJobMoney(job.id)).toEqual({ lockedCents: 5000, paidCents: 1240, heldCents: 0, letGoCents: 3760 });
    expect(fake.heldCents(job.paypalAuthorizationId!)).toBe(0);

    expect((await letGo(job.id)).id).toBe(move.id);
    expect(fake.count("voidHold")).toBe(1);

    await earn(resultId, 2000);
    expect((await payWorker(resultId)).paidCents).toBe(0);
  });

  it("finishes a payout that was still on its way before ending the job", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 400);
    fake.payoutEnds("PENDING");
    const first = await payWorker(resultId);
    expect(first.payout).toMatchObject({ status: "pending" });
    fake.payoutEnds("SUCCESS");
    expect(await letGo(job.id)).toMatchObject({ status: "done", amountCents: 4600 });
    expect(kinds(await movesFor(resultId), "payout")[0]).toMatchObject({ status: "done" });
    expect(await statusOf(resultId)).toBe("paid");
  });

  it("makes one let-go when called twice at the same moment", async () => {
    const job = await openJob();
    const [a, b] = await Promise.all([letGo(job.id), letGo(job.id)]);
    expect(a.id).toBe(b.id);
    expect(await getJobMoney(job.id)).toEqual({ lockedCents: 5000, paidCents: 0, heldCents: 0, letGoCents: 5000 });
  });

  it("keeps the job open when PayPal fails, and works on the next try", async () => {
    const job = await openJob();
    fake.failNext("voidHold", "INTERNAL_SERVICE_ERROR", 500);
    await expect(letGo(job.id)).rejects.toThrow("still open");
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].status).toBe("open");
    expect(await getJobMoney(job.id)).toMatchObject({ heldCents: 5000, letGoCents: 0 });
    expect(await letGo(job.id)).toMatchObject({ status: "done", amountCents: 5000 });
  });

  it("skips PayPal when everything was taken", async () => {
    const job = await openJob();
    const { resultId } = await resultOn(job.id, 5000);
    await payWorker(resultId);
    expect(await letGo(job.id)).toMatchObject({ status: "done", amountCents: 0 });
    expect(fake.count("voidHold")).toBe(0);
  });

  it("refuses a job with no money held", async () => {
    const job = await draftJob();
    await expect(letGo(job.id)).rejects.toThrow("no money held");
  });
});

describe("recordSale", () => {
  async function salesJob() {
    const job = await openJob({
      category: "sales",
      payRule: { kind: "per_unit", unit: "sale", unitLabel: "sale", centsPerBatch: 500, batchSize: 1 },
      targetUrl: "https://example.com/shop",
      checker: { evidence: ["paypal_sale"], handIn: "none", mustShow: [], cheatTests: [], machineCheckable: true },
    });
    n += 1;
    const worker = await joinDibs({ name: `seller${n}`, paypalEmail: `seller${n}@example.com` });
    const { claim, link } = await callDibs({ jobId: job.id, workerId: worker.id });
    return { job, claim, code: link!.code };
  }

  it("stores a sale against the worker whose code was on the order", async () => {
    const { job, claim, code } = await salesJob();
    const sale = await recordSale({ paypalOrderId: "ORDER-A1", linkCode: code, amountCents: 3200 });
    expect(sale).toMatchObject({ jobId: job.id, claimId: claim.id, linkCode: code, paypalOrderId: "ORDER-A1", amountCents: 3200 });
  });

  it("stores one sale per PayPal order, even when told twice at once", async () => {
    const { code } = await salesJob();
    const input = { paypalOrderId: "ORDER-B1", linkCode: code, amountCents: 3200 };
    const [a, b] = await Promise.all([recordSale(input), recordSale(input)]);
    const c = await recordSale({ ...input, amountCents: 9900 });
    expect(b.id).toBe(a.id);
    expect(c).toMatchObject({ id: a.id, amountCents: 3200 });
    expect(await db.select().from(sales).where(eq(sales.paypalOrderId, "ORDER-B1"))).toHaveLength(1);
  });

  it("refuses an unknown code, a bad amount and an ended job", async () => {
    const { job, code } = await salesJob();
    await expect(recordSale({ paypalOrderId: "ORDER-C1", linkCode: "nobody12", amountCents: 3200 })).rejects.toThrow("No worker has the code");
    await expect(recordSale({ paypalOrderId: "ORDER-C2", linkCode: code, amountCents: 32.5 })).rejects.toThrow("whole cents");
    await letGo(job.id);
    await expect(recordSale({ paypalOrderId: "ORDER-C3", linkCode: code, amountCents: 3200 })).rejects.toThrow("not open");
  });
});
