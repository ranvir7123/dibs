/**
 * Checks, against real PayPal test mode, the two facts Dibs leans on so that
 * asking twice never moves money twice:
 *   A. A take sent twice with the same request id is done once.
 *   B. A payout sent twice with the same batch id is refused the second time.
 * It also makes one real shop sale paid with PayPal's test card (part C), so
 * the shop's return page can be tried without a person signing in.
 *
 *   npx tsx src/money/proof/safety-checks.ts [worker-code-for-part-C]
 *
 * Pretend money only. Keys and emails are never printed.
 */
import "../../db/cli/env";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { getPayPal, PayPalProblem, rawCallForProofs, SALE_LABEL } from "../paypal";

const TEST_CARD = "4012888888881881"; // published on PayPal's sandbox card testing page
const KIT_KEYS = "C:\\dev\\paypal\\round4\\charity\\sandbox\\paypal-test-keys.env";
const say = (text = "") => console.log(text);
const card = { card: { number: TEST_CARD, expiry: "2030-12", security_code: "123", name: "Test Person" } };

function workerEmail(): string {
  const own = process.env.PAYPAL_TEST_WORKER_EMAIL?.trim();
  if (own) return own;
  const line = existsSync(KIT_KEYS) ? readFileSync(KIT_KEYS, "utf8").split(/\r?\n/).find((l) => l.trim().startsWith("PAYPAL_RECEIVER_EMAIL=")) : undefined;
  const email = line?.split("=", 2)[1]?.trim().replace(/^["']|["']$/g, "");
  if (!email) throw new Error("No pretend worker email.");
  return email;
}

async function main() {
  const paypal = getPayPal();
  say(`=== safety-checks at ${new Date().toISOString()} (PayPal test mode) ===`);

  say("A. The same take sent twice (same request id)");
  const order = await rawCallForProofs("POST", "/v2/checkout/orders", {
    requestId: randomBytes(12).toString("hex"),
    body: { intent: "AUTHORIZE", purchase_units: [{ amount: { currency_code: "USD", value: "5.00" } }], payment_source: card },
  });
  const units = order.purchase_units as { payments: { authorizations: { id: string }[] } }[];
  const hold = units[0].payments.authorizations[0].id;
  const id = "mov_proof" + randomBytes(4).toString("hex");
  const take = { authorizationId: hold, requestId: id, amountCents: 100, invoiceId: id, note: "Safety check" };
  const first = await paypal.takeFromHold(take);
  const second = await paypal.takeFromHold(take);
  say(`  First answer:  ${first.status} ${first.id}`);
  say(`  Second answer: ${second.status} ${second.id}`);
  const after = await rawCallForProofs("GET", `/v2/payments/authorizations/${hold}`);
  say(`  Same PayPal reference both times: ${first.id === second.id}. Hold now: ${String(after.status)}`);
  say("  A new request id with the SAME invoice number (what a careless retry would send):");
  try {
    const third = await paypal.takeFromHold({ ...take, requestId: id + "x" });
    say(`    PayPal took again: ${third.status} ${third.id}  <-- would be a double take`);
  } catch (error) {
    say(`    PayPal refused: ${error instanceof PayPalProblem ? error.issues.join(", ") : String(error)}`);
  }
  await paypal.voidHold(hold);
  say("  Hold let go.");
  say(`  Letting the same hold go a second time: ${(await paypal.voidHold(hold)).status} (no error)`);

  say("B. The same payout sent twice (same batch id)");
  const batch = "mov_proof" + randomBytes(4).toString("hex");
  const payout = { batchId: batch, email: workerEmail(), amountCents: 100, note: "Safety check. Test mode: pretend money.", subject: "Safety check" };
  const sent = await paypal.sendPayout(payout);
  say(`  First send: accepted, PayPal batch ${sent.batchId}`);
  try {
    const again = await paypal.sendPayout(payout);
    say(`  Second send: ACCEPTED, PayPal batch ${again.batchId}  <-- same batch number means PayPal did not pay twice: ${again.batchId === sent.batchId}`);
  } catch (error) {
    say(`  Second send: refused (status ${error instanceof PayPalProblem ? `${error.status}, ${error.issues.join(", ")}` : String(error)})`);
  }

  const code = process.argv[2];
  if (code) {
    say(`C. A real $32.00 shop sale paid with PayPal's test card, carrying the worker code "${code}"`);
    const sale = await rawCallForProofs("POST", "/v2/checkout/orders", {
      requestId: randomBytes(12).toString("hex"),
      body: { intent: "CAPTURE", purchase_units: [{ description: "Loom & Thread: Handwoven cotton scarf", custom_id: SALE_LABEL + code, amount: { currency_code: "USD", value: "32.00" } }], payment_source: card },
    });
    say(`  PayPal order ${String(sale.id)}: ${String(sale.status)}`);
  }
}

main().catch((error) => {
  console.error("STOPPED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
