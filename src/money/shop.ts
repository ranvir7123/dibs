/**
 * The small shop Dibs hosts for the sales demo: one product, paid with PayPal.
 * The buyer's order carries the worker's code, so PayPal itself is the proof
 * of who brought the sale.
 *
 * The shop's name, product and price are starting values. Change them here.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { claims, jobs, people, sales, trackedLinks } from "../db/schema";
import { MoneyRefusal, recordSale } from "./index";
import { getPayPal, PayPalProblem, SALE_LABEL } from "./paypal";

export const shopItem = {
  shopName: "Loom & Thread",
  name: "Handwoven cotton scarf",
  blurb: "Woven by hand on a wooden loom, in undyed cotton. One size, 180 cm long.",
  priceCents: 3200,
};

/** A worker's code looks like this: 8 lowercase letters and digits. Anything else is ignored. */
export function cleanCode(text: string | null | undefined): string | null {
  const code = (text ?? "").trim().toLowerCase();
  return /^[a-z0-9]{4,32}$/.test(code) ? code : null;
}

/** Who a code belongs to, or null when nobody has it. */
export async function whoseCode(code: string | null): Promise<{ code: string; workerName: string; jobOpen: boolean } | null> {
  if (!code) return null;
  const db = await getDb();
  const row = (
    await db
      .select({ code: trackedLinks.code, workerName: people.name, status: jobs.status })
      .from(trackedLinks)
      .innerJoin(claims, eq(claims.id, trackedLinks.claimId))
      .innerJoin(people, eq(people.id, claims.workerId))
      .innerJoin(jobs, eq(jobs.id, trackedLinks.jobId))
      .where(eq(trackedLinks.code, code))
  )[0];
  return row ? { code: row.code, workerName: row.workerName, jobOpen: row.status === "open" } : null;
}

/** Starts the buyer's PayPal order and returns PayPal's page to pay on. */
export async function startShopOrder(input: { code: string | null; base: string }): Promise<{ paypalOrderId: string; approveUrl: string }> {
  const back = input.code ? `?ref=${encodeURIComponent(input.code)}` : "";
  const order = await getPayPal().createSaleOrder({
    requestId: `sale-${randomBytes(12).toString("hex")}`,
    amountCents: shopItem.priceCents,
    description: `${shopItem.shopName}: ${shopItem.name}`,
    customId: SALE_LABEL + (input.code ?? ""),
    returnUrl: `${input.base}/api/paypal/shop/return`,
    cancelUrl: `${input.base}/shop${back}${back ? "&" : "?"}paid=cancelled`,
  });
  if (!order.approveUrl) throw new Error("PayPal did not give a page to pay on.");
  return { paypalOrderId: order.id, approveUrl: order.approveUrl };
}

export interface ShopOutcome {
  paypalOrderId: string;
  /** True once PayPal has taken the buyer's payment. */
  paid: boolean;
  /** PayPal's reference for the payment. */
  paypalRef: string | null;
  amountCents: number | null;
  /** The worker's code that was on the order, if any. */
  code: string | null;
  /** The worker the sale was counted for, or null when it was counted for nobody. */
  creditedTo: string | null;
  /** Why it was counted for nobody, in plain words. Null when it was counted, or there was no code. */
  notCountedBecause: string | null;
}

/**
 * Finishes a shop order after the buyer approved it on PayPal: takes the
 * payment and counts the sale for the worker whose code is on the order.
 * Everything is read from PayPal's own answer, never from the browser.
 * Safe to call twice: the payment is taken once and the sale stored once.
 */
export async function finishShopOrder(paypalOrderId: string): Promise<ShopOutcome> {
  const paypal = getPayPal();
  let order = await paypal.getOrder(paypalOrderId);
  const label = order.customId ?? "";
  if (!label.startsWith(SALE_LABEL)) throw new MoneyRefusal("That PayPal order is not from this shop.");
  if (order.status === "APPROVED" && !order.capture) {
    try {
      order = await paypal.captureOrder(order.id, `capture-${order.id}`);
    } catch (error) {
      if (error instanceof PayPalProblem && error.issues.includes("ORDER_ALREADY_CAPTURED")) order = await paypal.getOrder(order.id);
      else throw error;
    }
  }
  const code = cleanCode(label.slice(SALE_LABEL.length));
  const paid = order.status === "COMPLETED" && order.capture?.status === "COMPLETED";
  const outcome: ShopOutcome = { paypalOrderId: order.id, paid, paypalRef: order.capture?.id ?? null, amountCents: order.capture?.amountCents ?? order.amountCents, code, creditedTo: null, notCountedBecause: null };
  if (!paid || !code || !order.capture) return outcome;
  try {
    await recordSale({ paypalOrderId: order.id, linkCode: code, amountCents: order.capture.amountCents });
    outcome.creditedTo = (await whoseCode(code))?.workerName ?? null;
  } catch (error) {
    if (!(error instanceof MoneyRefusal)) throw error; // a fault, not a "no": let the caller try again
    outcome.notCountedBecause = error.message;
  }
  return outcome;
}

/** Whether a sale is stored for a PayPal order (for the thank-you page). */
export async function saleFor(paypalOrderId: string) {
  const db = await getDb();
  return (await db.select().from(sales).where(eq(sales.paypalOrderId, paypalOrderId)))[0] ?? null;
}
