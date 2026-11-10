// A proof helper for lane B, for a laptop database only. Never run it on the real site.
//
//   setup <video link>   makes an open TEST job and a worker's claim, and hands in the video
//   show                 prints the test claim's result, checks and readings
//   tick                 calls the running app's /api/tick with the password from .env.local
//
// The test job is opened by writing straight to the database, because opening
// a real job needs a PayPal hold (lane A). No PayPal hold stands behind it.
//   $env:DIBS_DATA_DIR=".data/lane-b"; npx tsx src/checkers/cli/tick-proof.ts setup "https://www.youtube.com/watch?v=jNQXAC9IVRw"
import "../../db/cli/env";
import { asc, eq } from "drizzle-orm";
import { formatCents } from "../../contract/money";
import type { JobCard } from "../../contract/types";
import { closeDb, getDb } from "../../db/client";
import { checks, claims, jobs, moneyMoves, readings, results } from "../../db/schema";
import { callDibs, createJob, handIn, joinDibs } from "../../db/write";
import { newId } from "../../db/ids";

const TITLE = "TEST: post a video about the zoo and get it views";

async function setup(link: string) {
  const db = await getDb();
  const poster = await joinDibs({ name: "Lane B Test Zoo", paypalEmail: "lane-b-test-poster@example.com" });
  const worker = await joinDibs({ name: "lane.b.tester", paypalEmail: "lane-b-test-worker@example.com" });
  const card: JobCard = {
    title: TITLE,
    category: "promotion",
    finishLine: "Views on your own public video about the zoo",
    target: null,
    howChecked: ["AI watches your video before any pay.", "Views are read from the video site's own count."],
    checkedByLine: "AI watches the video, then the video site's own view count",
    cheatTestsLine: "Sudden jumps in views. Views with no likes.",
    payRule: { kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 100, batchSize: 100 },
    payLine: "$1.00 for every 100 views",
    payNote: "Up to $50.00 in total",
    capCents: 5000,
    endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    proofStrength: "medium",
    proofNote: "Views can be bought.",
    proofTip: null,
    targetUrl: null,
    checker: {
      evidence: ["public_page", "ai_watch"],
      handIn: "link",
      mustShow: [
        { id: "elephants", label: "Shows elephants", detail: "Elephants are visible behind the speaker." },
        { id: "trunks", label: "Talks about long trunks", detail: "The speaker says the elephants have really long trunks." },
      ],
      cheatTests: ["view_jump", "views_without_likes"],
      machineCheckable: true,
    },
  };
  const job = await createJob({ posterId: poster.id, sentence: "Test job made by lane B's proof helper.", card });
  await db.update(jobs).set({ status: "open", paypalOrderId: "TEST-NO-PAYPAL-ORDER", paypalAuthorizationId: "TEST-NO-PAYPAL-HOLD" }).where(eq(jobs.id, job.id));
  await db.insert(moneyMoves).values({ id: newId("mov"), jobId: job.id, personId: poster.id, kind: "hold", amountCents: card.capCents, status: "done", paypalRef: "TEST-NO-PAYPAL-HOLD", note: "TEST row, no PayPal hold behind it" });
  const { claim } = await callDibs({ jobId: job.id, workerId: worker.id });
  const result = await handIn({ claimId: claim.id, url: link });
  console.log(`Test job ${job.id} opened (no PayPal hold behind it). Claim ${claim.id}. Handed in ${link}.`);
  console.log(`Result ${result.id}: status ${result.status}, earned ${formatCents(result.earnedCents)}, next check due now.`);
}

async function show() {
  const db = await getDb();
  const job = (await db.select().from(jobs).where(eq(jobs.title, TITLE)).orderBy(asc(jobs.createdAt))).at(-1);
  if (!job) throw new Error("No test job yet. Run setup first.");
  const claim = (await db.select().from(claims).where(eq(claims.jobId, job.id)))[0];
  const result = (await db.select().from(results).where(eq(results.claimId, claim.id)))[0];
  console.log(`Result ${result.id}: status ${result.status}, earned ${formatCents(result.earnedCents)}`);
  console.log(`Summary: ${result.summary}`);
  console.log(`Measured: ${JSON.stringify(result.measured)}`);
  console.log(`Footer: ${result.watchLabel}: ${result.watchNote}`);
  console.log(`Last checked ${result.lastCheckedAt?.toISOString()}, next check ${result.nextCheckAt?.toISOString() ?? "never"}`);
  for (const c of await db.select().from(checks).where(eq(checks.resultId, result.id)).orderBy(checks.position)) {
    console.log(`  ${c.passed ? "PASS" : "FAIL"} ${c.passedCount}/${c.totalCount} ${c.label} (${c.key}): ${c.reason}`);
  }
  for (const r of await db.select().from(readings).where(eq(readings.resultId, result.id)).orderBy(asc(readings.at))) {
    console.log(`  reading ${r.at.toISOString()}: ${r.views?.toLocaleString("en-US")} views, ${r.likes?.toLocaleString("en-US")} likes`);
  }
  const moves = await db.select().from(moneyMoves).where(eq(moneyMoves.resultId, result.id));
  console.log(`Money moves for this result: ${moves.length}${moves.map((m) => ` [${m.kind} ${formatCents(m.amountCents)} ${m.status}${m.error ? `: ${m.error}` : ""}]`).join("")}`);
}

async function callTick() {
  const secret = process.env.TICK_SECRET?.trim();
  if (!secret) throw new Error("TICK_SECRET is not set in .env.local.");
  const base = process.argv[3] ?? "http://localhost:3002";
  const started = Date.now();
  const response = await fetch(`${base}/api/tick`, { headers: { Authorization: `Bearer ${secret}` } });
  console.log(`GET ${base}/api/tick with the password -> ${response.status} in ${Date.now() - started} ms`);
  console.log(await response.text());
  const noPassword = await fetch(`${base}/api/tick`);
  console.log(`GET ${base}/api/tick with no password -> ${noPassword.status}`);
}

const [command, argument] = process.argv.slice(2);
(command === "setup" ? setup(argument) : command === "show" ? show() : command === "tick" ? callTick() : Promise.reject(new Error("Say setup, show or tick.")))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
