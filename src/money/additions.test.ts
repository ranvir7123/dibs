import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { JobCard } from "@/contract/types";
import { closeDb, getDb, type Db } from "@/db/client";
import { getJobPage } from "@/db/read";
import { jobs, people, results, sales } from "@/db/schema";
import { callDibs, createJob, handIn, joinDibs } from "@/db/write";
import { settings } from "@/settings";
import { makeFakePayPal, type FakePayPal } from "./fake-paypal";
import { confirmHold, countSales, getMoneyTrail, getShopOrders, joinWithPayPal, letGo, moneyTiming, payWorker, refreshSale, refundSale, startHold, startHoldOrder } from "./index";
import { identityFrom, loginUrl } from "./login";
import { usePayPal } from "./paypal";
import { ownsSale } from "./sales";
import { finishShopOrder, startShopOrder } from "./shop";
import { handlePayPalMessage } from "./webhook";
import { GET as loginStart } from "@/app/api/paypal/login/start/route";
import { GET as loginReturn } from "@/app/api/paypal/login/return/route";
import { POST as holdOrder } from "@/app/api/paypal/hold/order/route";
import { POST as holdFinish } from "@/app/api/paypal/hold/finish/route";
import { POST as shopFinish } from "@/app/api/paypal/shop/finish/route";
import { POST as refundRoute } from "@/app/api/paypal/refund/route";

let db: Db;
let fake: FakePayPal;
let n = 0;
const WAIT_MS = settings.saleRefundWaitMinutes * 60_000;

beforeAll(async () => {
  db = await getDb();
  moneyTiming.payoutWaitMs = 30;
  moneyTiming.payoutLookEveryMs = 1;
});
afterAll(async () => {
  usePayPal(null);
  delete process.env.PAYPAL_WEBHOOK_ID;
  await closeDb();
});
beforeEach(() => {
  fake = makeFakePayPal();
  usePayPal(fake);
  process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
});

function card(sales: boolean): JobCard {
  return {
    title: sales ? "Bring us paying customers" : "Get our launch video 10,000 views",
    category: sales ? "sales" : "promotion",
    finishLine: "A result",
    target: null,
    howChecked: ["Checked by a machine."],
    checkedByLine: "A machine",
    cheatTestsLine: "None.",
    payRule: sales ? { kind: "per_unit", unit: "sale", unitLabel: "sale", centsPerBatch: 500, batchSize: 1 } : { kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 200, batchSize: 1000 },
    payLine: "Pay",
    payNote: "Up to $50.00 in total",
    capCents: 5000,
    endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    proofStrength: "strong",
    proofNote: "",
    proofTip: null,
    targetUrl: sales ? "https://example.com/shop" : null,
    checker: { evidence: [sales ? "paypal_sale" : "public_page"], handIn: sales ? "none" : "link", mustShow: [], cheatTests: [], machineCheckable: true },
  };
}

async function draft(sales = false) {
  n += 1;
  const poster = await joinDibs({ name: `Poster ${n}`, paypalEmail: `add.poster${n}@example.com` });
  return createJob({ posterId: poster.id, sentence: "A job", card: card(sales) });
}

async function open(sales = false) {
  const job = await draft(sales);
  fake.approve((await startHold(job.id)).paypalOrderId);
  await confirmHold(job.id);
  return (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0];
}

/** An open sales job with one worker and their code. */
async function shop() {
  const job = await open(true);
  n += 1;
  const worker = await joinDibs({ name: `seller${n}`, paypalEmail: `add.seller${n}@example.com` });
  const { claim, link, result } = await callDibs({ jobId: job.id, workerId: worker.id });
  return { job, worker, claim, code: link!.code, resultId: result!.id };
}

/** A buyer pays through the shop. Returns PayPal's order number. */
async function buy(code: string) {
  const order = await startShopOrder({ code, base: "http://localhost:3001" });
  fake.approve(order.paypalOrderId);
  const done = await finishShopOrder(order.paypalOrderId);
  expect(done).toMatchObject({ paid: true, notCountedBecause: null });
  return order.paypalOrderId;
}

const age = (orderId: string, ms: number) => db.update(sales).set({ at: new Date(Date.now() - ms) }).where(eq(sales.paypalOrderId, orderId));
const signed = () => new Headers({ "paypal-auth-algo": "a", "paypal-cert-url": "c", "paypal-transmission-id": "t", "paypal-transmission-sig": "s", "paypal-transmission-time": "now" });

