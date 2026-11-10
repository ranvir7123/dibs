// AI watches a PUBLIC video link against the promo rules and prints its answer.
// Needs GOOGLE_AI_API_KEY in .env.local.
//   npx tsx src/checkers/cli/promo.ts "https://www.youtube.com/watch?v=..." "Kettle & Clove" "https://dibs.example/r/abc12345"
// With a rules file as the 4th argument, those rules are used instead of the three promo rules.
import "../../db/cli/env";
import { readFileSync } from "node:fs";
import { aiStatus } from "../../ai";
import type { JobCard, JobRule } from "../../contract/types";
import { publicVideoUrl, videoIdFrom } from "../video-site";
import { watchPromo } from "../watch";

const [link, brand = "Kettle & Clove", trackedLink = "", rulesFile] = process.argv.slice(2);
const id = videoIdFrom(link ?? "");
if (!id) {
  console.error("Give the link to a public YouTube video.");
  process.exit(1);
}
const promoRules: JobRule[] = [
  { id: "names_brand", label: `Names ${brand}`, detail: "The brand's name is said or shown in the video." },
  { id: "shows_link", label: "Shows your link", detail: "The worker's tracked link is readable on screen or spoken aloud." },
  { id: "says_paid", label: "Says it is a paid promotion", detail: "The video says or shows that it is paid for or sponsored." },
];
const mustShow: JobRule[] = rulesFile ? JSON.parse(readFileSync(rulesFile, "utf8")) : promoRules;
const card = { finishLine: `A public video promoting ${brand}`, checker: { mustShow } } as unknown as JobCard;
const clock = (s: number | null) => (s === null ? "Not seen" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);

console.log(`AI for watching: ${aiStatus().watch ?? "none (no key)"}`);
const started = Date.now();
watchPromo({ url: publicVideoUrl(id), card, posterName: brand, trackedLink: trackedLink && trackedLink !== "-" ? trackedLink : null })
  .then((r) => {
    for (const rule of r.rules) console.log(`${rule.met ? "PASS" : "FAIL"}  ${clock(rule.seenAtSeconds).padEnd(9)} ${rule.label}: ${rule.reason}`);
    console.log(`Length AI reported: ${r.mediaSeconds ?? "unknown"} seconds. Took ${Math.round((Date.now() - started) / 1000)} seconds to watch.`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
