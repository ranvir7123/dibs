// npm run db:migrate: creates or updates the tables.
import "./env";
import { closeDb, describeDb, getDb, migrateDb } from "../client";

async function main() {
  await getDb();
  await migrateDb();
  console.log(`Tables are up to date in the ${await describeDb()}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
