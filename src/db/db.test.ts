import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import type { JobCard } from "@/contract/types";
import { closeDb, getDb, type Db } from "./client";
import { getBoard, getJobMoney, getJobPage, getMyJobs, getMyWork, getPeople, getPerson } from "./read";
import * as schema from "./schema";
import { assertSeedAllowed, seed } from "./seed";
import { callDibs, createJob, handIn, joinDibs, objectToOpinion } from "./write";

let db: Db;

beforeAll(async () => {
  db = await getDb();
  await seed(db);
});
afterAll(closeDb);

async function rowCounts() {
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries({
    people: schema.people,
    jobs: schema.jobs,
    claims: schema.claims,
    results: schema.results,
    checks: schema.checks,
    readings: schema.readings,
    moneyMoves: schema.moneyMoves,
    trackedLinks: schema.trackedLinks,
    clicks: schema.clicks,
    sales: schema.sales,
  })) {
    out[name] = (await db.select({ n: count() }).from(table))[0].n;
  }
  return out;
}

describe("the sample data", () => {
  it("has the six jobs from the drawing, in the drawing's order", async () => {
    const board = await getBoard();
    expect(board.jobs.map((j) => j.job.title)).toEqual([
      "Get our launch video 10,000 views",
      "Bring us paying customers",
      "Test levels 1 to 3 and record your screen",
      "Play our game on stream for 30 minutes",
      "Find real bugs on our checkout page",
      "Translate our menu into Hindi",
    ]);
    expect(board.jobs.map((j) => j.poster.name)).toEqual([
      "Kettle & Clove",
      "Loom & Thread",
      "Tiny Comet Games",
      "Tiny Comet Games",
      "Northside Bakes",
      "Kettle & Clove",
    ]);
    expect(board.jobs.map((j) => j.daysLeft)).toEqual([9, 16, 5, 12, 7, 3]);
  });

  it("counts the jobs in each tab", async () => {
    const board = await getBoard();
    expect(board.categoryCounts).toEqual({ all: 6, promotion: 2, testing: 2, sales: 1, writing: 1, design: 0, other: 0 });
  });

  it("shows the same paid and held money as the drawing", async () => {
    const board = await getBoard();
    const money = board.jobs.map((j) => [j.money.lockedCents, j.money.paidCents, j.money.heldCents]);
    expect(money).toEqual([
      [5000, 1240, 3760],
      [20000, 3500, 16500],
      [6000, 2400, 3600],
      [4000, 0, 4000],
      [8000, 1600, 6400],
      [1800, 0, 1800],
    ]);
  });

  it("keeps locked = paid + held + let go for every job, and locked = the budget", async () => {
    for (const { job, money } of (await getBoard()).jobs) {
      expect(money.paidCents + money.heldCents + money.letGoCents).toBe(money.lockedCents);
      expect(money.lockedCents).toBe(job.budgetCents);
      expect(job.card.capCents).toBe(job.budgetCents);
    }
  });

  it("pays every worker exactly what the checker says they earned", async () => {
    for (const { job } of (await getBoard()).jobs) {
      const page = await getJobPage(job.id);
      for (const card of page!.results) {
        if (card.result.status === "paid") expect(card.paidCents).toBe(card.result.earnedCents);
        else expect(card.paidCents).toBe(0);
      }
    }
  });

  it("can be loaded twice without doubling anything", async () => {
    const before = await rowCounts();
    await seed(db);
    expect(await rowCounts()).toEqual(before);
    expect(before.jobs).toBe(6);
    expect(before.clicks).toBeGreaterThan(5000);
  });
});

