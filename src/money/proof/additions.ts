/**
 * Proof against real PayPal test mode (pretend money) for the additions of 12 Nov:
 *   2. The date a hold ends is read from PayPal and stored on the job.
 *   3. Refunds: a refunded sale stops counting and earns no commission, a sale
 *      waits before its commission is payable, and a refund made on PayPal's
 *      side (not through Dibs) is still seen before commission is paid.
 *   4. (server side only) the order for PayPal's button is made with no return address.
 * Everything goes through the same functions the site uses. Buyers pay with
 * PayPal's published test card, because nobody is here to sign in.
 *
 *   npx tsx src/money/proof/additions.ts
 *
 * Uses its own database folder (.data/lane-a-proof). Keys and emails are never printed.
 */
import "../../db/cli/env";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { formatCents } from "../../contract/money";
import type { JobCard } from "../../contract/types";
import { closeDb, getDb } from "../../db/client";
import { jobs, results, sales } from "../../db/schema";
import { callDibs, createJob, joinDibs } from "../../db/write";
import { settings } from "../../settings";
import { confirmHold, countSales, getMoneyTrail, getShopOrders, letGo, payWorker, refundSale, startHoldOrder } from "../index";
import { getPayPal, JOB_LABEL, rawCallForProofs, SALE_LABEL } from "../paypal";
import { finishShopOrder } from "../shop";

process.env.DIBS_DATA_DIR = ".data/lane-a-proof";
process.env.DATABASE_URL = "";

const card = { card: { number: "4012888888881881", expiry: "2030-12", security_code: "123", name: "Test Person" } }; // PayPal's published test card
const say = (text = "") => console.log(text);
const checks: [string, boolean][] = [];
const check = (what: string, ok: boolean) => {
  checks.push([what, ok]);
  say(`  ${ok ? "OK " : "NOT OK"}  ${what}`);
};

