/**
 * Sales after they are recorded: refunds, reading a sale's state again from
 * PayPal, which sales count for commission, and the shop owner's list.
 *
 * The rule: a sale counts once it is past the refund wait
 * (settings.saleRefundWaitMinutes) and has not been refunded in full. What was
 * refunded is always read from PayPal's own record of the order.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { isCents } from "../contract/money";
import type { Job, Sale, SaleState, ShopOrder } from "../contract/types";
import { getDb, type Db } from "../db/client";
import { claims, jobs, people, sales } from "../db/schema";
import { settings } from "../settings";
import { getPayPal, PayPalProblem } from "./paypal";
import { MoneyRefusal } from "./refusal";

type Reader = Pick<Db, "select">;

/** When the refund wait ends for a sale. */
export function countsAt(sale: Pick<Sale, "at">): Date {
  return new Date(sale.at.getTime() + settings.saleRefundWaitMinutes * 60_000);
}

/** Where a sale stands for commission at a given moment. */
export function saleState(sale: Pick<Sale, "at" | "amountCents" | "refundedCents">, now: Date = new Date()): SaleState {
  if (sale.refundedCents >= sale.amountCents) return "refunded";
  if (countsAt(sale).getTime() > now.getTime()) return "waiting";
  return sale.refundedCents > 0 ? "part_refunded" : "counted";
}

function addUp(rows: Sale[], now: Date) {
  const out = { counted: 0, waiting: 0, refunded: 0, keptCents: 0 };
  for (const sale of rows) {
    const state = saleState(sale, now);
    if (state === "refunded") out.refunded += 1;
    else if (state === "waiting") out.waiting += 1;
    else {
      out.counted += 1;
      out.keptCents += sale.amountCents - sale.refundedCents;
    }
  }
  return out;
}

/**
 * The sales that count for a claim right now. counted: not refunded in full
 * and past the refund wait (a partly refunded sale is still one sale).
 * waiting: too new. refunded: all of it went back. keptCents: what the shop
 * kept on the counted ones.
 */
export async function countSales(claimId: string, now: Date = new Date()): Promise<{ counted: number; waiting: number; refunded: number; keptCents: number }> {
  const db = await getDb();
  return addUp(await db.select().from(sales).where(eq(sales.claimId, claimId)), now);
}

/**
 * The most commission a sales job's pay rule allows for a claim right now.
 * For any other pay rule there is no limit from sales.
 */
export async function commissionCapCents(reader: Reader, job: Pick<Job, "card">, claimId: string, now: Date = new Date()): Promise<number> {
  const rule = job.card.payRule;
  if (rule.kind !== "per_unit" || rule.unit !== "sale") return Number.MAX_SAFE_INTEGER;
  const { counted } = addUp(await reader.select().from(sales).where(eq(sales.claimId, claimId)), now);
  return Math.floor(counted / rule.batchSize) * rule.centsPerBatch;
}

async function saleByOrder(paypalOrderId: string): Promise<Sale> {
  const db = await getDb();
  const sale = (await db.select().from(sales).where(eq(sales.paypalOrderId, paypalOrderId.trim())))[0];
  if (!sale) throw new MoneyRefusal("No sale is stored for that PayPal order.");
  return sale;
}

/**
 * Reads a sale's state again from PayPal and stores how much was refunded.
 * The stored amount only ever goes up: a refund cannot be undone.
 */
export async function refreshSale(paypalOrderId: string): Promise<Sale> {
  const sale = await saleByOrder(paypalOrderId);
  const order = await getPayPal().getOrder(sale.paypalOrderId);
  const gone = order.capture?.status === "REFUNDED" || order.capture?.status === "REVERSED";
  const refunded = Math.min(sale.amountCents, Math.max(sale.refundedCents, gone ? sale.amountCents : order.refundedCents));
  const captureId = sale.paypalCaptureId ?? order.capture?.id ?? null;
  if (refunded === sale.refundedCents && captureId === sale.paypalCaptureId) return sale;
  const db = await getDb();
  return (
    await db
      .update(sales)
      .set({ refundedCents: refunded, paypalCaptureId: captureId, ...(refunded > sale.refundedCents ? { refundedAt: new Date() } : {}) })
      .where(eq(sales.id, sale.id))
      .returning()
  )[0];
}

