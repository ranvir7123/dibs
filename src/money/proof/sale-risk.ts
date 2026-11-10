/**
 * Lane A's riskiest outside fact, tested against real PayPal test mode:
 *   1. Does PayPal call our server when a sale happens, with a signature we can check,
 *      carrying the worker's code?
 *   2. Can a buyer pay with a PayPal test ACCOUNT (not a raw card number)?
 *
 * Run (PowerShell), with a tunnel pointing at port 3091:
 *   npx tsx src/money/proof/sale-risk.ts https://<tunnel-address>            part 1 only
 *   npx tsx src/money/proof/sale-risk.ts https://<tunnel-address> --buyer    parts 1 and 2
 *
 * Part 2 prints a PayPal link. A person opens it and signs in as the pretend
 * buyer; this script waits, then takes the payment.
 * Pretend money only. Keys and emails are never printed.
 */
import "../../db/cli/env";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { addWebhook, getPayPal, rawCallForProofs, removeWebhook, SALE_LABEL, type WebhookHeaders } from "../paypal";

const PORT = 3091;
const TEST_CARD = "4012888888881881"; // published on PayPal's sandbox card testing page

interface Arrived {
  headers: WebhookHeaders;
  rawBody: string;
}

const arrived: Arrived[] = [];
const say = (text: string) => console.log(text);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(webhookId: string, wantedOrder: string, seconds: number): Promise<boolean> {
  const started = Date.now();
  let seen = 0;
  while (Date.now() - started < seconds * 1000) {
    while (seen < arrived.length) {
      const message = arrived[seen++];
      const event = JSON.parse(message.rawBody) as { event_type?: string; resource?: Record<string, unknown> };
      const resource = event.resource ?? {};
      const related = ((resource.supplementary_data as Record<string, unknown> | undefined)?.related_ids ?? {}) as Record<string, unknown>;
      const orderId = related.order_id ?? resource.id;
      const real = await getPayPal().verifyWebhook({ webhookId, headers: message.headers, rawBody: message.rawBody });
      say(`  PayPal called our server after ${((Date.now() - started) / 1000).toFixed(1)} seconds: ${event.event_type}`);
      say(`    Signature check by PayPal: ${real ? "REAL (SUCCESS)" : "FAILED"}`);
      say(`    Order it is about: ${String(orderId)}   our label on it: ${String(resource.custom_id ?? "none")}`);
      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && orderId === wantedOrder) {
        const tampered = await getPayPal().verifyWebhook({ webhookId, headers: message.headers, rawBody: message.rawBody.replace(SALE_LABEL, "dibs-sale:x") });
        say(`    Same message with the worker's code changed by one letter: ${tampered ? "ACCEPTED (bad)" : "REFUSED (good)"}`);
        return real && !tampered;
      }
    }
    await sleep(500);
  }
  say(`  Nothing arrived for order ${wantedOrder} within ${seconds} seconds.`);
  return false;
}

async function main() {
  const publicUrl = process.argv[2];
  const withBuyer = process.argv.includes("--buyer");
  if (!publicUrl?.startsWith("https://")) throw new Error("Give the tunnel's https address as the first argument.");

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const h = (name: string) => String(request.headers[name] ?? "");
      if (request.method === "POST") {
        arrived.push({
          rawBody: Buffer.concat(chunks).toString("utf8"),
          headers: {
            authAlgo: h("paypal-auth-algo"),
            certUrl: h("paypal-cert-url"),
            transmissionId: h("paypal-transmission-id"),
            transmissionSig: h("paypal-transmission-sig"),
            transmissionTime: h("paypal-transmission-time"),
          },
        });
      }
      response.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  say(`=== sale-risk at ${new Date().toISOString()} ===`);
  const webhookId = await addWebhook(`${publicUrl.replace(/\/+$/, "")}/api/paypal/webhook`);
  say(`Told PayPal our address. PayPal's number for it: ${webhookId}`);
  let ok = true;
  try {
    const code = "test" + randomBytes(2).toString("hex");
    say(`Part 1: a $32.00 sale paid with PayPal's test card, carrying the worker code "${code}"`);
    const order = await rawCallForProofs("POST", "/v2/checkout/orders", {
      requestId: randomBytes(12).toString("hex"),
      body: {
        intent: "CAPTURE",
        purchase_units: [{ description: "Risk test sale", custom_id: SALE_LABEL + code, amount: { currency_code: "USD", value: "32.00" } }],
        payment_source: { card: { number: TEST_CARD, expiry: "2030-12", security_code: "123", name: "Test Person" } },
      },
    });
    say(`  Order ${String(order.id)}: ${String(order.status)}`);
    ok = (await waitFor(webhookId, String(order.id), 120)) && ok;

    if (withBuyer) {
      const code2 = "test" + randomBytes(2).toString("hex");
      say(`Part 2: a $32.00 sale a buyer pays with a PayPal test account, worker code "${code2}"`);
      const sale = await getPayPal().createSaleOrder({
        requestId: randomBytes(12).toString("hex"),
        amountCents: 3200,
        description: "Risk test sale",
        customId: SALE_LABEL + code2,
        returnUrl: "https://example.com/paid",
        cancelUrl: "https://example.com/cancelled",
      });
      const linkFile = path.join(process.cwd(), ".data", "lane-a-buyer-link.txt");
      writeFileSync(linkFile, sale.approveUrl ?? "");
      say(`  Order ${sale.id}: ${sale.status}`);
      say(`  OPEN THIS and sign in as the pretend buyer: ${sale.approveUrl}`);
      say(`  (also saved in ${linkFile}). Waiting up to 15 minutes...`);
      const started = Date.now();
      let status = sale.status;
      while (Date.now() - started < 15 * 60_000 && status !== "APPROVED" && status !== "COMPLETED") {
        await sleep(4000);
        status = (await getPayPal().getOrder(sale.id)).status;
      }
      if (status !== "APPROVED" && status !== "COMPLETED") {
        say("  Nobody approved it in time. Part 2 NOT tested.");
        ok = false;
      } else {
        say(`  The buyer approved after ${((Date.now() - started) / 1000).toFixed(0)} seconds.`);
        const paid = await getPayPal().captureOrder(sale.id, `risk-${sale.id}`);
        say(`  Payment taken: order ${paid.status}, PayPal reference ${paid.capture?.id}, amount ${paid.capture?.amountCents} cents`);
        say(`  Paid with a PayPal account (not a raw card): ${paid.paidWithPayPalAccount}`);
        say(`  Our label came back on the order: ${paid.customId === SALE_LABEL + code2}`);
        ok = paid.paidWithPayPalAccount && (await waitFor(webhookId, sale.id, 120)) && ok;
      }
    }
  } finally {
    await removeWebhook(webhookId).catch(() => say("  (could not remove the test address from PayPal)"));
    server.close();
  }
  say(ok ? "RESULT: PASSED" : "RESULT: NOT PASSED");
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error("STOPPED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
