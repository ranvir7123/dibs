import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { JobCard } from "@/contract/types";
import { closeDb, getDb, type Db } from "@/db/client";
import { jobs, sales } from "@/db/schema";
import { callDibs, createJob, joinDibs } from "@/db/write";
import { makeFakePayPal, type FakePayPal } from "./fake-paypal";
import { confirmHold, moneyTiming, startHold } from "./index";
import { usePayPal } from "./paypal";
import { finishShopOrder, startShopOrder } from "./shop";
import { siteBase } from "./site";
import { handlePayPalMessage } from "./webhook";

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
  delete process.env.PAYPAL_WEBHOOK_ID;
  await closeDb();
});
beforeEach(() => {
  fake = makeFakePayPal();
  usePayPal(fake);
  process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
});

const signed = () =>
  new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
    "paypal-transmission-id": "t-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-11-10T00:00:00Z",
  });

function salesCard(): JobCard {
  return {
    title: "Bring us paying customers",
    category: "sales",
    finishLine: "Sales through your link",
    target: null,
    howChecked: ["PayPal tells us about each sale that carries your code."],
    checkedByLine: "PayPal's own record of each sale",
    cheatTestsLine: "None needed: a sale is real money.",
    payRule: { kind: "per_unit", unit: "sale", unitLabel: "sale", centsPerBatch: 500, batchSize: 1 },
    payLine: "$5.00 for every sale",
    payNote: "Up to $200.00 in total",
    capCents: 20000,
    endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    proofStrength: "strong",
    proofNote: "A sale is real money.",
    proofTip: null,
    targetUrl: "https://example.com/shop",
    checker: { evidence: ["paypal_sale"], handIn: "none", mustShow: [], cheatTests: [], machineCheckable: true },
  };
}

async function draft() {
  n += 1;
  const poster = await joinDibs({ name: `Shop ${n}`, paypalEmail: `shop${n}@example.com` });
  return createJob({ posterId: poster.id, sentence: "Bring us customers", card: salesCard() });
}

async function openWithWorker() {
  const job = await draft();
  fake.approve((await startHold(job.id)).paypalOrderId);
  await confirmHold(job.id);
  const worker = await joinDibs({ name: `dev.finds${n}`, paypalEmail: `dev${n}@example.com` });
  const { link } = await callDibs({ jobId: job.id, workerId: worker.id });
  return { job, worker, code: link!.code };
}

const saleMessage = (label: string, orderId: string) =>
  JSON.stringify({
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "CAP1", custom_id: label, amount: { currency_code: "USD", value: "32.00" }, supplementary_data: { related_ids: { order_id: orderId } } },
  });

describe("PayPal's messages to our server", () => {
  it("refuses a message PayPal says is not real, and stores nothing", async () => {
    const { code } = await openWithWorker();
    fake.webhookIsReal = false;
    const answer = await handlePayPalMessage(signed(), saleMessage(`dibs-sale:${code}`, "ORDER-W1"));
    expect(answer.status).toBe(401);
    expect(await db.select().from(sales).where(eq(sales.paypalOrderId, "ORDER-W1"))).toHaveLength(0);
  });

  it("refuses a message with no signature without asking PayPal", async () => {
    const answer = await handlePayPalMessage(new Headers(), saleMessage("dibs-sale:abc12345", "ORDER-W2"));
    expect(answer.status).toBe(401);
    expect(fake.count("verifyWebhook")).toBe(0);
    expect((await handlePayPalMessage(signed(), "not json")).status).toBe(401);
  });

  it("says it cannot check messages when PAYPAL_WEBHOOK_ID is not set", async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    expect((await handlePayPalMessage(signed(), saleMessage("dibs-sale:abc12345", "ORDER-W3"))).status).toBe(503);
  });

  it("asks PayPal to send again when the check itself could not be made", async () => {
    fake.failNext("verifyWebhook", "UNREACHABLE", 0);
    expect((await handlePayPalMessage(signed(), saleMessage("dibs-sale:abc12345", "ORDER-W4"))).status).toBe(503);
  });

  it("counts a sale once for the worker whose code is on it, however often PayPal says so", async () => {
    const { code, job } = await openWithWorker();
    const message = saleMessage(`dibs-sale:${code}`, "ORDER-W5");
    expect((await handlePayPalMessage(signed(), message)).status).toBe(200);
    expect((await handlePayPalMessage(signed(), message)).status).toBe(200);
    const stored = await db.select().from(sales).where(eq(sales.paypalOrderId, "ORDER-W5"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ linkCode: code, jobId: job.id, amountCents: 3200 });
  });

  it("does not count a hold's take, or a sale with an unknown code, as a sale", async () => {
    const { job } = await openWithWorker();
    expect((await handlePayPalMessage(signed(), saleMessage(`dibs-job:${job.id}`, "ORDER-W6"))).status).toBe(200);
    const unknown = await handlePayPalMessage(signed(), saleMessage("dibs-sale:nobody12", "ORDER-W7"));
    expect(unknown.status).toBe(200);
    expect(unknown.body).toContain("No worker has the code");
    expect(await db.select().from(sales).where(eq(sales.paypalOrderId, "ORDER-W6"))).toHaveLength(0);
    expect(await db.select().from(sales).where(eq(sales.paypalOrderId, "ORDER-W7"))).toHaveLength(0);
  });

  it("locks a job's hold when PayPal says the poster approved it", async () => {
    const job = await draft();
    const start = await startHold(job.id);
    fake.approve(start.paypalOrderId);
    const message = JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: start.paypalOrderId, purchase_units: [{ custom_id: `dibs-job:${job.id}` }] } });
    expect((await handlePayPalMessage(signed(), message)).status).toBe(200);
    expect((await db.select().from(jobs).where(eq(jobs.id, job.id)))[0].status).toBe("open");
  });

  it("asks PayPal to send again, without saying why, when something breaks on our side", async () => {
    const job = await draft();
    const start = await startHold(job.id);
    fake.approve(start.paypalOrderId);
    fake.failNext("getOrder", "INTERNAL_SERVICE_ERROR", 500);
    const message = JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: start.paypalOrderId, purchase_units: [{ custom_id: `dibs-job:${job.id}` }] } });
    const answer = await handlePayPalMessage(signed(), message);
    expect(answer).toEqual({ status: 503, body: "Trouble while handling this. Send it again." });
    expect((await handlePayPalMessage(signed(), message)).status).toBe(200);
  });

  it("answers 200 to a kind of message it has no use for", async () => {
    expect((await handlePayPalMessage(signed(), JSON.stringify({ event_type: "CUSTOMER.DISPUTE.CREATED", resource: {} }))).status).toBe(200);
  });
});