describe("the views job page", () => {
  it("has four results: one paid, two checking, one blocked", async () => {
    const page = (await getJobPage("job_kettle_views"))!;
    expect(page.poster.name).toBe("Kettle & Clove");
    expect(page.counts).toEqual({ all: 4, paid: 1, checking: 2, blocked: 1, waiting: 0 });
    expect(page.progress).toEqual({ unit: "view", count: 6200, target: 10000 });
    expect(page.daysLeft).toBe(9);
    expect(page.lastReadAt).toBeInstanceOf(Date);
  });

  it("shows aarav.clips paid $12.40 with 5 of 5 checks", async () => {
    const page = (await getJobPage("job_kettle_views"))!;
    const aarav = page.results.find((r) => r.worker.name === "aarav.clips")!;
    expect(aarav.result.status).toBe("paid");
    expect(aarav.result.earnedCents).toBe(1240);
    expect(aarav.paidCents).toBe(1240);
    expect(aarav.result.measured).toMatchObject({ views: 6200, likes: 412, comments: 38, clicksTotal: 184, clicksReal: 181 });
    expect([aarav.checksPassed, aarav.checksTotal]).toEqual([5, 5]);
    expect(aarav.checks.map((c) => [c.label, c.passedCount, c.totalCount])).toEqual([
      ["In the video", 3, 3],
      ["Views look real", 1, 1],
      ["Clicks look real", 1, 1],
    ]);
    expect(aarav.lastPayout?.paypalRef).toBe("4GH81652WS903271B");
    expect(aarav.result.watchNote).toBe("In the normal range");
    expect(aarav.readings.length).toBeGreaterThan(3);
    expect(aarav.readings.at(-1)?.views).toBe(6200);
    expect(aarav.link).not.toBeNull();
  });

  it("shows meera.reels blocked: 5,000 clicks counted as 1, nothing paid", async () => {
    const page = (await getJobPage("job_kettle_views"))!;
    const meera = page.results.find((r) => r.worker.name === "meera.reels")!;
    expect(meera.result.status).toBe("blocked");
    expect(meera.result.earnedCents).toBe(0);
    expect(meera.paidCents).toBe(0);
    expect(meera.lastPayout).toBeNull();
    expect(meera.result.measured).toMatchObject({ views: 140, clicksTotal: 5000, clicksReal: 1, visitors: 1 });
    expect([meera.checksPassed, meera.checksTotal]).toEqual([4, 5]);
    const failed = meera.checks.filter((c) => !c.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0].headline).toBe("One visitor, 5,000 clicks");
    expect(failed[0].reason).toBe(
      "All 5,000 clicks arrived in 40 seconds from the same visitor. They were counted as 1 click.",
    );
    expect(meera.result.watchOk).toBe(false);

    const clicks = await db.select().from(schema.clicks);
    const hers = clicks.filter((c) => c.linkCode === meera.link!.code);
    expect(hers).toHaveLength(5000);
    expect(hers.filter((c) => c.counted)).toHaveLength(1);
    expect(new Set(hers.map((c) => c.visitorKey)).size).toBe(1);
  });
});

describe("the test job page", () => {
  it("shows zoya.plays paid $12.00 for 4 of 5 rules, with the moment each was seen", async () => {
    const page = (await getJobPage("job_tinycomet_test"))!;
    const zoya = page.results.find((r) => r.worker.name === "zoya.plays")!;
    expect(zoya.result.status).toBe("paid");
    expect(zoya.result.earnedCents).toBe(1200);
    expect(zoya.paidCents).toBe(1200);
    expect(zoya.result.measured).toMatchObject({ rulesPassed: 4, rulesTotal: 5, mediaSeconds: 252 });
    const rules = zoya.checks.filter((c) => c.group === "rule");
    expect(rules.map((c) => [c.label, c.passed, c.seenAtSeconds])).toEqual([
      ["Finished the tutorial", true, 48],
      ["Reached level 2", true, 91],
      ["Opened the shop and bought an item", true, 134],
      ["Reached level 3", true, 220],
      ["Tried the pause menu", false, null],
    ]);
    expect(zoya.lastPayout?.paypalRef).toBe("9TR30418KM227645C");
    expect(zoya.result.watchLabel).toBe("Recording check");
  });
});