describe("the date PayPal's hold ends", () => {
  it("is stored from PayPal's own answer when the hold is made, and comes with the job", async () => {
    const job = await open();
    expect(job.holdEndsAt).toBeInstanceOf(Date);
    const days = (job.holdEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(28.9);
    expect(days).toBeLessThan(29.1);
    expect(fake.count("getHold")).toBe(1);
    expect((await getJobPage(job.id))!.job.holdEndsAt).toEqual(job.holdEndsAt);
    expect((await getMoneyTrail(job.id)).holdEndsAt).toEqual(job.holdEndsAt);
  });

  it("is null for a draft, and filled in later for a hold made before the date was stored", async () => {
    const d = await draft();
    expect(d.holdEndsAt).toBeNull();
    const job = await open();
    await db.update(jobs).set({ holdEndsAt: null }).where(eq(jobs.id, job.id));
    await confirmHold(job.id);
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].holdEndsAt).toBeInstanceOf(Date);
  });
});

describe("the hold made through PayPal's button", () => {
  it("makes an order with no return address, reuses it, and locks the money when approved", async () => {
    const job = await draft();
    const a = await startHoldOrder(job.id);
    const b = await startHoldOrder(job.id);
    expect(b.paypalOrderId).toBe(a.paypalOrderId);
    expect(fake.calls.find((c) => c.action === "createHoldOrder")).toMatchObject({ amountCents: 5000, customId: `dibs-job:${job.id}` });
    expect(fake.calls.find((c) => c.action === "createHoldOrder")!.returnUrl).toBeUndefined();
    await expect(confirmHold(job.id, a.paypalOrderId)).rejects.toThrow("has not been approved");
    fake.approve(a.paypalOrderId);
    expect(await confirmHold(job.id, a.paypalOrderId)).toMatchObject({ kind: "hold", status: "done", amountCents: 5000 });
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0]).toMatchObject({ status: "open", paypalOrderId: a.paypalOrderId });
  });

  it("locks the order the poster approved even after the job was given another one", async () => {
    const job = await draft();
    const windowOrder = await startHoldOrder(job.id);
    const pageOrder = await startHold(job.id); // the fallback way made a second order
    expect(pageOrder.paypalOrderId).not.toBe(windowOrder.paypalOrderId);
    fake.approve(windowOrder.paypalOrderId);
    await confirmHold(job.id, windowOrder.paypalOrderId);
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0]).toMatchObject({ status: "open", paypalOrderId: windowOrder.paypalOrderId });
  });

  it("refuses an approved order that belongs to another job", async () => {
    const mine = await draft();
    const other = await draft();
    const theirs = await startHoldOrder(other.id);
    fake.approve(theirs.paypalOrderId);
    await startHoldOrder(mine.id);
    await expect(confirmHold(mine.id, theirs.paypalOrderId)).rejects.toThrow("does not match this job");
    expect((await db.select().from(jobs).where(eq(jobs.id, mine.id)))[0].status).toBe("draft");
  });
});

