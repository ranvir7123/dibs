import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { useAi, type Ai } from "@/ai";
import { closeDb, getDb, type Db } from "@/db/client";
import { checks, moneyMoves, readings, results } from "@/db/schema";
import { seed } from "@/db/seed";
import { callDibs, handIn, objectToOpinion } from "@/db/write";
import { settings } from "@/settings";
import { runChecks, storeHandInFile } from "./index";
import { runChecksAt } from "./run-checks";
import { NotAVideoLink, useVideoReader, videoIdFrom, type VideoStats } from "./video-site";

let db: Db;
const DAY = 86_400_000;

// A stand-in for the video site: the numbers a test wants, for links it knows.
const site = new Map<string, Omit<VideoStats, "videoId" | "source">>();
const reader = vi.fn(async (link: string): Promise<VideoStats> => {
  const known = site.get(link);
  if (known) return { videoId: "example", source: "page", ...known };
  if (!videoIdFrom(link)) throw new NotAVideoLink();
  throw new Error("The video site did not answer (error 500). It will be tried again.");
});

// EXAMPLE answers in the shape AI is asked for, written by hand from the
// approved drawing (zoya.plays: 4 of 5 rules). NOT real AI output.
const EXAMPLE_RECORDING = {
  rules: [
    { id: "tutorial", met: true, seenAt: "00:48", reason: 'The "Tutorial complete" banner appears.' },
    { id: "level_2", met: true, seenAt: "01:31", reason: "The level counter changes from 1 to 2." },
    { id: "shop", met: true, seenAt: "02:14", reason: "Coins drop from 120 to 70." },
    { id: "level_3", met: true, seenAt: "03:40", reason: "The level counter changes from 2 to 3." },
    { id: "pause_menu", met: false, seenAt: "", reason: "The pause menu never appears in the recording." },
  ],
  oneTake: true,
  oneTakeReason: "One unbroken take.",
  rightSubject: true,
  rightSubjectReason: "The game on screen is Tiny Comet.",
  items: [],
  recordingSeconds: 252,
};
const EXAMPLE_PROMO = {
  rules: [
    { id: "names_brand", met: true, seenAt: "00:03", reason: "The video says Kettle & Clove." },
    { id: "shows_link", met: true, seenAt: "00:10", reason: "The link is on screen." },
    { id: "says_paid", met: false, seenAt: "", reason: "Nothing says this is a paid promotion." },
  ],
  videoSeconds: 21,
};
const EXAMPLE_OPINION = { acceptable: true, reason: "Every menu item is there and the Hindi reads naturally.", rules: [] };

const ai = { text: vi.fn(), watch: vi.fn() };

beforeAll(async () => {
  db = await getDb();
  await seed(db);
  useAi(ai as unknown as Ai);
  useVideoReader(reader);
});
afterAll(async () => {
  useAi(null);
  useVideoReader(null);
  await closeDb();
});
beforeEach(() => {
  ai.text.mockReset();
  ai.watch.mockReset();
  reader.mockClear();
});

const rowCount = async (table: typeof readings | typeof checks | typeof moneyMoves, resultId?: string) =>
  (await db.select({ n: count() }).from(table).where(resultId ? eq((table as typeof readings).resultId, resultId) : undefined))[0].n;
const result = async (id: string) => (await db.select().from(results).where(eq(results.id, id)))[0];

