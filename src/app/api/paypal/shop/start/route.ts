// POST /api/paypal/shop/start: the shop's "Pay with PayPal" button posts here.
// Makes the buyer's PayPal order (carrying the worker's code) and sends the
// buyer to PayPal's own page to pay. Lane A.
import { siteBase } from "@/money/site";
import { cleanCode, startShopOrder } from "@/money/shop";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const base = siteBase(request);
  const form = await request.formData().catch(() => null);
  const code = cleanCode(typeof form?.get("ref") === "string" ? (form.get("ref") as string) : null);
  const back = `${base}/shop${code ? `?ref=${encodeURIComponent(code)}&` : "?"}`;
  try {
    const order = await startShopOrder({ code, base });
    return Response.redirect(order.approveUrl, 303);
  } catch (error) {
    console.error("Shop order not started:", error instanceof Error ? error.message : error);
    return Response.redirect(`${back}paid=failed`, 303);
  }
}
