// POST /api/paypal/shop/order { ref }: makes the buyer's PayPal order for the
// shop, for PayPal's button (its window opens over the page). The order
// carries the worker's code. Answers { ok, orderId }. Lane A.
import { bodyOf, failed, yes } from "@/money/answer";
import { cleanCode, startShopOrder, whoseCode } from "@/money/shop";
import { siteBase } from "@/money/site";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ref = (await bodyOf(request)).ref;
  try {
    // Only a code that belongs to an open job is put on the order.
    const owner = await whoseCode(cleanCode(typeof ref === "string" ? ref : null));
    const order = await startShopOrder({ code: owner?.jobOpen ? owner.code : null, base: siteBase(request), inWindow: true });
    return yes({ orderId: order.paypalOrderId });
  } catch (error) {
    return failed(error, "Shop order not made");
  }
}