async function main() {
  const db = await getDb();
  const run = randomBytes(3).toString("hex");
  say(`=== additions at ${new Date().toISOString()} (PayPal test mode, pretend money) ===`);

  const poster = await joinDibs({ name: "Loom & Thread", paypalEmail: `loom.${run}@example.com` });
  const jobCard: JobCard = {
    title: "Bring us paying customers",
    category: "sales",
    finishLine: "Sales through your link",
    target: null,
    howChecked: ["PayPal tells us about each sale that carries your code."],
    checkedByLine: "PayPal's own record of each sale",
    cheatTestsLine: "A refunded sale is not counted.",
    payRule: { kind: "per_unit", unit: "sale", unitLabel: "sale", centsPerBatch: 500, batchSize: 1 },
    payLine: "$5.00 for every sale",
    payNote: "Up to $50.00 in total",
    capCents: 5000,
    endsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    proofStrength: "strong",
    proofNote: "A sale is real money.",
    proofTip: null,
    targetUrl: "http://localhost:3001/shop",
    checker: { evidence: ["paypal_sale"], handIn: "none", mustShow: [], cheatTests: [], machineCheckable: true },
  };
  const job = await createJob({ posterId: poster.id, sentence: "Bring us customers, $5 a sale, up to $50", card: jobCard });

  say("Step 4 (server side): the order for PayPal's button");
  const windowOrder = await startHoldOrder(job.id);
  const seen = await getPayPal().getOrder(windowOrder.paypalOrderId);
  say(`  PayPal order ${seen.id}: ${seen.status}, amount ${formatCents(seen.amountCents ?? 0)}, our label on it: ${seen.customId === JOB_LABEL + job.id}`);
  check("PayPal made a hold order with no return address (status CREATED)", seen.status === "CREATED" && seen.amountCents === 5000);
  let refused = "";
  await confirmHold(job.id, windowOrder.paypalOrderId).catch((error: Error) => (refused = error.message));
  say(`  Finishing it before anyone approved: "${refused}"`);
  check("Nothing is locked before the poster approves", refused.includes("not been approved"));

  say("Step 2: the date the hold ends");
  const order = await rawCallForProofs("POST", "/v2/checkout/orders", {
    requestId: randomBytes(12).toString("hex"),
    body: { intent: "AUTHORIZE", purchase_units: [{ description: `Dibs job: ${job.title}`, custom_id: JOB_LABEL + job.id, amount: { currency_code: "USD", value: "50.00" } }], payment_source: card },
  });
  // The poster "approved" this second order (paid with the test card); the job still points at the first one.
  const hold = await confirmHold(job.id, String(order.id));
  const opened = (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0];
  const atPayPal = await rawCallForProofs("GET", `/v2/payments/authorizations/${hold.paypalRef}`);
  const days = opened.holdEndsAt ? (opened.holdEndsAt.getTime() - Date.now()) / 86_400_000 : 0;
  say(`  Held ${formatCents(hold.amountCents)}, PayPal reference ${hold.paypalRef}`);
  say(`  PayPal's own answer (expiration_time): ${String(atPayPal.expiration_time)}`);
  say(`  Stored on the job (holdEndsAt):        ${opened.holdEndsAt?.toISOString()}  = ${days.toFixed(1)} days from now`);
  check("The stored date is the one PayPal gave", !!opened.holdEndsAt && opened.holdEndsAt.getTime() === new Date(String(atPayPal.expiration_time)).getTime());
  check("The job opened on the order that was approved", opened.status === "open" && opened.paypalOrderId === String(order.id));

  say("Step 3: sales, the refund wait, and refunds");
  const worker = await joinDibs({ name: "dev.finds", paypalEmail: process.env.PAYPAL_TEST_WORKER_EMAIL?.trim() || `dev.${run}@example.com` });
  const { claim, link, result } = await callDibs({ jobId: job.id, workerId: worker.id });
  const code = link!.code;
  const buy = async (label: string) => {
    const sale = await rawCallForProofs("POST", "/v2/checkout/orders", {
      requestId: randomBytes(12).toString("hex"),
      body: { intent: "CAPTURE", purchase_units: [{ description: "Loom & Thread: Handwoven cotton scarf", custom_id: SALE_LABEL + code, amount: { currency_code: "USD", value: "32.00" } }], payment_source: card },
    });
    const done = await finishShopOrder(String(sale.id));
    say(`  Sale ${label}: PayPal order ${done.paypalOrderId}, payment ${done.paypalRef}, counted for ${done.creditedTo}`);
    return done.paypalOrderId;
  };
  const kept = await buy("A (kept)");
  const refundedHere = await buy("B (refunded with the shop's Refund button)");
  const refundedAtPayPal = await buy("C (refunded on PayPal's side, Dibs is not told)");
  const partly = await buy("D (part refunded)");
  const stored = (await db.select().from(sales).where(eq(sales.paypalOrderId, kept)))[0];
  check("PayPal's number for the payment is stored on the sale", !!stored.paypalCaptureId);

  await db.update(results).set({ earnedCents: 2000 }).where(eq(results.id, result!.id)); // the checker counted 4 sales
  say(`  The refund wait is ${settings.saleRefundWaitMinutes} minutes. Right now: ${JSON.stringify(await countSales(claim.id))}`);
  const early = await payWorker(result!.id);
  say(`  payWorker during the wait: paid ${formatCents(early.paidCents)}`);
  check("No commission is paid while the sales are still waiting", early.paidCents === 0 && !early.take);

  const b = await refundSale({ paypalOrderId: refundedHere });
  const bAtPayPal = await rawCallForProofs("GET", `/v2/payments/captures/${b.paypalCaptureId}`);
  say(`  Sale B refunded through Dibs: stored refunded ${formatCents(b.refundedCents)}; PayPal says the payment is ${String(bAtPayPal.status)}`);
  check("A full refund reads REFUNDED at PayPal and is stored in full", bAtPayPal.status === "REFUNDED" && b.refundedCents === 3200);
  let twice = "";
  await refundSale({ paypalOrderId: refundedHere }).catch((error: Error) => (twice = error.message));
  check(`Refunding it again is refused ("${twice}")`, twice.includes("already been refunded"));

  const d = await refundSale({ paypalOrderId: partly, amountCents: 1000 });
  const dAtPayPal = await rawCallForProofs("GET", `/v2/payments/captures/${d.paypalCaptureId}`);
  say(`  Sale D part refunded: stored refunded ${formatCents(d.refundedCents)}; PayPal says ${String(dAtPayPal.status)}`);
  check("A part refund reads PARTIALLY_REFUNDED at PayPal and the amount is stored", dAtPayPal.status === "PARTIALLY_REFUNDED" && d.refundedCents === 1000);

  const c = (await db.select().from(sales).where(eq(sales.paypalOrderId, refundedAtPayPal)))[0];
  await rawCallForProofs("POST", `/v2/payments/captures/${c.paypalCaptureId}/refund`, { requestId: randomBytes(12).toString("hex"), body: {} });
  say(`  Sale C refunded straight at PayPal. Dibs still has it stored as refunded ${formatCents(c.refundedCents)}.`);

  // Make the sales old enough, instead of sitting here for the wait.
  await db.update(sales).set({ at: new Date(Date.now() - settings.saleRefundWaitMinutes * 60_000 - 1000) }).where(eq(sales.claimId, claim.id));
  say("  (the sales' times were moved back past the wait, so this script does not have to sit and wait)");
  const pay = await payWorker(result!.id);
  const after = await countSales(claim.id);
  say(`  payWorker after the wait: paid ${formatCents(pay.paidCents)}; take ${pay.take?.paypalRef}, payout ${pay.payout?.paypalRef} (${pay.payout?.status})`);
  say(`  Sales now: ${JSON.stringify(after)}`);
  const cAfter = (await db.select().from(sales).where(eq(sales.paypalOrderId, refundedAtPayPal)))[0];
  check("The refund made at PayPal was found by reading the sale again", cAfter.refundedCents === 3200);
  check("Commission paid for 2 sales (A kept, D part kept), not 4: $10.00", pay.paidCents === 1000 && pay.take?.amountCents === 1000);
  check("Counted 2, refunded 2, kept $32.00 + $22.00", after.counted === 2 && after.refunded === 2 && after.keptCents === 5400);
  const again = await payWorker(result!.id);
  check("Asking again pays nothing more", again.paidCents === 0);

  say("The shop owner's orders page would show:");
  for (const o of await getShopOrders(poster.id)) say(`  ${o.sale.paypalOrderId}  paid ${formatCents(o.sale.amountCents)}  kept ${formatCents(o.keptCents)}  ${o.state}  (${o.workerName})`);

  const rest = await letGo(job.id);
  say("Step 5 preview: the job's money trail");
  const trail = await getMoneyTrail(job.id);
  for (const s of trail.steps) say(`  ${s.kind.padEnd(8)} ${formatCents(s.amountCents).padStart(7)}  ${s.status.padEnd(7)}  PayPal ${s.paypalRef}${s.takeRef ? ` (taken from the hold: ${s.takeRef})` : ""}  ${s.what}`);
  check("Trail is locked $50.00, one payment of $10.00, released $40.00", trail.steps.map((s) => `${s.kind}:${s.amountCents}`).join() === "locked:5000,payment:1000,released:4000" && rest.amountCents === 4000);

  const ok = checks.every(([, passed]) => passed);
  say(ok ? `RESULT: PASSED (${checks.length} of ${checks.length} checks)` : `RESULT: NOT PASSED (${checks.filter(([, p]) => !p).length} of ${checks.length} checks failed)`);
  await closeDb();
  process.exit(ok ? 0 : 1);
}

main().catch(async (error) => {
  console.error("STOPPED:", error instanceof Error ? error.message : error);
  await closeDb().catch(() => {});
  process.exit(1);
});
