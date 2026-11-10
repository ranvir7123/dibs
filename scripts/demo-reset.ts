/**
 * The filming reset: wipes the database and puts it into the exact starting
 * state for the video, then prints that state as read back from the database.
 *
 *   npx tsx scripts/demo-reset.ts              reset, using the PayPal test emails in .env.local
 *   npx tsx scripts/demo-reset.ts --practice   reset for a rehearsal: no PayPal emails needed, nobody can be paid
 *   npx tsx scripts/demo-reset.ts --check      change nothing, only print the state
 *
 * Stop the app first when it runs on this laptop with the built-in database
 * (only one program can have that database open). On a hosted database, the
 * reset is refused unless DIBS_ALLOW_SEED=1 is set for this one command,
 * because it wipes everything.
 *
 * The names and the sentences typed on camera are in scripts/demo-cast.ts.
 */
import "../src/db/cli/env";
import { parseArgs } from "node:util";
import { closeDb, describeDb } from "../src/db/client";
import { typedOnCamera } from "./demo-cast";
import { readDemoState, resetForFilming, type DemoState } from "./demo-lib";

function print(state: DemoState, where: string) {
  console.log(`The board in the ${where}: ${state.jobs.length} open jobs (sample data, the backdrop)`);
  for (const job of state.jobs) {
    console.log(`  ${job.title} | ${job.poster} | ${job.paid} paid, ${job.held} held of ${job.locked}`);
  }
  console.log("");
  console.log(`People: ${state.peopleCount} in all. The people in the video:`);
  for (const member of state.cast) {
    const who = member.id === null ? "NOT IN THE DATABASE" : member.id;
    const pay = member.payable ? "PayPal can pay them" : "cannot be paid (no PayPal test email)";
    console.log(`  ${member.role.padEnd(10)} ${member.name.padEnd(20)} ${who.padEnd(18)} posted ${member.jobsPosted}, took ${member.claims} | ${pay}`);
  }
  console.log("");
  const typed = typedOnCamera(process.env.DIBS_BASE_URL);
  console.log("Typed on camera (edit in scripts/demo-cast.ts):");
  console.log(`  1. Views:       ${typed.threeKinds[0]}`);
  console.log(`  2. Bugs:        ${typed.threeKinds[1]}`);
  console.log(`  3. Customers:   ${typed.threeKinds[2]}`);
  console.log(`  Game test job:  ${typed.gameTest}`);
  if (!process.env.DIBS_BASE_URL?.trim()) {
    console.log("  DIBS_BASE_URL is not set, so YOUR-SITE-ADDRESS stands in for the site's address above. Set it in .env.local before filming.");
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      practice: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
    },
  });
  const options = { env: process.env, practice: values.practice };
  const state = values.check ? await readDemoState(options) : await resetForFilming(options);
  if (!values.check) console.log(values.practice ? "Reset for a PRACTICE run. Nobody in the video can be paid.\n" : "Reset for filming.\n");
  print(state, await describeDb());
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
