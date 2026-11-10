/**
 * Lane A's proof, run against real PayPal test mode (pretend money):
 * hold $50.00 for a job, pay a worker $4.00, then $8.40 more (asked twice at
 * the same moment, to show it pays once), then let the rest go.
 * Everything goes through the same functions the site uses.
 *
 *   npx tsx src/money/proof/hold-pay-letgo.ts            the hold is paid with PayPal's published test card
 *   npx tsx src/money/proof/hold-pay-letgo.ts --approve  prints PayPal's page; a person approves as the pretend buyer
 *
 * Uses its own database folder (.data/lane-a-proof). Keys and emails are never printed.
 */
import "../../db/cli/env";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { formatCents } from "../../contract/money";
import type { JobCard, PayOutcome } from "../../contract/types";
import { closeDb, getDb } from "../../db/client";
import { getJobMoney } from "../../db/read";
import { jobs, moneyMoves, results } from "../../db/schema";
import { callDibs, createJob, handIn, joinDibs } from "../../db/write";
import { confirmHold, letGo, payWorker, startHold } from "../index";
import { JOB_LABEL, rawCallForProofs } from "../paypal";

process.env.DIBS_DATA_DIR = ".data/lane-a-proof";
process.env.DATABASE_URL = "";

const TEST_CARD = "4012888888881881"; // published on PayPal's sandbox card testing page
const KIT_KEYS = "C:\\dev\\paypal\\round4\\charity\\sandbox\\paypal-test-keys.env";
const say = (text = "") => console.log(text);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The pretend worker's email: from .env.local, or the receiver the earlier test kit already paid. */
function workerEmail(): { email: string; from: string } {
  const own = process.env.PAYPAL_TEST_WORKER_EMAIL?.trim();
  if (own) return { email: own, from: "PAYPAL_TEST_WORKER_EMAIL in .env.local" };
  if (existsSync(KIT_KEYS)) {
    const line = readFileSync(KIT_KEYS, "utf8").split(/\r?\n/).find((l) => l.trim().startsWith("PAYPAL_RECEIVER_EMAIL="));
    const email = line?.split("=", 2)[1]?.trim().replace(/^["']|["']$/g, "");
    if (email) return { email, from: "the earlier test kit's receiver (PAYPAL_TEST_WORKER_EMAIL is not set yet)" };
  }
  throw new Error("No pretend worker email. Put PAYPAL_TEST_WORKER_EMAIL in .env.local.");
}

function show(label: string, outcome: PayOutcome) {
  say(`  ${label}: paid ${formatCents(outcome.paidCents)}`);
  if (outcome.take) say(`    taken from the hold: ${formatCents(outcome.take.amountCents)}  ${outcome.take.status}  PayPal reference ${outcome.take.paypalRef}`);
  if (outcome.payout) say(`    sent to the worker:  ${formatCents(outcome.payout.amountCents)}  ${outcome.payout.status}  PayPal reference ${outcome.payout.paypalRef}`);
  if (!outcome.take && !outcome.payout) say("    nothing was owed, so nothing moved");
}

async function main() {
  const byPerson = process.argv.includes("--approve");
  const db = await getDb();
  const worker = workerEmail();
  say(`=== hold-pay-letgo at ${new Date().toISOString()} (PayPal test mode, pretend money) ===`);
  say(`Worker's PayPal email comes from ${worker.from}.`);

  const poster = await joinDibs({ name: "Kettle & Clove", paypalEmail: process.env.PAYPAL_TEST_BUYER_EMAIL?.trim() || "kettle.poster@example.com" });
  const card: JobCard = {
    title: "Get our launch video 10,000 views",
    category: "promotion",
    finishLine: "10,000 views on your launch video",
    target: { unit: "view", count: 10000 },
    howChecked: ["Views are read from the video site's own count."],
    checkedByLine: "The video site's own view count",
    cheatTestsLine: "Sudden jumps in views.",
    payRule: { kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 200, batchSize: 1000 },
    payLine: "$2.00 for every 1,000 views",
    payNote: "Up to $50.00 in total",
    capCents: 5000,
    endsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
    proofStrength: "weak",
    proofNote: "Views can be bought.",
    proofTip: null,
    targetUrl: null,
    checker: { evidence: ["public_page"], handIn: "link", mustShow: [], cheatTests: [], machineCheckable: true },
  };
  const job = await createJob({ posterId: poster.id, sentence: "Get my launch video 10,000 views, $2 per 1,000, up to $50", card });

  say("Step 1: hold $50.00");
  if (byPerson) {
    const start = await startHold(job.id);
    say(`  PayPal order ${start.paypalOrderId}`);
    say(`  OPEN THIS and approve as the pretend buyer: ${start.approveUrl}`);
    say("  Waiting up to 15 minutes...");
    const started = Date.now();
    for (;;) {
      try {
        await confirmHold(job.id);
        break;
      } catch (error) {
        if (Date.now() - started > 15 * 60_000 || !(error instanceof Error && error.message.includes("not been approved"))) throw error;
        await sleep(4000);
      }
    }
  } else {
    // No person is here to approve, so the order is paid with PayPal's test card.
    // Everything after this line is the site's own code.
    const order = await rawCallForProofs("POST", "/v2/checkout/orders", {
      requestId: randomBytes(12).toString("hex"),
      body: {
        intent: "AUTHORIZE",
        purchase_units: [{ description: `Dibs job: ${job.title}`, custom_id: JOB_LABEL + job.id, amount: { currency_code: "USD", value: "50.00" } }],
        payment_source: { card: { number: TEST_CARD, expiry: "2030-12", security_code: "123", name: "Test Person" } },
      },
    });
    await db.update(jobs).set({ paypalOrderId: String(order.id) }).where(eq(jobs.id, job.id));
    say(`  PayPal order ${String(order.id)} (paid with PayPal's test card, because nobody is here to approve)`);
  }
  const hold = await confirmHold(job.id);
  say(`  Held ${formatCents(hold.amountCents)}  ${hold.status}  PayPal reference (the hold's number) ${hold.paypalRef}`);
  say(`  Calling confirmHold again gives the same record: ${(await confirmHold(job.id)).id === hold.id}`);

  const person = await joinDibs({ name: "aarav.clips", paypalEmail: worker.email });
  const { claim } = await callDibs({ jobId: job.id, workerId: person.id });
  const result = await handIn({ claimId: claim.id, url: "https://example.com/launch-video" });

  say("Step 2: the result has earned $4.00 (2,000 views)");
  await db.update(results).set({ earnedCents: 400 }).where(eq(results.id, result.id));
  let started = Date.now();
  show("payWorker", await payWorker(result.id));
  say(`    took ${((Date.now() - started) / 1000).toFixed(1)} seconds`);

  say("Step 3: the result has now earned $12.40 (6,200 views), and payWorker is called TWICE at the same moment");
  await db.update(results).set({ earnedCents: 1240 }).where(eq(results.id, result.id));
  started = Date.now();
  const [a, b] = await Promise.all([payWorker(result.id), payWorker(result.id)]);
  show("first call ", a);
  show("second call", b);
  say(`    took ${((Date.now() - started) / 1000).toFixed(1)} seconds. Paid by the two calls together: ${formatCents(a.paidCents + b.paidCents)} (must be $8.40)`);
  show("a third call afterwards", await payWorker(result.id));

  say("Step 4: let the rest go");
  const rest = await letGo(job.id);
  say(`  Let go ${formatCents(rest.amountCents)}  ${rest.status}  PayPal reference (the hold's number) ${rest.paypalRef}`);
  const atPayPal = await rawCallForProofs("GET", `/v2/payments/authorizations/${hold.paypalRef}`);
  say(`  PayPal's own record of the hold now says: ${String(atPayPal.status)}`);

  say("Every money move in the database for this job:");
  const moves = (await db.select().from(moneyMoves).where(eq(moneyMoves.jobId, job.id))).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
  for (const m of moves) say(`  ${m.kind.padEnd(7)} ${formatCents(m.amountCents).padStart(7)}  ${m.status.padEnd(7)}  ${m.paypalRef ?? "(no reference)"}${m.error ? `  note: ${m.error}` : ""}`);
  const money = await getJobMoney(job.id);
  say(`Job money: locked ${formatCents(money.lockedCents)}, paid ${formatCents(money.paidCents)}, held ${formatCents(money.heldCents)}, let go ${formatCents(money.letGoCents)}`);
  const after = (await db.select().from(results).where(eq(results.id, result.id)))[0];
  const jobAfter = (await db.select().from(jobs).where(eq(jobs.id, job.id)))[0];
  say(`Result status: ${after.status}. Job status: ${jobAfter.status}.`);

  const takes = moves.filter((m) => m.kind === "take");
  const payouts = moves.filter((m) => m.kind === "payout");
  const ok =
    takes.map((m) => m.amountCents).join() === "400,840" &&
    payouts.map((m) => m.amountCents).join() === "400,840" &&
    moves.every((m) => m.status === "done" && m.paypalRef) &&
    money.lockedCents === 5000 && money.paidCents === 1240 && money.heldCents === 0 && money.letGoCents === 3760 &&
    atPayPal.status === "VOIDED";
  say(ok ? "RESULT: PASSED" : "RESULT: NOT PASSED");
  await closeDb();
  process.exit(ok ? 0 : 1);
}

main().catch(async (error) => {
  console.error("STOPPED:", error instanceof Error ? error.message : error);
  await closeDb().catch(() => {});
  process.exit(1);
});
