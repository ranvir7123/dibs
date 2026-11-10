// AI watches a recording against rules and prints the moment each rule was met.
// Needs GOOGLE_AI_API_KEY in .env.local.
//   npx tsx src/checkers/cli/watch.ts "C:\path\recording.mp4" "Tiny Comet Games" rules.json
// rules.json is a list like: [{ "id": "level_2", "label": "Reached level 2", "detail": "The level counter changes from 1 to 2." }]
// Without rules.json, the five sample rules of the Tiny Comet test job are used.
//   npx tsx src/checkers/cli/watch.ts "https://www.youtube.com/watch?v=..." also works for a public video.
import "../../db/cli/env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aiStatus } from "../../ai";
import type { JobCard, JobRule } from "../../contract/types";
import { fileKind } from "../files";
import { publicVideoUrl, videoIdFrom } from "../video-site";
import { watchRecording } from "../watch";

const [target, posterName = "Tiny Comet Games", rulesFile] = process.argv.slice(2);
if (!target) {
  console.error("Give the path of a recording, or a public video link.");
  process.exit(1);
}
const sampleRules: JobRule[] = [
  { id: "tutorial", label: "Finished the tutorial", detail: 'The "Tutorial complete" banner appears.' },
  { id: "level_2", label: "Reached level 2", detail: "The level counter changes from 1 to 2." },
  { id: "shop", label: "Opened the shop and bought an item", detail: "Coins drop after buying an item in the shop." },
  { id: "level_3", label: "Reached level 3", detail: "The level counter changes from 2 to 3." },
  { id: "pause_menu", label: "Tried the pause menu", detail: "The pause menu opens during play." },
];
const rules: JobRule[] = rulesFile ? JSON.parse(readFileSync(rulesFile, "utf8")) : sampleRules;
const card = {
  title: `Test for ${posterName}`,
  finishLine: `A screen recording that shows each rule being met`,
  payRule: { kind: "per_rule", centsPerRule: 300, rules },
  checker: { evidence: ["ai_watch"], handIn: "file", mustShow: [], cheatTests: ["recording_one_take", "recording_right_subject"], machineCheckable: true },
} as unknown as JobCard;

const id = videoIdFrom(target);
const type = fileKind(target);
if (!id && type.kind !== "video") {
  console.error("That is neither a public video link nor a video file (.mp4, .mov, .webm).");
  process.exit(1);
}
const video = id ? ({ kind: "public_link", url: publicVideoUrl(id) } as const) : ({ kind: "file", path: path.resolve(target), mimeType: (type as { mimeType: string }).mimeType } as const);
const clock = (s: number | null) => (s === null ? "Not seen" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);

console.log(`AI for watching: ${aiStatus().watch ?? "none (no key)"}`);
const started = Date.now();
watchRecording({ video, card, posterName })
  .then((r) => {
    for (const rule of r.rules) console.log(`${rule.met ? "PASS" : "FAIL"}  ${clock(rule.seenAtSeconds).padEnd(9)} ${rule.label}: ${rule.reason}`);
    console.log(`One take: ${r.oneTake?.ok ? "yes" : "no"}. ${r.oneTake?.reason ?? ""}`);
    console.log(`Right subject: ${r.rightSubject?.ok ? "yes" : "no"}. ${r.rightSubject?.reason ?? ""}`);
    console.log(`Length AI reported: ${r.mediaSeconds ?? "unknown"} seconds. Took ${Math.round((Date.now() - started) / 1000)} seconds to watch.`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
