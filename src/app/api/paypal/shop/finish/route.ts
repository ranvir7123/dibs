// POST /api/paypal/shop/finish { orderId }: called by the page when PayPal's
// button says the buyer approved. Takes the payment and counts the sale for
// the worker whose code is on PayPal's order. The amount and the code are read
// from PayPal's own answer. Answers { ok, paid, thanksUrl, creditedTo }. Lane A.
import { bodyOf, failed, no, yes } from "@/money/answer";
import { finishShopOrder } from "@/money/shop";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const orderId = String((await bodyOf(request)).orderId ?? "");
  if (!/^[A-Z0-9]{6,40}$/.test(orderId)) return no("Which PayPal order is this?");
  try {
    const outcome = await finishShopOrder(orderId);
    return yes({ paid: outcome.paid, thanksUrl: `/shop/thanks?order=${encodeURIComponent(outcome.paypalOrderId)}`, creditedTo: outcome.creditedTo, paypalRef: outcome.paypalRef });
  } catch (error) {
    return failed(error, "Shop order not finished");
  }
}