describe("refunds", () => {
  it("keeps PayPal's number for the payment on the sale", async () => {
    const { code } = await shop();
    const orderId = await buy(code);
    const sale = (await db.select().from(sales).where(eq(sales.paypalOrderId, orderId)))[0];
    expect(sale.paypalCaptureId).toMatch(/^CAP/);
    expect(sale).toMatchObject({ refundedCents: 0, refundedAt: null });
  });

  it("refunds all of a sale at PayPal and stops counting it", async () => {
    const { code, claim } = await shop();
    const orderId = await buy(code);
    await age(orderId, WAIT_MS + 1000);
    expect(await countSales(claim.id)).toEqual({ counted: 1, waiting: 0, refunded: 0, keptCents: 3200 });
    const sale = await refundSale({ paypalOrderId: orderId });
    expect(sale.refundedCents).toBe(3200);
    expect(sale.refundedAt).toBeInstanceOf(Date);
    expect(fake.calls.find((c) => c.action === "refundPayment")).toMatchObject({ captureId: sale.paypalCaptureId });
    expect(fake.calls.find((c) => c.action === "refundPayment")!.amountCents).toBeUndefined();
    expect(await countSales(claim.id)).toEqual({ counted: 0, waiting: 0, refunded: 1, keptCents: 0 });
    await expect(refundSale({ paypalOrderId: orderId })).rejects.toThrow("already been refunded in full");
    expect(fake.count("refundPayment")).toBe(1);
  });

  it("refunds part of a sale: still one sale, and only the kept amount is counted", async () => {
    const { code, claim } = await shop();
    const orderId = await buy(code);
    await age(orderId, WAIT_MS + 1000);
    expect((await refundSale({ paypalOrderId: orderId, amountCents: 1000 })).refundedCents).toBe(1000);
    expect(await countSales(claim.id)).toEqual({ counted: 1, waiting: 0, refunded: 0, keptCents: 2200 });
    await expect(refundSale({ paypalOrderId: orderId, amountCents: 2201 })).rejects.toThrow("more than is left");
    await expect(refundSale({ paypalOrderId: orderId, amountCents: 10.5 })).rejects.toThrow("whole cents");
    expect((await refundSale({ paypalOrderId: orderId })).refundedCents).toBe(3200);
    await expect(refundSale({ paypalOrderId: "NOPE" })).rejects.toThrow("No sale is stored");
  });

  it("does not count a sale until the refund wait is over", async () => {
    const { code, claim } = await shop();
    const orderId = await buy(code);
    expect(await countSales(claim.id)).toEqual({ counted: 0, waiting: 1, refunded: 0, keptCents: 0 });
    expect(await countSales(claim.id, new Date(Date.now() + WAIT_MS + 1000))).toMatchObject({ counted: 1, waiting: 0 });
    await age(orderId, WAIT_MS + 1000);
    expect(await countSales(claim.id)).toMatchObject({ counted: 1, waiting: 0 });
  });

  it("pays no commission while a sale is waiting, pays it after the wait", async () => {
    const { code, resultId } = await shop();
    const orderId = await buy(code);
    await db.update(results).set({ earnedCents: 500 }).where(eq(results.id, resultId));
    expect(await payWorker(resultId)).toEqual({ paidCents: 0, take: null, payout: null });
    expect(fake.count("takeFromHold")).toBe(0);
    await age(orderId, WAIT_MS + 1000);
    expect((await payWorker(resultId)).paidCents).toBe(500);
  });

  it("pays no commission for a sale refunded on PayPal's own site, even when PayPal's message never arrived", async () => {
    const { code, resultId, claim } = await shop();
    const kept = await buy(code);
    const refunded = await buy(code);
    await age(kept, WAIT_MS + 1000);
    await age(refunded, WAIT_MS + 1000);
    await db.update(results).set({ earnedCents: 1000 }).where(eq(results.id, resultId)); // the checker counted both
    fake.refundOutside(refunded, 3200); // Dibs is told nothing
    const outcome = await payWorker(resultId);
    expect(outcome.paidCents).toBe(500); // one sale's commission, not two
    expect(await countSales(claim.id)).toEqual({ counted: 1, waiting: 0, refunded: 1, keptCents: 3200 });
    expect((await payWorker(resultId)).paidCents).toBe(0);
  });

  it("pays nothing when PayPal cannot be asked about the sales", async () => {
    const { code, resultId } = await shop();
    await age(await buy(code), WAIT_MS + 1000);
    await db.update(results).set({ earnedCents: 500 }).where(eq(results.id, resultId));
    fake.failNext("getOrder", "UNREACHABLE", 0);
    await expect(payWorker(resultId)).rejects.toThrow();
    expect(fake.count("takeFromHold")).toBe(0);
    expect((await payWorker(resultId)).paidCents).toBe(500);
  });

  it("learns of a refund from PayPal's message, reading the amount from PayPal and not from the message", async () => {
    const { code } = await shop();
    const orderId = await buy(code);
    const sale = (await db.select().from(sales).where(eq(sales.paypalOrderId, orderId)))[0];
    fake.refundOutside(orderId, 1000);
    const message = JSON.stringify({
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { id: "REFUND1", amount: { value: "32.00" }, links: [{ rel: "up", href: `https://api.sandbox.paypal.com/v2/payments/captures/${sale.paypalCaptureId}` }] },
    });
    expect((await handlePayPalMessage(signed(), message)).status).toBe(200);
    expect((await refreshSale(orderId)).refundedCents).toBe(1000);
    const stranger = JSON.stringify({ event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REFUND2", links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAPNOPE" }] } });
    expect(await handlePayPalMessage(signed(), stranger)).toMatchObject({ status: 200 });
  });

  it("lists the shop owner's orders with where each stands, and only the owner may refund", async () => {
    const { code, job, worker } = await shop();
    const first = await buy(code);
    const second = await buy(code);
    await age(first, WAIT_MS + 60_000);
    await refundSale({ paypalOrderId: second });
    const orders = await getShopOrders(job.posterId);
    expect(orders.map((o) => [o.sale.paypalOrderId, o.state, o.keptCents, o.workerName, o.jobTitle])).toEqual([
      [second, "refunded", 0, worker.name, "Bring us paying customers"],
      [first, "counted", 3200, worker.name, "Bring us paying customers"],
    ]);
    expect(orders[0].countsAt.getTime() - orders[0].sale.at.getTime()).toBe(WAIT_MS);
    expect(await getShopOrders(worker.id)).toEqual([]);
    expect(await ownsSale(job.posterId, first)).toBe(true);
    expect(await ownsSale(worker.id, first)).toBe(false);
    expect(await ownsSale(null, first)).toBe(false);
  });
});

