// POST /api/paypal/refund { orderId, amountCents? }: the shop owner gives a
// sale back to the buyer, all of it or part. Only the poster of the job the
// sale belongs to may ask. Answers { ok, sale }. Lane A.
import { refundSale } from "@/money";
import { bodyOf, callerId, failed, no, yes } from "@/money/answer";
import { ownsSale, saleState } from "@/money/sales";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await bodyOf(request);
  const orderId = String(body.orderId ?? "");
  if (!orderId) return no("Which order is this?");
  const amountCents = typeof body.amountCents === "number" ? body.amountCents : undefined;
  try {
    if (!(await ownsSale(callerId(request), orderId))) return no("Only the shop that made this sale can refund it.", 403);
    const sale = await refundSale({ paypalOrderId: orderId, amountCents });
    return yes({ sale: { paypalOrderId: sale.paypalOrderId, amountCents: sale.amountCents, refundedCents: sale.refundedCents, state: saleState(sale) } });
  } catch (error) {
    return failed(error, "Refund not made");
  }
}