// Prints how a tracked link's clicks were counted, and the reasons stored for those left out.
// Stop the app first (one program per database folder), then:
//   $env:DIBS_DATA_DIR=".data/lane-b"; npx tsx src/checkers/cli/clicks.ts kabirn2w
import "../../db/cli/env";
import { count, eq } from "drizzle-orm";
import { closeDb, getDb } from "../../db/client";
import { clicks } from "../../db/schema";
import { countClicks } from "../clicks";

async function main() {
  const code = process.argv[2];
  if (!code) throw new Error("Give a tracked link code, for example: kabirn2w");
  const db = await getDb();
  const c = await countClicks(code);
  console.log(`Link /r/${code}`);
  console.log(`Clicks stored:        ${c.clicksTotal.toLocaleString("en-US")}`);
  console.log(`Counted as real:      ${c.clicksReal.toLocaleString("en-US")}`);
  console.log(`Different visitors:   ${c.visitors.toLocaleString("en-US")}`);
  console.log(`Busiest stretch:      ${c.burst ? `${c.burst.clicks.toLocaleString("en-US")} clicks in ${c.burst.seconds} seconds (a burst)` : "no burst"}`);
  const reasons = await db.select({ reason: clicks.leftOutReason, n: count() }).from(clicks).where(eq(clicks.linkCode, code)).groupBy(clicks.leftOutReason);
  for (const r of reasons) console.log(`  ${String(r.n).padStart(5)}  ${r.reason ?? "(counted)"}`);
  const sample = (await db.select({ key: clicks.visitorKey }).from(clicks).where(eq(clicks.linkCode, code)).limit(1))[0];
  if (sample) console.log(`Visitor mark stored (scrambled, not an address): ${sample.key}`);
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