describe("the money trail", () => {
  it("shows locked, each payment as one line with both of PayPal's references, and released", async () => {
    const job = await open();
    n += 1;
    const worker = await joinDibs({ name: `trail${n}`, paypalEmail: `add.trail${n}@example.com` });
    const { claim } = await callDibs({ jobId: job.id, workerId: worker.id });
    const result = await handIn({ claimId: claim.id, url: "https://example.com/v" });
    await db.update(results).set({ earnedCents: 400 }).where(eq(results.id, result.id));
    await payWorker(result.id);
    await db.update(results).set({ earnedCents: 1240 }).where(eq(results.id, result.id));
    fake.failNext("takeFromHold", "AUTHORIZATION_DENIED"); // a failed try moves no money and is not shown
    await payWorker(result.id);
    await payWorker(result.id);
    await letGo(job.id);

    const trail = await getMoneyTrail(job.id);
    expect(trail.steps.map((s) => [s.kind, s.amountCents, s.status, s.who])).toEqual([
      ["locked", 5000, "done", null],
      ["payment", 400, "done", worker.name],
      ["payment", 840, "done", worker.name],
      ["released", 3760, "done", null],
    ]);
    expect(trail.steps[0].paypalRef).toBe(job.paypalAuthorizationId);
    expect(trail.steps[1].paypalRef).toMatch(/^TXN/);
    expect(trail.steps[1].takeRef).toMatch(/^CAP/);
    expect(trail.steps[1].what).toContain("$4.00 paid to");
    expect(trail.steps[3].paypalRef).toBe(job.paypalAuthorizationId);
    expect(trail.steps.every((s) => s.when instanceof Date)).toBe(true);
  });

  it("shows a payment still on its way as pending, and is empty for a draft or unknown job", async () => {
    const job = await open();
    n += 1;
    const worker = await joinDibs({ name: `slow${n}`, paypalEmail: `add.slow${n}@example.com` });
    const { claim } = await callDibs({ jobId: job.id, workerId: worker.id });
    const result = await handIn({ claimId: claim.id, url: "https://example.com/v" });
    await db.update(results).set({ earnedCents: 400 }).where(eq(results.id, result.id));
    fake.payoutEnds("PENDING");
    await payWorker(result.id);
    const step = (await getMoneyTrail(job.id)).steps[1];
    expect(step).toMatchObject({ kind: "payment", status: "pending", amountCents: 400 });
    expect(step.what).toContain("on its way");
    expect((await getMoneyTrail((await draft()).id)).steps).toEqual([]);
    expect(await getMoneyTrail("job_nope")).toEqual({ jobId: "job_nope", holdEndsAt: null, steps: [] });
  });
});

