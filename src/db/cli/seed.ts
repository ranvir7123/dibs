// npm run db:seed: empties the database and loads the sample data.
import "./env";
import { closeDb, dbKind, describeDb, getDb, migrateDb } from "../client";
import { assertSeedAllowed, seed } from "../seed";

async function main() {
  const db = await getDb();
  assertSeedAllowed(await dbKind());
  await migrateDb();
  const rows = await seed(db);
  console.log(`Sample data loaded into the ${await describeDb()}:`);
  for (const [table, list] of Object.entries(rows)) {
    console.log(`  ${table.padEnd(13)} ${list.length}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
