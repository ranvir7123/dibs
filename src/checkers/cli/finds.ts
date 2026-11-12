// AI looks at a recording or photo for a pay-per-find job and prints each find with its verdict.
// Needs ANTHROPIC_API_KEY in .env.local.
//   npx tsx src/checkers/cli/finds.ts "C:\path\recording.mp4" job.json
// job.json looks like:
//   { "posterName": "Tin Lantern Games", "title": "Find new bugs in Pebble Hop", "finishLine": "...",
//     "sentence": "what the poster typed", "unitLabel": "new bug", "doesNotCount": ["..."], "alreadyPaid": ["..."] }
import "../../db/cli/env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aiStatus } from "../../ai";
import type { JobCard } from "../../contract/types";
import { fileKind } from "../files";
import { watchRecording } from "../watch";

const [target, jobFile] = process.argv.slice(2);
if (!target || !jobFile) {
  console.error("Give the path of a recording or photo, then the path of a job.json file.");
  process.exit(1);
}
const job = JSON.parse(readFileSync(jobFile, "utf8")) as {
  posterName: string;
  title: string;
  finishLine: string;
  sentence: string;
  unitLabel: string;
  doesNotCount?: string[];
  alreadyPaid?: string[];
};
const type = fileKind(target);
if (type.kind !== "video" && type.kind !== "image") {
  console.error("That is neither a recording (.mp4, .mov, .webm) nor a photo (.png, .jpg, .webp).");
  process.exit(1);
}
const isPhoto = type.kind === "image";
const card = {
  title: job.title,
  finishLine: job.finishLine,
  payRule: { kind: "per_unit", unit: "item", unitLabel: job.unitLabel, centsPerBatch: 500, batchSize: 1 },
  checker: {
    evidence: ["ai_watch"],
    handIn: "file",
    mustShow: [],
    cheatTests: isPhoto ? ["recording_right_subject"] : ["recording_one_take", "recording_right_subject"],
    machineCheckable: true,
    doesNotCount: job.doesNotCount ?? [],
  },
} as unknown as JobCard;

const clock = (s: number | null) => (s === null ? "--:--" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
console.log(`AI for looking: ${aiStatus().look ?? "none (no key)"}`);
const started = Date.now();
watchRecording({ video: { kind: isPhoto ? "photo" : "file", path: path.resolve(target), mimeType: type.mimeType }, card, posterName: job.posterName, sentence: job.sentence, alreadyPaid: job.alreadyPaid ?? [] })
  .then((r) => {
    for (const item of r.items) console.log(`${item.verdict.toUpperCase().padEnd(13)} ${clock(item.seenAtSeconds)}  ${item.label}${item.matches ? `  [matches: ${item.matches}]` : ""}\n              ${item.reason}`);
    if (r.items.length === 0) console.log("No finds listed.");
    if (r.oneTake) console.log(`One take: ${r.oneTake.ok ? "yes" : "no"}. ${r.oneTake.reason}`);
    if (r.rightSubject) console.log(`Right subject: ${r.rightSubject.ok ? "yes" : "no"}. ${r.rightSubject.reason}`);
    console.log(`Took ${Math.round((Date.now() - started) / 1000)} seconds.`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
