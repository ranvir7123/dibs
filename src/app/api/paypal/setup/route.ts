// GET /api/paypal/setup: the public values a page needs to draw PayPal's
// button and login link. Nothing secret: PayPal's client id is public. Lane A.
import { getPayPalSetup } from "@/money/login";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getPayPalSetup());
}