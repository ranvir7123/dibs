/**
 * The tick as a program of its own: runs every check that is due, pays what
 * is owed, and closes jobs past their end. It does exactly what the site's
 * /api/tick address does, with no web time limit, so a check where AI watches
 * a long recording can finish.
 *
 *   npm run tick
 *
 * Online, a timer starts this once a minute. Two runs at once are safe: the
 * second sees the first is still working and does nothing.
 *
 * It needs the same settings as the site (DATABASE_URL, the PayPal and AI
 * keys). On a laptop they come from .env.local; stop the app first when it
 * uses the built-in database, because only one program can have that open.
 *
 * It ends with code 0 when the tick ran, even if some checks had problems
 * (they are printed, and tried again later). It ends with code 1 only when
 * the tick could not run at all, so the timer's page shows that as a failure.
 */
import "../src/db/cli/env";
import { tickAt } from "../src/checkers/tick";
import { closeDb, describeDb } from "../src/db/client";

/** Long enough for many slow checks; well inside the 12 hours a timer run may last online. */
const BUDGET_MS = 30 * 60_000;

async function main() {
  const started = Date.now();
  const where = await describeDb();
  const summary = await tickAt(new Date(), { budgetMs: BUDGET_MS });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `Tick at ${summary.ranAt.toISOString()} on the ${where}: ${summary.checksRun} checks run, ` +
      `${summary.payoutsSent} payouts sent (${(summary.paidCents / 100).toFixed(2)} dollars), ${summary.jobsEnded} jobs ended, ` +
      `${summary.problems.length} problems, ${seconds} seconds.`,
  );
  for (const problem of summary.problems) console.log(`  problem: ${problem}`);
}

main()
  .catch((error) => {
    console.error(`The tick could not run: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}))
  // Leaves at once, so an idle connection or a timer that is still pending cannot keep the run open.
  .finally(() => process.exit(process.exitCode ?? 0));
