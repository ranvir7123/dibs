// GET /api/paypal/shop/return?token=<PayPal order>: PayPal sends the buyer
// back here after they approved. Takes the payment, counts the sale for the
// worker whose code is on the order, and shows the thank-you page. Lane A.
import { siteBase } from "@/money/site";
import { finishShopOrder } from "@/money/shop";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = siteBase(request);
  const orderId = new URL(request.url).searchParams.get("token") ?? "";
  if (!orderId) return Response.redirect(`${base}/shop`, 303);
  try {
    const outcome = await finishShopOrder(orderId);
    if (outcome.paid) return Response.redirect(`${base}/shop/thanks?order=${encodeURIComponent(outcome.paypalOrderId)}`, 303);
    return Response.redirect(`${base}/shop?${outcome.code ? `ref=${encodeURIComponent(outcome.code)}&` : ""}paid=failed`, 303);
  } catch (error) {
    console.error("Shop order not finished:", error instanceof Error ? error.message : error);
    return Response.redirect(`${base}/shop?paid=failed`, 303);
  }
}