describe("the shop's PayPal order", () => {
  it("carries the worker's code, takes the payment once and counts the sale once", async () => {
    const { code, worker } = await openWithWorker();
    const order = await startShopOrder({ code, base: "http://localhost:3001" });
    expect(fake.calls.at(-1)).toMatchObject({ action: "createSaleOrder", amountCents: 3200, customId: `dibs-sale:${code}`, returnUrl: "http://localhost:3001/api/paypal/shop/return" });

    expect((await finishShopOrder(order.paypalOrderId)).paid).toBe(false); // the buyer has not approved yet
    fake.approve(order.paypalOrderId);
    const [a, b] = await Promise.all([finishShopOrder(order.paypalOrderId), finishShopOrder(order.paypalOrderId)]);
    for (const outcome of [a, b]) expect(outcome).toMatchObject({ paid: true, amountCents: 3200, code, creditedTo: worker.name, notCountedBecause: null });
    expect(a.paypalRef).toMatch(/^CAP/);
    expect(fake.calls.filter((c) => c.action === "captureOrder" ).length).toBeLessThanOrEqual(2);
    expect(await db.select().from(sales).where(eq(sales.paypalOrderId, order.paypalOrderId))).toHaveLength(1);
  });

  it("takes the payment with no code and counts it for nobody", async () => {
    const order = await startShopOrder({ code: null, base: "http://localhost:3001" });
    fake.approve(order.paypalOrderId);
    expect(await finishShopOrder(order.paypalOrderId)).toMatchObject({ paid: true, code: null, creditedTo: null });
  });

  it("refuses a PayPal order that is not the shop's", async () => {
    const job = await draft();
    const start = await startHold(job.id);
    await expect(finishShopOrder(start.paypalOrderId)).rejects.toThrow("not from this shop");
  });
});

describe("siteBase", () => {
  it("prefers DIBS_BASE_URL, then the request, then the laptop", () => {
    const before = process.env.DIBS_BASE_URL;
    delete process.env.DIBS_BASE_URL;
    expect(siteBase()).toBe("http://localhost:3000");
    expect(siteBase(new Request("http://localhost:3001/shop", { headers: { host: "localhost:3001" } }))).toBe("http://localhost:3001");
    expect(siteBase(new Request("http://internal/shop", { headers: { "x-forwarded-host": "dibs.example.com", "x-forwarded-proto": "https" } }))).toBe("https://dibs.example.com");
    process.env.DIBS_BASE_URL = "https://dibs.example.com/";
    expect(siteBase()).toBe("https://dibs.example.com");
    if (before === undefined) delete process.env.DIBS_BASE_URL;
    else process.env.DIBS_BASE_URL = before;
  });
});