describe("a worker's own page", () => {
  it("adds up what reached zoya.plays and lists her jobs", async () => {
    const mine = (await getMyWork("per_zoya"))!;
    expect(mine.person.name).toBe("zoya.plays");
    expect(mine.earnedCents).toBe(1200);
    expect(mine.payouts).toHaveLength(1);
    expect(mine.items.map((i) => i.job.title).sort()).toEqual([
      "Play our game on stream for 30 minutes",
      "Test levels 1 to 3 and record your screen",
    ]);
    const open = mine.items.find((i) => i.claim.status === "open")!;
    expect(open.card).toBeNull();
  });

  it("tells the board what the viewer has earned", async () => {
    const board = await getBoard("per_aarav");
    expect(board.viewer?.name).toBe("aarav.clips");
    expect(board.viewerEarnedCents).toBe(1240);
    const nobody = await getBoard("per_nope");
    expect(nobody.viewer).toBeNull();
    expect(nobody.viewerEarnedCents).toBe(0);
  });
});

describe("things that do not exist", () => {
  it("come back as null, not a crash", async () => {
    expect(await getJobPage("nope")).toBeNull();
    expect(await getPerson("nope")).toBeNull();
    expect(await getMyWork("nope")).toBeNull();
    expect(await getJobMoney("nope")).toEqual({ lockedCents: 0, paidCents: 0, heldCents: 0, letGoCents: 0 });
  });
});

