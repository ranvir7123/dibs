/**
 * Locks a draft job's money with PayPal's published test card, for runs where
 * nobody is there to sign in as the pretend buyer. It is the same path as
 * src/money/proof/hold-pay-letgo.ts: PayPal test mode makes a real hold, then
 * the site's own confirmHold() opens the job. No database row is faked.
 *
 *   npx tsx scripts/join-hold.ts <jobId>
 *   npx tsx scripts/join-hold.ts --copy <jobId> --only-rule "Shows elephants at a zoo"
 *
 * --copy makes a new draft from an existing job's card, keeping one single
 * "must show" rule in place of the card's own, and then locks that copy. It
 * exists so a real public video (which cannot name the poster) can be used to
 * show real views being read and paid for. The copy's title says it is a copy.
 *
 * Stop the app first: only one program can have the laptop's database open.
 */
import "../src/db/cli/env";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { formatCents } from "../src/contract/money";
import type { JobCard } from "../src/contract/types";
import { closeDb, getDb } from "../src/db/client";
import { jobs } from "../src/db/schema";
import { createJob } from "../src/db/write";
import { confirmHold } from "../src/money";
import { JOB_LABEL, rawCallForProofs } from "../src/money/paypal";

const TEST_CARD = "4012888888881881"; // published on PayPal's sandbox card testing page

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { copy: { type: "string" }, "only-rule": { type: "string" } },
  });
  const db = await getDb();
  let jobId = positionals[0];

  if (values.copy) {
    const from = (await db.select().from(jobs).where(eq(jobs.id, values.copy)))[0];
    if (!from) throw new Error(`No job ${values.copy}.`);
    const label = values["only-rule"]?.trim();
    if (!label) throw new Error('Say the one rule the video must meet: --only-rule "Shows elephants at a zoo"');
    const card: JobCard = {
      ...from.card,
      title: `${from.card.title} (join-run copy)`,
      howChecked: [`AI watches each video before any pay and checks one thing: ${label}.`, ...from.card.howChecked.filter((line) => !/AI watches/i.test(line))],
      checker: { ...from.card.checker, mustShow: [{ id: "only_rule", label, detail: `The video clearly shows this: ${label}.` }] },
    };
    const copy = await createJob({ posterId: from.posterId, sentence: from.sentence, card });
    console.log(`Made draft ${copy.id} from ${from.id}, with the single video rule "${label}".`);
    jobId = copy.id;
  }

  if (!jobId) throw new Error("Give a job id.");
  const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0];
  if (!job) throw new Error(`No job ${jobId}.`);
  if (job.status !== "draft") throw new Error(`Job ${jobId} is already ${job.status}.`);

  const order = await rawCallForProofs("POST", "/v2/checkout/orders", {
    requestId: randomBytes(12).toString("hex"),
    body: {
      intent: "AUTHORIZE",
      purchase_units: [{ description: `Dibs job: ${job.title}`.slice(0, 120), custom_id: JOB_LABEL + job.id, amount: { currency_code: "USD", value: (job.budgetCents / 100).toFixed(2) } }],
      payment_source: { card: { number: TEST_CARD, expiry: "2030-12", security_code: "123", name: "Test Person" } },
    },
  });
  await db.update(jobs).set({ paypalOrderId: String(order.id) }).where(eq(jobs.id, job.id));
  const hold = await confirmHold(job.id);
  const after = (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0];
  console.log(`${job.id} "${job.title}"`);
  console.log(`  PayPal order ${String(order.id)} (paid with PayPal's test card)`);
  console.log(`  Held ${formatCents(hold.amountCents)}  ${hold.status}  PayPal's number for the hold: ${hold.paypalRef}`);
  console.log(`  Job status is now: ${after.status}`);
}

main()
  .catch((error) => {
    console.error("STOPPED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
