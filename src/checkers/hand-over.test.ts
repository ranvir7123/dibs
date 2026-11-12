import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Lane A's money functions are stand-ins here: no test moves money.
vi.mock("@/money", async (importActual) => ({ ...(await importActual<typeof import("@/money")>()), payWorker: async () => ({ paidCents: 0, take: null, payout: null }), letGo: async () => ({}) }));

import { closeDb, getDb, type Db } from "@/db/client";
import { results } from "@/db/schema";
import { seed } from "@/db/seed";
import { settings } from "@/settings";
import { CHECK_TASK, handOverOn, nextCheckIsSlow, runHandedOverCheck, useTaskStarter } from "./hand-over";
import { tickAt } from "./tick";
import { guardSampleData } from "./sample";
import { NotAVideoLink, useVideoReader } from "./video-site";

// Render itself is never called in these tests: a stand-in takes the place of
// "start a background task". What is proven is everything around it. The
// real hand-over to Render can only be tried once a Render account exists.
const starter = vi.fn(async () => "run-example-123");
const reader = vi.fn(async (): Promise<never> => {
  throw new NotAVideoLink();
});

const KEYS = ["DIBS_CHECKS_ON_RENDER", "RENDER_API_KEY", "DIBS_CHECKS_WORKFLOW"] as const;
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const switchOn = () => {
  process.env.DIBS_CHECKS_ON_RENDER = "1";
  process.env.RENDER_API_KEY = "example-key-for-tests";
  process.env.DIBS_CHECKS_WORKFLOW = "dibs-checks-example";
};

let db: Db;
beforeAll(async () => {
  db = await getDb();
  useTaskStarter(starter);
  useVideoReader(reader);
  guardSampleData(false); // these tests use the sample rows as if they were real work
});
afterAll(async () => {
  useTaskStarter(null);
  useVideoReader(null);
  guardSampleData(true);
  await closeDb();
});
beforeEach(async () => {
  await seed(db);
  starter.mockClear();
  reader.mockClear();
});
afterEach(() => {
  for (const k of KEYS) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

const soon = () => new Date(Date.now() + 1000);
const isha = async () => (await db.select().from(results).where(eq(results.id, "res_kettle_views_isha")))[0];

describe("handing slow checks to background tasks", () => {
  it("is off unless the switch, the key and the task service's name are all set", () => {
    for (const k of KEYS) delete process.env[k];
    expect(handOverOn()).toBe(false);
    process.env.DIBS_CHECKS_ON_RENDER = "1";
    expect(handOverOn()).toBe(false);
    process.env.RENDER_API_KEY = "example-key-for-tests";
    expect(handOverOn()).toBe(false);
    process.env.DIBS_CHECKS_WORKFLOW = "dibs-checks-example";
    expect(handOverOn()).toBe(true);
    process.env.DIBS_CHECKS_ON_RENDER = "0";
    expect(handOverOn()).toBe(false);
  });

  it("calls a check slow only when AI still has to watch or read what was handed in", async () => {
    expect(await nextCheckIsSlow("clm_kettle_views_isha")).toBe(true); // a video nobody has watched yet
    expect(await nextCheckIsSlow("clm_kettle_views_aarav")).toBe(false); // already watched: only numbers are re-read
    expect(await nextCheckIsSlow("clm_loom_sales_dev")).toBe(false); // sales: nothing to watch
    expect(await nextCheckIsSlow("clm_tinycomet_stream_zoya")).toBe(false); // nothing handed in
  });

  it("with the switch on, the tick starts a task for the slow check and moves on", async () => {
    switchOn();
    const now = soon();
    const summary = await tickAt(now);

    expect(starter).toHaveBeenCalledTimes(1);
    expect(starter).toHaveBeenCalledWith(`dibs-checks-example/${CHECK_TASK}`, "clm_kettle_views_isha");
    expect(reader).not.toHaveBeenCalled(); // the tick did not do the check itself
    expect(summary.checksRun).toBe(0);
    expect(summary.problems).toEqual([]);
    // Not handed over again a minute later: the next check time was pushed on.
    expect((await isha()).nextCheckAt?.getTime()).toBe(now.getTime() + settings.checkEveryMinutes * 60_000);
    expect((await isha()).status).toBe("checking");
  });

  it("with the switch off, the tick does the check itself", async () => {
    for (const k of KEYS) delete process.env[k];
    const summary = await tickAt(soon());
    expect(starter).not.toHaveBeenCalled();
    expect(reader).toHaveBeenCalledTimes(1);
    expect(summary.checksRun).toBe(1);
  });

  it("when Render cannot start the task, the tick does the check itself and says so", async () => {
    switchOn();
    starter.mockImplementationOnce(async () => {
      throw new Error("401 Unauthorized");
    });
    const summary = await tickAt(soon());
    expect(reader).toHaveBeenCalledTimes(1);
    expect(summary.checksRun).toBe(1);
    expect(summary.problems).toEqual(["Could not hand the check for result res_kettle_views_isha to a background task (401 Unauthorized), so it was done here instead."]);
    expect((await isha()).status).toBe("waiting"); // the check really ran: this sample link is not a video
  });

  it("the task itself does the same check and saves the result", async () => {
    const answer = await runHandedOverCheck("clm_kettle_views_isha");
    expect(answer).toEqual({
      claimId: "clm_kettle_views_isha",
      status: "waiting",
      earnedCents: 0,
      summary: "This link is not a video we can read. Please hand in the link to a public YouTube video.",
    });
    expect((await isha()).summary).toBe(answer.summary);
  });
});
