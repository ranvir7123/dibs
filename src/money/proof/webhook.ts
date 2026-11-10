/**
 * Tells PayPal (test mode) the address to call about sales, approved holds
 * and payouts, and shows or removes the addresses it already has.
 *
 *   npx tsx src/money/proof/webhook.ts list
 *   npx tsx src/money/proof/webhook.ts add https://<site>/api/paypal/webhook
 *   npx tsx src/money/proof/webhook.ts remove <number>
 *
 * "add" prints the number to put in .env.local as PAYPAL_WEBHOOK_ID.
 */
import "../../db/cli/env";
import { addWebhook, listWebhooks, removeWebhook } from "../paypal";

async function main() {
  const [command, value] = process.argv.slice(2);
  if (command === "list") {
    const all = await listWebhooks();
    console.log(all.length ? all.map((w) => `${w.id}  ${w.url}`).join("\n") : "PayPal has no address for this app yet.");
  } else if (command === "add" && value?.startsWith("https://")) {
    console.log(`PayPal will call ${value}`);
    console.log(`Put this in .env.local:  PAYPAL_WEBHOOK_ID=${await addWebhook(value)}`);
  } else if (command === "remove" && value) {
    await removeWebhook(value);
    console.log(`Removed ${value}.`);
  } else {
    console.log("Use: list | add https://<site>/api/paypal/webhook | remove <number>");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("STOPPED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