describe("joining, posting, calling dibs and handing in", () => {
  it("keeps one person per PayPal email", async () => {
    const first = await joinDibs({ name: "nisha.draws", paypalEmail: "Nisha@Example.com " });
    const again = await joinDibs({ name: "someone else", paypalEmail: "nisha@example.com" });
    expect(again.id).toBe(first.id);
    expect(first.paypalEmail).toBe("nisha@example.com");
    expect((await getPerson(first.id))?.name).toBe("nisha.draws");
    // Someone who has posted and taken nothing is still in the list of everyone.
    expect((await getPeople()).map((p) => p.id)).toContain(first.id);
    await expect(joinDibs({ name: "", paypalEmail: "x@example.com" })).rejects.toThrow("name");
    await expect(joinDibs({ name: "x", paypalEmail: "not an email" })).rejects.toThrow("email");
  });

  it("stores a new job as a draft that is not on the board until money is held", async () => {
    const template = (await getJobPage("job_kettle_views"))!.job.card;
    const card: JobCard = { ...template, title: "A brand new job", endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() };
    const job = await createJob({ posterId: "per_kettle", sentence: "Something new", card });
    expect(job.status).toBe("draft");
    expect(job.budgetCents).toBe(5000);
    expect(job.title).toBe("A brand new job");
    expect((await getBoard()).jobs.map((j) => j.job.id)).not.toContain(job.id);
    expect((await getJobPage(job.id))!.money.lockedCents).toBe(0);

    await expect(callDibs({ jobId: job.id, workerId: "per_zoya" })).rejects.toThrow("not open");
    await expect(createJob({ posterId: "per_kettle", sentence: "s", card: { ...card, capCents: 12.5 } })).rejects.toThrow("whole cents");
    const tooLong = new Date(Date.now() + 40 * 86_400_000).toISOString();
    await expect(createJob({ posterId: "per_kettle", sentence: "s", card: { ...card, endsAt: tooLong } })).rejects.toThrow("21 days");
    await expect(createJob({ posterId: "per_nope", sentence: "s", card })).rejects.toThrow("person");
  });

  it("gives a worker one claim per job, with their own tracked link", async () => {
    const nisha = await joinDibs({ name: "nisha.draws", paypalEmail: "nisha@example.com" });
    const first = await callDibs({ jobId: "job_kettle_views", workerId: nisha.id });
    const again = await callDibs({ jobId: "job_kettle_views", workerId: nisha.id });
    expect(again.claim.id).toBe(first.claim.id);
    expect(first.claim.status).toBe("open");
    expect(first.link?.code).toMatch(/^[a-z0-9]{8}$/);
    expect(again.link?.code).toBe(first.link?.code);
    expect(first.link?.targetUrl).toBe("https://kettleandclove.example.com/launch");
    expect(first.result).toBeNull();
    await expect(callDibs({ jobId: "nope", workerId: nisha.id })).rejects.toThrow("job");
  });

  it("starts measuring at once when the job needs nothing handed in", async () => {
    const nisha = await joinDibs({ name: "nisha.draws", paypalEmail: "nisha@example.com" });
    const { claim, link, result } = await callDibs({ jobId: "job_loom_sales", workerId: nisha.id });
    expect(link).not.toBeNull();
    expect(result?.status).toBe("checking");
    expect(result?.handInKind).toBe("none");
    expect(claim.status).toBe("handed_in");
  });

  it("turns a handed-in link into a result waiting to be checked", async () => {
    const nisha = await joinDibs({ name: "nisha.draws", paypalEmail: "nisha@example.com" });
    const { claim } = await callDibs({ jobId: "job_kettle_views", workerId: nisha.id });
    await expect(handIn({ claimId: claim.id })).rejects.toThrow("link");
    await expect(handIn({ claimId: claim.id, url: "not a link" })).rejects.toThrow("link");

    const result = await handIn({ claimId: claim.id, url: "https://video.example.com/nisha" });
    expect(result.status).toBe("checking");
    expect(result.earnedCents).toBe(0);
    expect(result.handInUrl).toBe("https://video.example.com/nisha");
    expect(result.nextCheckAt).toBeInstanceOf(Date);

    const changed = await handIn({ claimId: claim.id, url: "https://video.example.com/nisha-2" });
    expect(changed.id).toBe(result.id);
    expect(changed.handInUrl).toBe("https://video.example.com/nisha-2");

    const mine = (await getMyWork(nisha.id))!;
    const item = mine.items.find((i) => i.job.id === "job_kettle_views")!;
    expect(item.claim.status).toBe("handed_in");
    expect(item.card?.result.id).toBe(result.id);
    expect((await getJobPage("job_kettle_views"))!.counts.all).toBe(5);
  });

  it("asks for a file when the job is checked from a file", async () => {
    const nisha = await joinDibs({ name: "nisha.draws", paypalEmail: "nisha@example.com" });
    const { claim, link } = await callDibs({ jobId: "job_tinycomet_test", workerId: nisha.id });
    expect(link).toBeNull();
    await expect(handIn({ claimId: claim.id, url: "https://video.example.com/x" })).rejects.toThrow("file");
    const result = await handIn({ claimId: claim.id, file: "uploads/nisha.mp4" });
    expect(result.handInKind).toBe("file");
    expect(result.handInFile).toBe("uploads/nisha.mp4");
    await expect(handIn({ claimId: "nope", file: "x" })).rejects.toThrow("claim");
  });
});