/** PayPal's order numbers are capital letters and digits. Sample rows (SAMPLE-...) are not PayPal's and are left alone. */
const looksLikePayPal = (orderId: string) => /^[A-Z0-9]{10,24}$/.test(orderId);

/**
 * Reads every not-yet-refunded sale of a claim again from PayPal. payWorker
 * does this before paying commission. If PayPal cannot be reached this throws,
 * so nothing is paid on stale news.
 */
export async function refreshClaimSales(claimId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select().from(sales).where(eq(sales.claimId, claimId));
  for (const sale of rows) {
    if (sale.refundedCents >= sale.amountCents || !looksLikePayPal(sale.paypalOrderId)) continue;
    try {
      await refreshSale(sale.paypalOrderId);
    } catch (error) {
      // PayPal does not know this order (a sample row): nothing to learn. Anything else stops the payment.
      if (error instanceof PayPalProblem && error.status === 404) continue;
      throw error;
    }
  }
}

/**
 * Refunds a shop sale at PayPal: all that is left of it, or amountCents of
 * it. Then reads the sale again from PayPal and stores what was refunded.
 * Pressing twice cannot refund twice: the same request gets PayPal's first answer.
 */
export async function refundSale(input: { paypalOrderId: string; amountCents?: number }): Promise<Sale> {
  let sale = await refreshSale(input.paypalOrderId);
  const left = sale.amountCents - sale.refundedCents;
  if (left <= 0) throw new MoneyRefusal("This sale has already been refunded in full.");
  const amount = input.amountCents ?? left;
  if (!isCents(amount) || amount <= 0) throw new MoneyRefusal("A refund must be whole cents, above zero.");
  if (amount > left) throw new MoneyRefusal("That is more than is left to refund on this sale.");
  if (!sale.paypalCaptureId) throw new MoneyRefusal("PayPal has no payment on this order to refund.");

  await getPayPal().refundPayment({
    captureId: sale.paypalCaptureId,
    requestId: `refund-${sale.id}-${sale.refundedCents}-${amount}`,
    // An empty request gives all of it back, which is what "all that is left" means on an untouched sale.
    amountCents: amount === sale.amountCents ? undefined : amount,
    note: "Refund from the shop (test mode)",
  });
  sale = await refreshSale(sale.paypalOrderId);
  // PayPal's list of refunds can lag a moment behind the refund it just made.
  if (sale.refundedCents < Math.min(sale.amountCents, sale.amountCents - left + amount)) {
    const db = await getDb();
    sale = (await db.update(sales).set({ refundedCents: sale.amountCents - left + amount, refundedAt: new Date() }).where(eq(sales.id, sale.id)).returning())[0];
  }
  return sale;
}

/** Every sale on the jobs this person posted, newest first, for the shop owner's orders page. */
export async function getShopOrders(posterId: string, now: Date = new Date()): Promise<ShopOrder[]> {
  const db = await getDb();
  const mine = await db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.posterId, posterId));
  if (!mine.length) return [];
  const titles = new Map(mine.map((j) => [j.id, j.title]));
  const rows = await db
    .select({ sale: sales, workerName: people.name })
    .from(sales)
    .innerJoin(claims, eq(claims.id, sales.claimId))
    .innerJoin(people, eq(people.id, claims.workerId))
    .where(inArray(sales.jobId, [...titles.keys()]))
    .orderBy(desc(sales.at));
  return rows.map(({ sale, workerName }) => ({
    sale,
    workerName,
    jobTitle: titles.get(sale.jobId) ?? "",
    keptCents: sale.amountCents - sale.refundedCents,
    state: saleState(sale, now),
    countsAt: countsAt(sale),
  }));
}

/** May this person refund this order? Only the poster of the job the sale belongs to. */
export async function ownsSale(personId: string | null | undefined, paypalOrderId: string): Promise<boolean> {
  if (!personId) return false;
  const db = await getDb();
  const row = (await db.select({ posterId: jobs.posterId }).from(sales).innerJoin(jobs, eq(jobs.id, sales.jobId)).where(eq(sales.paypalOrderId, paypalOrderId.trim())))[0];
  return row?.posterId === personId;
}
