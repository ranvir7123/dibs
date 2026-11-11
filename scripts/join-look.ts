/**
 * Prints what the database holds for one job: the job, its money moves,
 * claims, links, results, checks, readings, click counts and sales. Changes
 * nothing. Emails are never printed.
 *
 *   npx tsx scripts/join-look.ts <jobId> [<jobId> ...]
 *   npx tsx scripts/join-look.ts            lists every job
 *
 * Stop the app first: only one program can have the laptop's database open.
 */
import "../src/db/cli/env";
import { asc, eq, sql } from "drizzle-orm";
import { formatCents } from "../src/contract/money";
import { closeDb, getDb } from "../src/db/client";
import { getJobMoney } from "../src/db/read";
import { checks, claims, clicks, jobs, moneyMoves, people, readings, results, sales, trackedLinks } from "../src/db/schema";

async function main() {
  const db = await getDb();
  const names = new Map((await db.select().from(people)).map((p) => [p.id, p.name]));
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    for (const j of await db.select().from(jobs).orderBy(asc(jobs.createdAt))) console.log(`${j.id}  ${j.status.padEnd(6)} ${formatCents(j.budgetCents).padStart(8)}  ${names.get(j.posterId)}: ${j.title}`);
    return;
  }
  for (const id of ids) {
    const job = (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
    if (!job) {
      console.log(`No job ${id}`);
      continue;
    }
    const money = await getJobMoney(id);
    console.log(`JOB ${job.id} "${job.title}" by ${names.get(job.posterId)}`);
    console.log(`  status ${job.status}, budget ${formatCents(job.budgetCents)}, PayPal order ${job.paypalOrderId ?? "-"}, hold ${job.paypalAuthorizationId ?? "-"}, ended ${job.endedAt?.toISOString() ?? "-"}`);
    console.log(`  money: locked ${formatCents(money.lockedCents)}, paid ${formatCents(money.paidCents)}, held ${formatCents(money.heldCents)}, let go ${formatCents(money.letGoCents)}`);
    console.log(`  evidence ${job.card.checker.evidence.join("+")}, hand-in ${job.card.checker.handIn}, must show: ${job.card.checker.mustShow.map((r) => r.label).join(" | ") || "-"}, cheat tests: ${job.card.checker.cheatTests.join(",") || "-"}`);
    console.log("  MONEY MOVES");
    for (const m of await db.select().from(moneyMoves).where(eq(moneyMoves.jobId, id)).orderBy(asc(moneyMoves.createdAt))) {
      console.log(`    ${m.kind.padEnd(7)} ${formatCents(m.amountCents).padStart(8)} ${m.status.padEnd(7)} ref ${m.paypalRef ?? "-"}  ${names.get(m.personId ?? "") ?? ""}${m.error ? `  note: ${m.error}` : ""}`);
    }
    for (const claim of await db.select().from(claims).where(eq(claims.jobId, id)).orderBy(asc(claims.createdAt))) {
      console.log(`  CLAIM ${claim.id} by ${names.get(claim.workerId)}: ${claim.status}`);
      const link = (await db.select().from(trackedLinks).where(eq(trackedLinks.claimId, claim.id)))[0];
      if (link) {
        const n = (await db.select({ all: sql<number>`count(*)`.mapWith(Number), counted: sql<number>`count(*) filter (where ${clicks.counted})`.mapWith(Number) }).from(clicks).where(eq(clicks.linkCode, link.code)))[0];
        console.log(`    link /r/${link.code} -> ${link.targetUrl}; clicks stored ${n.all}, counted ${n.counted}`);
      }
      for (const s of await db.select().from(sales).where(eq(sales.claimId, claim.id))) console.log(`    sale ${formatCents(s.amountCents)} PayPal order ${s.paypalOrderId}`);
      const result = (await db.select().from(results).where(eq(results.claimId, claim.id)))[0];
      if (!result) continue;
      console.log(`    RESULT ${result.id}: ${result.status}, earned ${formatCents(result.earnedCents)}, handed in ${result.handInUrl ?? result.handInFile ?? "(nothing)"}`);
      console.log(`      measured ${JSON.stringify(result.measured)}`);
      console.log(`      summary: ${result.summary ?? "-"}`);
      console.log(`      footer: ${result.watchLabel ?? "-"}: ${result.watchNote ?? "-"} (ok ${result.watchOk})`);
      console.log(`      last checked ${result.lastCheckedAt?.toISOString() ?? "-"}, next check ${result.nextCheckAt?.toISOString() ?? "never"}`);
      for (const c of await db.select().from(checks).where(eq(checks.resultId, result.id)).orderBy(asc(checks.position))) {
        console.log(`      check ${c.key.padEnd(22)} ${c.group.padEnd(9)} ${c.passedCount}/${c.totalCount} ${c.passed ? "pass" : "FAIL"} at ${c.seenAtSeconds ?? "-"}s  ${c.label}: ${c.reason}`);
      }
      for (const r of await db.select().from(readings).where(eq(readings.resultId, result.id)).orderBy(asc(readings.at))) {
        console.log(`      reading ${r.at.toISOString()} views ${r.views ?? "-"} likes ${r.likes ?? "-"} clicks ${r.clicksTotal ?? "-"} real ${r.clicksReal ?? "-"}`);
      }
    }
    console.log("");
  }
}

main()
  .catch((error) => {
    console.error("STOPPED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
