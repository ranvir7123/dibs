/**
 * Runs by itself each time the site is put online, before the new version
 * starts (render.yaml calls it as the "pre-deploy command"):
 *
 *   1. Creates or updates the tables in the hosted database.
 *   2. If the database is completely empty (nobody has ever joined), loads the
 *      sample jobs and the people in the video.
 *
 *   3. Puts back any sample card that an earlier version of the timer wrote
 *      a wrong error line on. Only those cards, only that line.
 *
 * It never wipes anything: step 2 only happens when there are no people at
 * all, which is true exactly once, on the very first run. To start again from
 * the sample jobs later, use "npx tsx scripts/demo-reset.ts" (it asks you to
 * mean it).
 *
 *   npm run online:setup
 */
import "../src/db/cli/env";
import { count } from "drizzle-orm";
import { closeDb, dbKind, describeDb, getDb, migrateDb } from "../src/db/client";
import { restoreSampleCards } from "../src/checkers/sample";
import { people } from "../src/db/schema";
import { resetForFilming } from "./demo-lib";

async function main() {
  const db = await getDb();
  await migrateDb();
  const where = await describeDb();
  console.log(`Tables are up to date in the ${where}.`);

  const joined = (await db.select({ n: count() }).from(people))[0].n;
  if (joined > 0) {
    console.log(`${joined} people are already in the database, so nothing was loaded.`);
    // An earlier version of the timer wrote "This link is not a video we can read" on
    // some sample cards. Those cards get their own sentence back; nothing else is touched.
    const restored = await restoreSampleCards(db);
    console.log(restored > 0 ? `${restored} sample cards had a wrong error line on them and were put back.` : "No sample card needed putting back. Nothing was changed.");
    return;
  }
  if ((await dbKind()) !== "hosted") {
    console.log("This is a laptop database and it is empty. Load the sample jobs with: npm run db:seed");
    return;
  }

  // The loader refuses a hosted database unless told to mean it. Here that is safe: the database is empty.
  process.env.DIBS_ALLOW_SEED = "1";
  let state;
  try {
    state = await resetForFilming({ env: process.env });
    console.log("The database was empty, so the sample jobs and the people in the video were loaded.");
  } catch (error) {
    console.log(`The people in the video could not be set up with PayPal test emails (${error instanceof Error ? error.message : error})`);
    state = await resetForFilming({ env: process.env, practice: true });
    console.log("Loaded the sample jobs with practice people instead. They cannot be paid. Add the PayPal test emails, then run the filming reset.");
  }
  console.log(`${state.jobs.length} open jobs, ${state.peopleCount} people.`);
}

main()
  .catch((error) => {
    console.error(`Setting up the online database failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}))
  .finally(() => process.exit(process.exitCode ?? 0));