describe("checks added after review", () => {
  const cardFrom = async (jobId: string) => {
    const card = (await getJobPage(jobId))!.job.card;
    return { ...card, endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() };
  };

  it("refuses a card that counts clicks or sales but has no page to send visitors to", async () => {
    const card = await cardFrom("job_loom_sales");
    await expect(createJob({ posterId: "per_loom", sentence: "s", card: { ...card, targetUrl: null } })).rejects.toThrow("link");
  });

  it("refuses a pay rule that is not whole cents or could never pay", async () => {
    const card = await cardFrom("job_kettle_views");
    const bad = (payRule: JobCard["payRule"]) => createJob({ posterId: "per_kettle", sentence: "s", card: { ...card, payRule } });
    await expect(bad({ kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 200, batchSize: 0 })).rejects.toThrow("pay rule");
    await expect(bad({ kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 0.2, batchSize: 1 })).rejects.toThrow("pay rule");
    await expect(bad({ kind: "per_rule", centsPerRule: 300, rules: [] })).rejects.toThrow("pay rule");
    await expect(bad({ kind: "once", cents: 9999 })).rejects.toThrow("pay rule");
    await expect(bad({ kind: "once", cents: 0 })).rejects.toThrow("pay rule");
  });

  it("refuses a hand-in after the job's end date", async () => {
    const late = await joinDibs({ name: "late.larry", paypalEmail: "late@example.com" });
    const { claim } = await callDibs({ jobId: "job_tinycomet_stream", workerId: late.id });
    await db.update(schema.jobs).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(schema.jobs.id, "job_tinycomet_stream"));
    await expect(handIn({ claimId: claim.id, url: "https://stream.example.com/late" })).rejects.toThrow("ended");
    await db.update(schema.jobs).set({ endsAt: new Date(Date.now() + 5 * 86_400_000) }).where(eq(schema.jobs.id, "job_tinycomet_stream"));
  });

  it("lets the poster object to an AI opinion once, while the window is open", async () => {
    const writer = await joinDibs({ name: "hindi.writer", paypalEmail: "writer@example.com" });
    const { claim } = await callDibs({ jobId: "job_kettle_translate", workerId: writer.id });
    const result = await handIn({ claimId: claim.id, file: "uploads/menu-hi.pdf" });

    await expect(objectToOpinion({ resultId: result.id, posterId: "per_kettle" })).rejects.toThrow("nothing to object to");
    await db
      .update(schema.results)
      .set({ status: "waiting", objectionEndsAt: new Date(Date.now() + 3 * 86_400_000) })
      .where(eq(schema.results.id, result.id));
    await expect(objectToOpinion({ resultId: result.id, posterId: "per_loom" })).rejects.toThrow("poster");

    const objected = await objectToOpinion({ resultId: result.id, posterId: "per_kettle" });
    expect(objected.objectedAt).toBeInstanceOf(Date);
    expect(objected.status).toBe("waiting");
    expect(objected.nextCheckAt).toBeNull();
    const again = await objectToOpinion({ resultId: result.id, posterId: "per_kettle" });
    expect(again.objectedAt).toEqual(objected.objectedAt);

    await db.update(schema.results).set({ objectedAt: null, objectionEndsAt: new Date(Date.now() - 1000) }).where(eq(schema.results.id, result.id));
    await expect(objectToOpinion({ resultId: result.id, posterId: "per_kettle" })).rejects.toThrow("3 days");
    await expect(objectToOpinion({ resultId: "nope", posterId: "per_kettle" })).rejects.toThrow("result");
  });

  it("shows a poster every job they posted, drafts and all", async () => {
    const mine = await getMyJobs("per_tinycomet");
    expect(mine.map((j) => j.job.title).sort()).toEqual([
      "Play our game on stream for 30 minutes",
      "Test levels 1 to 3 and record your screen",
    ]);
    const kettle = await getMyJobs("per_kettle");
    expect(kettle.some((j) => j.job.status === "draft")).toBe(true);
    expect(await getMyJobs("nope")).toEqual([]);
  });

  it("counts workers who called dibs and have not handed in yet", async () => {
    const page = (await getJobPage("job_tinycomet_stream"))!;
    expect(page.counts.all).toBe(0);
    expect(page.notHandedIn).toBe(2); // zoya.plays from the sample, late.larry from the test above
  });

  it("will not wipe a hosted database unless told to", () => {
    expect(() => assertSeedAllowed("hosted", {})).toThrow("DIBS_ALLOW_SEED");
    expect(() => assertSeedAllowed("hosted", { DIBS_ALLOW_SEED: "1" })).not.toThrow();
    expect(() => assertSeedAllowed("embedded", {})).not.toThrow();
  });
});