describe("Log in with PayPal", () => {
  it("builds PayPal's sign-in address with our return address and the one-time word", () => {
    const before = process.env.PAYPAL_CLIENT_ID;
    process.env.PAYPAL_CLIENT_ID = "CLIENT123";
    const url = new URL(loginUrl({ base: "http://localhost:3001", state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://www.sandbox.paypal.com/connect");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      flowEntry: "static",
      client_id: "CLIENT123",
      response_type: "code",
      scope: "openid email https://uri.paypal.com/services/paypalattributes",
      redirect_uri: "http://localhost:3001/api/paypal/login/return",
      state: "abc",
    });
    if (before === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = before;
  });

  it("reads the account, email and checked mark out of PayPal's answer (EXAMPLE answers, not real PayPal output)", () => {
    expect(identityFrom({ user_id: "https://www.paypal.com/webapps/auth/identity/user/ABC123", email: "A@Example.com", verified_account: "true", name: "A B" })).toEqual({ paypalAccountId: "ABC123", email: "a@example.com", name: "A B", verified: true });
    expect(identityFrom({ payer_id: "PAYER9", emails: [{ value: "x@example.com", primary: true }], verified_account: false })).toEqual({ paypalAccountId: "PAYER9", email: "x@example.com", name: null, verified: false });
    expect(identityFrom({ payer_id: "PAYER9" })).toMatchObject({ email: null, verified: null });
    expect(() => identityFrom({ email: "x@example.com" })).toThrow("did not say which account");
  });

  it("makes a person, finds them again by account, and confirms someone who joined by email", async () => {
    const made = await joinWithPayPal({ paypalAccountId: "ACC-ONE", email: "Pay.One@Example.com", name: "Pay One", verified: true });
    expect(made).toMatchObject({ name: "Pay One", paypalEmail: "pay.one@example.com", paypalAccountId: "ACC-ONE", paypalVerified: true });
    const again = await joinWithPayPal({ paypalAccountId: "ACC-ONE", email: "changed@example.com", verified: false });
    expect(again).toMatchObject({ id: made.id, paypalEmail: "pay.one@example.com", paypalVerified: false });

    const byEmail = await joinDibs({ name: "typed.email", paypalEmail: "typed@example.com" });
    expect(byEmail).toMatchObject({ paypalAccountId: null, paypalVerified: null });
    const confirmed = await joinWithPayPal({ paypalAccountId: "ACC-TWO", email: "typed@example.com", verified: true });
    expect(confirmed).toMatchObject({ id: byEmail.id, name: "typed.email", paypalAccountId: "ACC-TWO", paypalVerified: true });

    expect((await joinWithPayPal({ paypalAccountId: "ACC-THREE", email: "noname@example.com", verified: null })).name).toBe("noname");
    await expect(joinWithPayPal({ paypalAccountId: "ACC-FOUR", email: "", verified: true })).rejects.toThrow("did not share an email");
    expect(await db.select().from(people).where(eq(people.paypalAccountId, "ACC-FOUR"))).toHaveLength(0);
  });
});
describe("the login addresses", () => {
  const off = () => delete process.env.PAYPAL_LOGIN_ON;

  it("answers 404 while the switch is off", async () => {
    off();
    expect((await loginStart(new Request("http://localhost:3001/api/paypal/login/start"))).status).toBe(404);
  });

  it("sends the browser to PayPal with a one-time word, and only comes back to a path on this site", async () => {
    process.env.PAYPAL_LOGIN_ON = "1";
    const before = process.env.DIBS_BASE_URL;
    delete process.env.DIBS_BASE_URL;
    const response = await loginStart(new Request("http://localhost:3001/api/paypal/login/start?next=https://evil.example/x", { headers: { host: "localhost:3001" } }));
    expect(response.status).toBe(303);
    const to = new URL(response.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://www.sandbox.paypal.com/connect");
    expect(to.searchParams.get("redirect_uri")).toBe("http://localhost:3001/api/paypal/login/return");
    const cookie = response.headers.get("set-cookie")!;
    const state = to.searchParams.get("state")!;
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(cookie).toContain(`dibs_paypal_login=${state}.%2F;`); // the outside address was dropped: back to "/"
    expect(cookie).toContain("HttpOnly");
    if (before !== undefined) process.env.DIBS_BASE_URL = before;
    off();
  });

  it("refuses a return whose one-time word does not match, and joins nobody", async () => {
    process.env.PAYPAL_LOGIN_ON = "1";
    const response = await loginReturn(new Request("http://localhost:3001/api/paypal/login/return?code=abc&state=wrong", { headers: { host: "localhost:3001", cookie: "dibs_paypal_login=right.%2Fwork" } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/work?paypal=failed");
    expect(response.headers.get("set-cookie")).not.toContain("dibs_person=");
    off();
  });
});

describe("who may use the money addresses", () => {
  const ask = (body: object, cookie?: string) => new Request("http://localhost:3001/x", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

  it("lets only the poster start a job's hold", async () => {
    const job = await draft();
    expect((await holdOrder(ask({ jobId: job.id }))).status).toBe(403);
    expect((await holdOrder(ask({ jobId: job.id }, "dibs_person=per_someone_else"))).status).toBe(403);
    expect(fake.count("createHoldOrder")).toBe(0);
    const ok = await holdOrder(ask({ jobId: job.id }, `other=1; dibs_person=${job.posterId}`));
    expect(await ok.json()).toMatchObject({ ok: true, orderId: expect.stringMatching(/^ORDER/) });
    expect((await holdOrder(ask({ jobId: "job_nope" }, `dibs_person=${job.posterId}`))).status).toBe(404);
  });

  it("lets only the poster finish a job's hold, even when the order was really approved", async () => {
    const job = await draft();
    const order = await startHoldOrder(job.id);
    fake.approve(order.paypalOrderId);
    const body = { jobId: job.id, orderId: order.paypalOrderId };
    expect((await holdFinish(ask(body))).status).toBe(403);
    expect((await holdFinish(ask(body, "dibs_person=per_someone_else"))).status).toBe(403);
    expect((await holdFinish(ask({ jobId: "job_nope", orderId: order.paypalOrderId }, `dibs_person=${job.posterId}`))).status).toBe(404);
    expect(fake.count("authorizeOrder")).toBe(0);
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0]).toMatchObject({ status: "draft", paypalAuthorizationId: null });
    const ok = await holdFinish(ask(body, `dibs_person=${job.posterId}`));
    expect(await ok.json()).toMatchObject({ ok: true, jobId: job.id, holdEndsAt: expect.any(String) });
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].status).toBe("open");
  });

  it("will not attach another job's order, or an order for another amount, even for the poster", async () => {
    const mine = await draft();
    const other = await draft();
    const me = `dibs_person=${mine.posterId}`;
    const theirs = await startHoldOrder(other.id);
    fake.approve(theirs.paypalOrderId);
    const swapped = await holdFinish(ask({ jobId: mine.id, orderId: theirs.paypalOrderId }, me));
    expect(swapped.status).toBe(400);
    expect((await swapped.json()).message).toContain("does not match this job");
    // An approved order that carries my job's label but a smaller amount than the job's budget.
    const small = await fake.createHoldOrder({ requestId: "r-small", amountCents: 100, description: "x", customId: `dibs-job:${mine.id}` });
    fake.approve(small.id);
    const cheap = await holdFinish(ask({ jobId: mine.id, orderId: small.id }, me));
    expect(cheap.status).toBe(400);
    expect((await cheap.json()).message).toContain("does not match this job");
    expect(fake.count("authorizeOrder")).toBe(0);
    expect((await db.select().from(jobs).where(eq(jobs.id, mine.id)))[0]).toMatchObject({ status: "draft", paypalOrderId: null, paypalAuthorizationId: null });
    expect((await db.select().from(jobs).where(eq(jobs.id, other.id)))[0].status).toBe("draft");
  });

  it("finishes a shop order only from PayPal's own answer: not approved means not paid, and a hold order is refused", async () => {
    const { code } = await shop();
    const order = await startShopOrder({ code, base: "http://localhost:3001", inWindow: true });
    const early = await shopFinish(ask({ orderId: order.paypalOrderId }));
    expect(await early.json()).toMatchObject({ ok: true, paid: false });
    expect(await db.select().from(sales).where(eq(sales.paypalOrderId, order.paypalOrderId))).toHaveLength(0);
    const job = await draft();
    const hold = await startHoldOrder(job.id);
    fake.approve(hold.paypalOrderId);
    const wrong = await shopFinish(ask({ orderId: hold.paypalOrderId }));
    expect(wrong.status).toBe(400);
    expect(fake.count("captureOrder")).toBe(0);
    expect((await shopFinish(ask({ orderId: "not an order" }))).status).toBe(400);
  });

  it("lets only the shop that made a sale refund it", async () => {
    const { code, job, worker } = await shop();
    const orderId = await buy(code);
    expect((await refundRoute(ask({ orderId }))).status).toBe(403);
    expect((await refundRoute(ask({ orderId }, `dibs_person=${worker.id}`))).status).toBe(403);
    expect(fake.count("refundPayment")).toBe(0);
    const ok = await refundRoute(ask({ orderId }, `dibs_person=${job.posterId}`));
    expect(await ok.json()).toMatchObject({ ok: true, sale: { refundedCents: 3200, state: "refunded" } });
    const again = await refundRoute(ask({ orderId }, `dibs_person=${job.posterId}`));
    expect(again.status).toBe(400);
    expect((await again.json()).message).toContain("already been refunded");
  });
});