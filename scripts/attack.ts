/**
 * The click attack: sends thousands of clicks at one tracked link from this
 * one machine, as fast as the site answers, then prints how many were sent and
 * how many Dibs counted.
 *
 *   npx tsx scripts/attack.ts --code <link code>
 *   npx tsx scripts/attack.ts --code <link code> --clicks 5000 --at-once 50
 *   npx tsx scripts/attack.ts --stand-in            (no site needed: uses the stand-in in this folder)
 *
 * The site's address comes from DIBS_BASE_URL (in .env.local or the terminal).
 * The link code is the last part of a worker's link: /r/<code>.
 *
 * The count is read from the database, so this command must be able to reach
 * the same database the site uses (DATABASE_URL in .env.local). While the app
 * is running on this laptop with the built-in database, the app has it open and
 * the count cannot be read from here: the clicks are still sent, and the result
 * card on the job page shows the count.
 */
import "../src/db/cli/env";
import { parseArgs } from "node:util";
import { closeDb, dbKind, describeDb } from "../src/db/client";
import { linkUrl, plainCountProblem, probeLink, readClickCount, sendClicks, standInProblem, type ClickCount } from "./attack-lib";
import { startStandIn, type StandIn } from "./stand-in-link-server";

/** The sample data's link with no clicks on it yet (kabir.cuts), used when the stand-in is asked for and no code is given. */
const STAND_IN_CODE = "kabirn2w";

const number = (n: number) => n.toLocaleString("en-US");

function wholeNumber(text: string, name: string, most: number): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > most) throw new Error(`--${name} must be a whole number from 1 to ${number(most)}.`);
  return n;
}

async function tryCount(code: string): Promise<{ count: ClickCount } | { problem: string }> {
  try {
    const count = await readClickCount(code);
    if (!count.known) {
      return { problem: `the ${await describeDb()} has no link "${code}", so it is not the database this site uses` };
    }
    return { count };
  } catch (error) {
    return { problem: plainCountProblem(error) };
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      code: { type: "string" },
      clicks: { type: "string", default: "5000" },
      "at-once": { type: "string", default: "50" },
      "stand-in": { type: "boolean", default: false },
    },
  });
  const clicks = wholeNumber(values.clicks, "clicks", 100_000);
  const atOnce = wholeNumber(values["at-once"], "at-once", 500);

  let standIn: StandIn | null = null;
  try {
    let baseUrl: string;
    let code = values.code?.trim();
    if (values["stand-in"]) {
      const refused = standInProblem(await dbKind());
      if (refused) throw new Error(refused);
      standIn = await startStandIn();
      baseUrl = standIn.baseUrl;
      code ||= STAND_IN_CODE;
      console.log(`Using the STAND-IN link server at ${baseUrl} (not the real site), on the ${await describeDb()}.`);
    } else {
      baseUrl = process.env.DIBS_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
      if (!baseUrl) throw new Error("DIBS_BASE_URL is not set. Put the site's address in .env.local, for example DIBS_BASE_URL=http://localhost:3004");
      if (!code) throw new Error("Give the link to attack: --code <the last part of the worker's link, after /r/>");
    }

    // One click first, to see the link is there. It is taken before the
    // "before" count, so the numbers printed are the attack alone.
    const probe = await probeLink(baseUrl, code);
    const before = await tryCount(code);
    if (!probe.ok) {
      throw new Error(
        probe.status === null
          ? `Nothing answered at ${linkUrl(baseUrl, code)}. Is the site running at ${baseUrl}?`
          : `${linkUrl(baseUrl, code)} answered ${probe.status}, not a redirect, so it is not a working tracked link. No attack was sent.`,
      );
    }

    console.log(`Attacking ${linkUrl(baseUrl, code)} with ${number(clicks)} clicks, ${atOnce} at a time ...`);
    const report = await sendClicks({ baseUrl, code, clicks, atOnce });
    const after = await tryCount(code);

    const answers = Object.entries(report.statuses)
      .map(([status, n]) => `${number(n)} x ${status}`)
      .join(", ");
    console.log("");
    console.log(`Clicks sent:      ${number(report.sent)} from this one machine, in ${report.seconds.toFixed(1)} seconds (${number(Math.round(report.sent / report.seconds))} a second)`);
    console.log(`Site answered:    ${number(report.answered)} (${answers || "none"}), ${number(report.failed)} got no answer`);
    if ("count" in before && "count" in after) {
      console.log(`Dibs stored:      ${number(after.count.stored - before.count.stored)} of them`);
      console.log(`Dibs counted:     ${number(after.count.counted)} real click${after.count.counted === 1 ? "" : "s"} on this link in all, out of ${number(after.count.stored)} stored`);
      console.log("                  (1 more click was sent first, to check the link was there. It is in the totals.)");
    } else {
      const problem = "problem" in after ? after.problem : "problem" in before ? before.problem : "";
      console.log(`Dibs counted:     could not be read from here: ${problem}`);
      console.log("                  Open the job page: the result card for this link shows the count.");
    }
  } finally {
    await standIn?.close();
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
