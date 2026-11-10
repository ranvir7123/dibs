// POST /api/paypal/webhook: the address PayPal calls to tell Dibs about a
// sale, an approved hold or a finished payout. Lane A.
// Each message is checked with PayPal before anything is done with it.
import { handlePayPalMessage } from "@/money/webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // The message is read as plain text: the check needs it exactly as it arrived.
  const rawBody = await request.text();
  try {
    const answer = await handlePayPalMessage(request.headers, rawBody);
    return new Response(answer.body, { status: answer.status });
  } catch (error) {
    console.error("PayPal message could not be handled:", error instanceof Error ? error.message : error);
    return new Response("Could not handle this right now. Send it again.", { status: 500 });
  }
}
