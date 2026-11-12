import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Lane A's money functions and the video site are stand-ins, and no AI is
// set up: any call to them from the tick would show up here.
const payWorker = vi.fn(async (resultId: string) => ({ paidCents: 0, take: null, payout: null, resultId }));
const letGo = vi.fn(async (jobId: string) => ({ jobId }));
vi.mock("@/money", async (importActual) => ({ ...(await importActual<typeof import("@/money")>()), payWorker: (id: string) => payWorker(id), letGo: (id: string) => letGo(id) }));

import { useAi } from "@/ai";
import { closeDb, getDb, type Db } from "@/db/client";
import { checks, jobs, readings, results } from "@/db/schema";
import { seed } from "@/db/seed";
import { handIn } from "@/db/write";
import { isSampleJob, isSampleResult, restoreSampleCards } from "./sample";
import { tickAt } from "./tick";
import { useVideoReader } from "./video-site";

const WRONG_LINE = "This link is not a video we can read. Please hand in the link to a public YouTube video.";
const reader = vi.fn(async () => ({ videoId: "x", views: 900, likes: 60, comments: null, seconds: 20, source: "page" as const }));
const ai = { text: vi.fn(), watch: vi.fn(async () => ({ rules: [], videoSeconds: 20 })) };

let db: Db;
beforeAll(async () => {
  db = await getDb();
  useVideoReader(reader);
  useAi(ai as never);
});
afterAll(async () => {
  useVideoReader(null);
  useAi(null);
  await closeDb();
});
beforeEach(async () => {
  await seed(db);
  for (const stub of [payWorker, letGo, reader, ai.text, ai.watch]) stub.mockClear();
});

const everyResult = () => db.select().from(results).orderBy(results.id);
const counts = async () => ({ checks: (await db.select().from(checks)).length, readings: (await db.select().from(readings)).length });

describe("the tick leaves the sample data alone", () => {
  it("never re-reads, writes to, pays or blocks a sample result, however long it runs", async () => {
    const before = await everyResult();
    const rowsBefore = await counts();
    // Make every sample result due, and owed money, to be sure nothing slips through.
    await db.update(results).set({ nextCheckAt: new Date(Date.now() - 60_000) });
    await db.update(results).set({ earnedCents: 99_00 }).where(eq(results.id, "res_kettle_views_aarav"));
    const prepared = await everyResult();

    for (const minutes of [0, 1, 11, 61, 600]) {
      const summary = await tickAt(new Date(Date.now() + minutes * 60_000));
      expect(summary).toMatchObject({ checksRun: 0, payoutsSent: 0, paidCents: 0, jobsEnded: 0, problems: [] });
    }

    expect(reader).not.toHaveBeenCalled();
    expect(ai.watch).not.toHaveBeenCalled();
    expect(ai.text).not.toHaveBeenCalled();
    expect(payWorker).not.toHaveBeenCalled();
    expect(await everyResult()).toEqual(prepared); // not one field of any result was written
    expect(await counts()).toEqual(rowsBefore);
    expect(before.map((r) => r.summary)).not.toContain(WRONG_LINE);
  });

  it("does not try to close a sample job past its end: no real hold stands behind it", async () => {
    await db.update(jobs).set({ endsAt: new Date(Date.now() - 60_000) });
    const before = await everyResult();
    const summary = await tickAt(new Date());
    expect(summary).toMatchObject({ checksRun: 0, jobsEnded: 0, problems: [] });
    expect(letGo).not.toHaveBeenCalled();
    expect(payWorker).not.toHaveBeenCalled();
    expect(await everyResult()).toEqual(before);
    expect((await db.select().from(jobs)).every((j) => j.status === "open")).toBe(true);
  });

  it("still checks real work handed in on a sample job", async () => {
    await handIn({ claimId: "clm_kettle_views_kabir", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" });
    const kabir = (await db.select().from(results).where(eq(results.id, "res_kettle_views_kabir")))[0];
    expect(isSampleResult(kabir)).toBe(false);
    const summary = await tickAt(new Date(Date.now() + 1000));
    expect(summary.checksRun).toBe(1);
    expect(reader).toHaveBeenCalledWith("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  });

  it("tells sample rows from real ones", async () => {
    const aarav = (await db.select().from(results).where(eq(results.id, "res_kettle_views_aarav")))[0];
    expect(isSampleResult(aarav)).toBe(true);
    expect(isSampleResult({ ...aarav, id: "res_k3m9x2pq7w4n" })).toBe(false);
    const job = (await db.select().from(jobs).where(eq(jobs.id, "job_kettle_views")))[0];
    expect(isSampleJob(job)).toBe(true);
    expect(isSampleJob({ ...job, paypalAuthorizationId: "5O190127TN364715T" })).toBe(false); // a real hold was made for it
    expect(isSampleJob({ id: "job_k3m9x2pq7w4n", paypalAuthorizationId: "SAMPLE-HOLD-X" })).toBe(false);
  });
});

describe("putting the sample cards back", () => {
  it("restores exactly the cards the old timer wrote on, and is safe to run again", async () => {
    const clean = await everyResult();
    // What the live site looks like now: the old timer's line on three cards.
    for (const [id, status] of [["res_kettle_views_aarav", "paid"], ["res_kettle_views_kabir", "waiting"], ["res_kettle_views_isha", "waiting"]] as const) {
      await db.update(results).set({ status, summary: WRONG_LINE, nextCheckAt: null, lastCheckedAt: new Date() }).where(eq(results.id, id));
    }
    // A real person's own hand-in on a sample claim, carrying the same line: not ours to touch.
    await db.update(results).set({ handInUrl: "https://example.org/my-own-page", status: "waiting", summary: WRONG_LINE }).where(eq(results.id, "res_kettle_views_meera"));
    const meeraBefore = (await db.select().from(results).where(eq(results.id, "res_kettle_views_meera")))[0];
    const rowsBefore = await counts();

    expect(await restoreSampleCards(db)).toBe(3);

    const after = await everyResult();
    const byId = (rows: typeof after, id: string) => rows.find((r) => r.id === id)!;
    for (const id of ["res_kettle_views_aarav", "res_kettle_views_kabir", "res_kettle_views_isha"]) {
      expect(byId(after, id).summary).toBe(byId(clean, id).summary);
      expect(byId(after, id).status).toBe(byId(clean, id).status);
      expect(byId(after, id).nextCheckAt).toBeNull();
      expect(byId(after, id).earnedCents).toBe(byId(clean, id).earnedCents);
      expect(byId(after, id).measured).toEqual(byId(clean, id).measured);
    }
    expect(byId(after, "res_kettle_views_aarav").summary).toBe("Everything passed, so this was paid without anyone approving it.");
    expect(byId(after, "res_kettle_views_meera")).toEqual(meeraBefore);
    // Every other result is exactly as it was.
    const untouched = (rows: typeof after) => rows.filter((r) => !/aarav|kabir|isha|meera/.test(r.id));
    expect(untouched(after)).toEqual(untouched(clean));
    expect(await counts()).toEqual(rowsBefore);

    expect(await restoreSampleCards(db)).toBe(0); // nothing left to do
    expect(await everyResult()).toEqual(after);
  });

  it("does nothing on a clean database", async () => {
    const before = await everyResult();
    expect(await restoreSampleCards(db)).toBe(0);
    expect(await everyResult()).toEqual(before);
  });
});
