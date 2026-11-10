// npm run db:titles: prints every job on the board with its money, read back from the database.
import "./env";
import { formatCents } from "../../contract/money";
import { closeDb, describeDb } from "../client";
import { getBoard } from "../read";

async function main() {
  const board = await getBoard();
  console.log(`${board.jobs.length} open jobs in the ${await describeDb()}:`);
  for (const { job, poster, money, daysLeft } of board.jobs) {
    console.log(
      `  ${job.title} | ${poster.name} | ${daysLeft}D left | ` +
        `${formatCents(money.paidCents)} paid, ${formatCents(money.heldCents)} held of ${formatCents(money.lockedCents)}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
