// Prints the job card AI writes from one sentence. Needs an AI key in .env.local.
//   npx tsx src/checkers/cli/card.ts "I want 10,000 real views on our launch video. Up to $50." "Kettle & Clove"
import "../../db/cli/env";
import { aiStatus } from "../../ai";
import { writeJobCardWithAi } from "../job-card";

const [sentence, posterName = "the poster"] = process.argv.slice(2);
if (!sentence) {
  console.error('Give the job in one sentence, in quotes.');
  process.exit(1);
}
console.log(`AI for text: ${aiStatus().text ?? "none (no key)"}`);
writeJobCardWithAi({ sentence, posterName })
  .then((card) => console.log(JSON.stringify(card, null, 2)))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