describe("runChecks on a views job", () => {
  const AARAV = "https://video.example.com/watch/aarav-kettle-launch";

  it("reads the numbers, runs the cheat tests, saves checks, one reading and the result, and moves no money", async () => {
    site.set(AARAV, { views: 6400, likes: 420, comments: 40, seconds: 21 });
    const readingsBefore = await rowCount(readings, "res_kettle_views_aarav");
    const movesBefore = await rowCount(moneyMoves);
    const now = new Date();

    const report = await runChecksAt("clm_kettle_views_aarav", now);

    expect(report.measured).toEqual({ views: 6400, likes: 420, comments: 40, mediaSeconds: 21, clicksTotal: 184, clicksReal: 181, visitors: 181 });
    expect(report.checks.map((c) => [c.key, c.group, c.passedCount, c.totalCount])).toEqual([
      ["in_video", "must_show", 3, 3],
      ["views_real", "cheat", 1, 1],
      ["clicks_real", "cheat", 1, 1],
    ]);
    expect(report.checks[2].reason).toBe("181 of 184 clicks came from different visitors. 3 repeat clicks were left out.");
    expect(report.earnedCents).toBe(1280); // 6,400 views at $2.00 per 1,000
    expect(report.status).toBe("paid"); // lane A set it; the checker leaves it
    expect(ai.watch).not.toHaveBeenCalled(); // the video was already watched for this hand-in

    const saved = await result("res_kettle_views_aarav");
    expect(saved).toMatchObject({ earnedCents: 1280, watchLabel: "Live cheat check", watchNote: "In the normal range", watchOk: true });
    expect(saved.nextCheckAt?.getTime()).toBe(now.getTime() + settings.checkEveryMinutes * 60_000);
    expect(await rowCount(readings, "res_kettle_views_aarav")).toBe(readingsBefore + 1);
    expect(await rowCount(checks, "res_kettle_views_aarav")).toBe(3);
    expect(await rowCount(moneyMoves)).toBe(movesBefore);
  });

  it("never lowers what was earned when the views go down", async () => {
    site.set(AARAV, { views: 5000, likes: 400, comments: 40, seconds: 21 });
    const report = await runChecks("clm_kettle_views_aarav");
    expect(report.measured.views).toBe(5000);
    expect(report.earnedCents).toBe(1280);
  });

  it("blocks 5,000 clicks from one visitor: counted as 1, nothing earned, never checked again", async () => {
    site.set("https://video.example.com/watch/meera-kettle-launch", { views: 140, likes: 3, comments: 0, seconds: 34 });
    // The sample data already shows meera as blocked. Put her back to "being checked" so the checker has to find it itself.
    await db.update(results).set({ status: "checking", summary: null, watchNote: null, watchOk: null }).where(eq(results.id, "res_kettle_views_meera"));
    const report = await runChecks("clm_kettle_views_meera");
    expect(report.status).toBe("blocked");
    expect(report.measured).toMatchObject({ clicksTotal: 5000, clicksReal: 1, visitors: 1 });
    expect(report.earnedCents).toBe(0);
    const clicksCheck = report.checks.find((c) => c.key === "clicks_real")!;
    expect(clicksCheck).toMatchObject({ passed: false, headline: "One visitor, 5,000 clicks", reason: "All 5,000 clicks arrived in 40 seconds from the same visitor. They were counted as 1 click." });
    const saved = await result("res_kettle_views_meera");
    expect(saved.nextCheckAt).toBeNull();
    expect(saved.watchOk).toBe(false);
    expect(saved.watchNote).toMatch(/^Fake clicks found at \d\d:\d\d and left out of the count$/);
    expect(saved.summary).toBe("Blocked: One visitor, 5,000 clicks. $0.00 paid. The held money was not touched.");
  });

  it("keeps a blocked result blocked, even when a later reading would look calm", async () => {
    const before = await result("res_kettle_views_meera");
    const readingsBefore = await rowCount(readings, "res_kettle_views_meera");
    reader.mockClear();
    const report = await runChecksAt("clm_kettle_views_meera", new Date(Date.now() + 3_600_000));
    expect(reader).not.toHaveBeenCalled();
    expect(report.status).toBe("blocked");
    expect(report.earnedCents).toBe(0);
    expect(await rowCount(readings, "res_kettle_views_meera")).toBe(readingsBefore);
    expect((await result("res_kettle_views_meera")).lastCheckedAt?.getTime()).toBe(before.lastCheckedAt?.getTime());
  });

  it("does not pay for views a video already had when it was handed in", async () => {
    const famous = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    site.set(famous, { views: 1_000_000, likes: 50_000, comments: null, seconds: 213 });
    ai.watch.mockResolvedValue({ ...EXAMPLE_PROMO, rules: EXAMPLE_PROMO.rules.map((r) => ({ ...r, met: true, seenAt: "00:05" })) });
    const { claim } = await callDibs({ jobId: "job_kettle_views", workerId: "per_tara" });
    await handIn({ claimId: claim.id, url: famous });

    const first = await runChecks(claim.id);
    expect(first.measured.views).toBe(1_000_000);
    expect(first.status).toBe("checking");
    expect(first.earnedCents).toBe(0); // a million views, none of them since the hand-in

    site.set(famous, { views: 1_003_000, likes: 50_100, comments: null, seconds: 213 });
    const later = await runChecksAt(claim.id, new Date(Date.now() + 600_000));
    expect(later.earnedCents).toBe(600); // 3,000 new views at $2.00 per 1,000
  });

  it("has AI watch a newly posted video once, and blocks it when something required is missing (EXAMPLE answer)", async () => {
    const link = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
    site.set(link, { views: 900, likes: 50, comments: null, seconds: 21 });
    ai.watch.mockResolvedValue(EXAMPLE_PROMO);
    await handIn({ claimId: "clm_kettle_views_isha", url: link });

    const report = await runChecks("clm_kettle_views_isha");
    expect(ai.watch).toHaveBeenCalledTimes(1);
    expect(ai.watch.mock.calls[0][0].video).toEqual({ kind: "public_link", url: link });
    expect(ai.watch.mock.calls[0][0].prompt).toContain("/r/ishaq8rd");
    const inVideo = report.checks.find((c) => c.key === "in_video")!;
    expect(inVideo).toMatchObject({ passed: false, passedCount: 2, totalCount: 3, headline: "Missing: Says it is a paid promotion" });
    expect(report.status).toBe("blocked");
    expect(report.earnedCents).toBe(0);
  });

  it("tells the worker when the link is not a video it can read, instead of leaving it stuck", async () => {
    const report = await runChecks("clm_kettle_views_kabir");
    expect(report.status).toBe("waiting");
    expect(report.summary).toBe("This link is not a video we can read. Please hand in the link to a public YouTube video.");
    expect((await result("res_kettle_views_kabir")).nextCheckAt).toBeNull();
  });

  it("passes on a failure of the video site itself, so the tick can try again", async () => {
    await handIn({ claimId: "clm_kettle_views_kabir", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" });
    await expect(runChecks("clm_kettle_views_kabir")).rejects.toThrow("It will be tried again");
    expect((await result("res_kettle_views_kabir")).status).toBe("waiting"); // untouched
  });
});

describe("runChecks on a recording (EXAMPLE AI answer, not real AI output)", () => {
  it("saves each rule with the moment it was met and pays per rule passed", async () => {
    ai.watch.mockResolvedValue(EXAMPLE_RECORDING);
    const { claim } = await callDibs({ jobId: "job_tinycomet_test", workerId: "per_kabir" });
    const file = await storeHandInFile({ claimId: claim.id, fileName: "my recording (1).MP4", bytes: new Uint8Array([1, 2, 3]) });
    expect(file).toMatch(new RegExp(`^${claim.id}/\\d+-my-recording-1-\\.mp4$`));
    await handIn({ claimId: claim.id, file });

    const report = await runChecks(claim.id);
    expect(ai.watch.mock.calls[0][0].video).toMatchObject({ kind: "file", mimeType: "video/mp4" });
    expect(report.checks.map((c) => [c.key, c.passed, c.seenAtSeconds])).toEqual([
      ["rule:tutorial", true, 48],
      ["rule:level_2", true, 91],
      ["rule:shop", true, 134],
      ["rule:level_3", true, 220],
      ["rule:pause_menu", false, null],
      ["recording", true, null],
    ]);
    expect(report.measured).toEqual({ mediaSeconds: 252, rulesPassed: 4, rulesTotal: 5 });
    expect(report.earnedCents).toBe(1200);
    expect(report.status).toBe("checking"); // lane A turns it to paid when the money goes out
    expect(report.summary).toBe("4 of 5 rules passed, so $12.00 was earned without anyone approving it.");
    const saved = (await db.select().from(results).where(eq(results.claimId, claim.id)))[0];
    expect(saved).toMatchObject({ watchLabel: "Recording check", watchOk: true, nextCheckAt: null });

    // A second run does not watch the recording again.
    const again = await runChecks(claim.id);
    expect(ai.watch).toHaveBeenCalledTimes(1);
    expect(again.earnedCents).toBe(1200);
    expect(again.checks).toHaveLength(6);
  });

  it("blocks a recording that is stitched together, whatever rules it shows", async () => {
    ai.watch.mockResolvedValue({ ...EXAMPLE_RECORDING, oneTake: false, oneTakeReason: "The timer jumps from 01:10 to 02:40." });
    const { claim } = await callDibs({ jobId: "job_tinycomet_test", workerId: "per_isha" });
    await handIn({ claimId: claim.id, file: await storeHandInFile({ claimId: claim.id, fileName: "a.mp4", bytes: new Uint8Array([1]) }) });
    const report = await runChecks(claim.id);
    expect(report.status).toBe("blocked");
    expect(report.earnedCents).toBe(0);
    expect(report.checks.find((c) => c.key === "recording")).toMatchObject({ passed: false, passedCount: 1, totalCount: 2, reason: "The timer jumps from 01:10 to 02:40." });
  });

  it("refuses a file kind AI cannot open, and a file that was never handed in to Dibs", async () => {
    const { claim } = await callDibs({ jobId: "job_tinycomet_test", workerId: "per_dev" });
    await handIn({ claimId: claim.id, file: await storeHandInFile({ claimId: claim.id, fileName: "notes.zip", bytes: new Uint8Array([1]) }) });
    expect((await runChecks(claim.id)).summary).toContain("AI cannot open this kind of file yet");
    // A path that climbs out of the uploads folder, and another worker's upload, are both refused.
    for (const file of ["../../../secrets.txt", "clm_someone_else/123-recording.mp4"]) {
      await handIn({ claimId: claim.id, file });
      expect((await runChecks(claim.id)).summary).toBe("That file was not uploaded for this job. Please upload your file again.");
    }
    expect(ai.watch).not.toHaveBeenCalled();
    expect(ai.text).not.toHaveBeenCalled();
    await expect(storeHandInFile({ claimId: "clm_nobody", fileName: "a.mp4", bytes: new Uint8Array([1]) })).rejects.toThrow("No such claim");
    await expect(storeHandInFile({ claimId: claim.id, fileName: "a.mp4", bytes: new Uint8Array() })).rejects.toThrow("The file is empty");
  });
});

describe("runChecks when no machine can measure the result (EXAMPLE AI answer)", () => {
  let start = new Date();

  it("gives AI's opinion, waits for the poster, and earns nothing yet", async () => {
    ai.text.mockResolvedValue(EXAMPLE_OPINION);
    const { claim } = await callDibs({ jobId: "job_kettle_translate", workerId: "per_zoya" });
    await handIn({ claimId: claim.id, file: await storeHandInFile({ claimId: claim.id, fileName: "menu-hindi.txt", bytes: new TextEncoder().encode("चाय 40") }) });
    start = new Date();

    const report = await runChecksAt(claim.id, start);
    expect(ai.text.mock.calls[0][0].prompt).toContain("चाय 40");
    expect(report.status).toBe("waiting");
    expect(report.earnedCents).toBe(0);
    expect(report.checks).toMatchObject([{ key: "opinion", group: "opinion", passed: true, reason: "Every menu item is there and the Hindi reads naturally." }]);
    const saved = (await db.select().from(results).where(eq(results.claimId, claim.id)))[0];
    expect(saved.objectionEndsAt?.getTime()).toBe(start.getTime() + settings.objectionWindowDays * DAY);
    expect(saved.nextCheckAt?.getTime()).toBe(saved.objectionEndsAt?.getTime());

    // Still inside the window: nothing changes, and AI is not asked again.
    const midway = await runChecksAt(claim.id, new Date(start.getTime() + DAY));
    expect(midway.status).toBe("waiting");
    expect(midway.earnedCents).toBe(0);
    expect(ai.text).toHaveBeenCalledTimes(1);
  });

  it("lets AI's answer stand when the window closes with no objection", async () => {
    const report = await runChecksAt("clm_" + (await claimIdOf("per_zoya")), new Date(start.getTime() + settings.objectionWindowDays * DAY + 1000));
    expect(report.earnedCents).toBe(1800);
    expect(report.status).toBe("checking");
    expect(ai.text).not.toHaveBeenCalled();
  });

  it("leaves the result alone once the poster has objected", async () => {
    ai.text.mockResolvedValue(EXAMPLE_OPINION);
    const { claim } = await callDibs({ jobId: "job_kettle_translate", workerId: "per_rohan" });
    await handIn({ claimId: claim.id, file: await storeHandInFile({ claimId: claim.id, fileName: "menu.txt", bytes: new TextEncoder().encode("menu") }) });
    const first = await runChecks(claim.id);
    await objectToOpinion({ resultId: first.resultId, posterId: "per_kettle" });

    const later = await runChecksAt(claim.id, new Date(Date.now() + 10 * DAY));
    expect(later.status).toBe("waiting");
    expect(later.earnedCents).toBe(0);
    expect((await result(first.resultId)).objectedAt).not.toBeNull();
  });

  async function claimIdOf(workerId: string): Promise<string> {
    const { claim } = await callDibs({ jobId: "job_kettle_translate", workerId });
    return claim.id.replace(/^clm_/, "");
  }
});

describe("runChecks refuses what it cannot check", () => {
  it("says so for an unknown claim and for a claim with nothing handed in", async () => {
    await expect(runChecks("clm_nobody")).rejects.toThrow("No such claim");
    await expect(runChecks("clm_tinycomet_stream_zoya")).rejects.toThrow("Nothing has been handed in");
  });
});
