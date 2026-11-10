import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Lane A's money functions are replaced by stand-ins: the tick must ask for
// payment, but no test here moves money.
const payWorker = vi.fn();
const letGo = vi.fn();
vi.mock("@/money", () => ({ payWorker: (id: string) => payWorker(id), letGo: (id: string) => letGo(id) }));

import { GET, POST } from "@/app/api/tick/route";
import { closeDb, getDb, type Db } from "@/db/client";
import { newId } from "@/db/ids";
import { jobs, moneyMoves, results } from "@/db/schema";
import { seed } from "@/db/seed";
import { settings } from "@/settings";
import { tick } from "./index";
import { NotAVideoLink, useVideoReader } from "./video-site";

let db: Db;
const reader = vi.fn(async (link: string) => {
  if (link.includes("aarav")) return { videoId: "x", views: 6200, likes: 412, comments: 38, seconds: 21, source: "page" as const };
  throw new NotAVideoLink();
});

beforeAll(async () => {
  db = await getDb();
  useVideoReader(reader);
});
afterAll(async () => {
  useVideoReader(null);
  await closeDb();
});
beforeEach(async () => {
  await seed(db); // empties and reloads the sample data
  payWorker.mockReset().mockImplementation(async () => ({ paidCents: 0, take: null, payout: null }));
  letGo.mockReset().mockResolvedValue({});
  reader.mockClear();
});

const soon = () => new Date(Date.now() + 1000);
const setEarned = (id: string, cents: number) => db.update(results).set({ earnedCents: cents }).where(eq(results.id, id));

describe("tick", () => {
  it("runs only the checks that are due", async () => {
    const summary = await tick(soon());
    expect(summary.checksRun).toBe(1); // isha's is due now; the others are minutes away
    expect(summary.problems).toEqual([]);
    expect((await db.select().from(results).where(eq(results.id, "res_kettle_views_isha")))[0].status).toBe("waiting");
    expect(payWorker).not.toHaveBeenCalled(); // everyone is already paid in full
    expect(letGo).not.toHaveBeenCalled();
  });

  it("asks lane A to pay what is owed once the batch wait has passed", async () => {
    await setEarned("res_kettle_views_aarav", 1240 + settings.minPayoutCents); // last take on this job was an hour ago
    payWorker.mockResolvedValue({ paidCents: settings.minPayoutCents, take: null, payout: null });
    const summary = await tick(soon());
    expect(payWorker).toHaveBeenCalledTimes(1);
    expect(payWorker).toHaveBeenCalledWith("res_kettle_views_aarav");
    expect(summary).toMatchObject({ payoutsSent: 1, paidCents: settings.minPayoutCents });
  });

  it("waits when the job was paid less than a batch ago, and when too little is owed", async () => {
    await setEarned("res_loom_sales_dev", 2000 + 500);
    await db.insert(moneyMoves).values({ id: newId("mov"), jobId: "job_loom_sales", resultId: "res_loom_sales_tara", personId: "per_tara", kind: "take", amountCents: 0, status: "failed", note: "test", createdAt: new Date(Date.now() - 10 * 60_000) });
    await setEarned("res_tinycomet_test_zoya", 1200 + settings.minPayoutCents - 1);
    await tick(soon());
    expect(payWorker).not.toHaveBeenCalled();

    // Once the wait is over, the same amount is paid.
    await tick(new Date(Date.now() + settings.payBatchMinutes * 60_000));
    expect(payWorker.mock.calls.map((c) => c[0])).toContain("res_loom_sales_dev");
    expect(payWorker.mock.calls.map((c) => c[0])).not.toContain("res_tinycomet_test_zoya");
  });

  it("does not count money that is already on its way", async () => {
    await setEarned("res_kettle_views_aarav", 1240 + 400);
    await db.insert(moneyMoves).values({ id: newId("mov"), jobId: "job_kettle_views", resultId: "res_kettle_views_aarav", personId: "per_aarav", kind: "take", amountCents: 400, status: "pending", note: "test", createdAt: new Date(Date.now() - 2 * 3_600_000) });
    await tick(soon());
    expect(payWorker).not.toHaveBeenCalled();
  });

  it("for a job past its end: one last check and payment for each result, then lets go of the hold", async () => {
    await db.update(jobs).set({ endsAt: new Date(Date.now() - 60_000) }).where(eq(jobs.id, "job_kettle_views"));
    await setEarned("res_kettle_views_aarav", 1240 + 10); // under the smallest payout, but this is the last chance
    payWorker.mockImplementation(async (id: string) => {
      // Stands in for lane A: records the take and the payout, as payWorker will.
      for (const kind of ["take", "payout"] as const) {
        await db.insert(moneyMoves).values({ id: newId("mov"), jobId: "job_kettle_views", resultId: id, personId: "per_aarav", kind, amountCents: 10, status: "done", note: "test" });
      }
      return { paidCents: 10, take: null, payout: null };
    });
    const summary = await tick(soon());
    expect(reader).toHaveBeenCalledTimes(3); // aarav, kabir, isha. meera is blocked and stays blocked.
    expect(payWorker).toHaveBeenCalledWith("res_kettle_views_aarav");
    expect(letGo).toHaveBeenCalledTimes(1);
    expect(letGo).toHaveBeenCalledWith("job_kettle_views");
    expect(summary.jobsEnded).toBe(1);
    expect((await db.select().from(results).where(eq(results.id, "res_kettle_views_aarav")))[0].nextCheckAt).toBeNull();
  });

  it("keeps the hold while an AI opinion can still be objected to", async () => {
    await db.update(jobs).set({ endsAt: new Date(Date.now() - 60_000) }).where(eq(jobs.id, "job_tinycomet_stream"));
    await db.insert(results).values({ id: "res_open_opinion", claimId: "clm_tinycomet_stream_zoya", jobId: "job_tinycomet_stream", workerId: "per_zoya", handInKind: "link", status: "waiting", objectionEndsAt: new Date(Date.now() + 86_400_000) });
    expect((await tick(soon())).jobsEnded).toBe(0);
    expect(letGo).not.toHaveBeenCalled();

    // Once the poster objects, a person decides, and the hold is let go as usual.
    await db.update(results).set({ objectedAt: new Date() }).where(eq(results.id, "res_open_opinion"));
    expect((await tick(soon())).jobsEnded).toBe(1);
    expect(letGo).toHaveBeenCalledWith("job_tinycomet_stream");
  });

  it("keeps the hold when a worker is still owed at the end, and tries again next tick", async () => {
    await db.update(jobs).set({ endsAt: new Date(Date.now() - 60_000) }).where(eq(jobs.id, "job_loom_sales"));
    await setEarned("res_loom_sales_dev", 2000 + 500);
    payWorker.mockRejectedValue(new Error("PayPal did not answer."));
    const failed = await tick(soon());
    expect(letGo).not.toHaveBeenCalled();
    expect(failed.jobsEnded).toBe(0);
    expect(failed.problems.join("\n")).toContain("Job job_loom_sales has ended but its hold is kept: 1 result(s) are still owed money");

    // PayPal is back: lane A pays (here the stand-in records the take and payout), and only then is the hold let go.
    payWorker.mockImplementation(async (id: string) => {
      for (const kind of ["take", "payout"] as const) {
        await db.insert(moneyMoves).values({ id: newId("mov"), jobId: "job_loom_sales", resultId: id, personId: "per_dev", kind, amountCents: 500, status: "done", note: "test" });
      }
      return { paidCents: 500, take: null, payout: null };
    });
    const retried = await tick(soon());
    expect(letGo).toHaveBeenCalledWith("job_loom_sales");
    expect(retried).toMatchObject({ jobsEnded: 1, paidCents: 500 });
  });

  it("asks lane A to send a payout again when money left the hold but never reached the worker", async () => {
    await db.insert(moneyMoves).values({ id: newId("mov"), jobId: "job_tinycomet_test", resultId: "res_tinycomet_test_rohan", personId: "per_rohan", kind: "take", amountCents: 300, status: "done", note: "test", createdAt: new Date(Date.now() - 60_000) });
    await db.insert(moneyMoves).values({ id: newId("mov"), jobId: "job_tinycomet_test", resultId: "res_tinycomet_test_rohan", personId: "per_rohan", kind: "payout", amountCents: 300, status: "failed", note: "test" });
    await setEarned("res_tinycomet_test_rohan", 1200 + 300);
    await tick(soon());
    expect(payWorker).toHaveBeenCalledWith("res_tinycomet_test_rohan"); // not held back by the batch wait
  });

  it("pays nothing more to a blocked result", async () => {
    await db.update(results).set({ status: "blocked", earnedCents: 1240 + 500 }).where(eq(results.id, "res_kettle_views_aarav"));
    await tick(soon());
    expect(payWorker).not.toHaveBeenCalled();
  });

  it("tries a failed check again at the usual pace, not every minute", async () => {
    const now = soon();
    await db.update(results).set({ nextCheckAt: new Date(), handInUrl: "https://video.example.com/aarav-down" }).where(eq(results.id, "res_kettle_views_aarav"));
    reader.mockRejectedValueOnce(new Error("The video site did not answer (error 500). It will be tried again."));
    const summary = await tick(now);
    expect(summary.problems.join("\n")).toContain("It will be tried again");
    const saved = (await db.select().from(results).where(eq(results.id, "res_kettle_views_aarav")))[0];
    expect(saved.nextCheckAt?.getTime()).toBe(now.getTime() + settings.checkEveryMinutes * 60_000);
  });

  it("carries on when one thing fails, and says what failed", async () => {
    await setEarned("res_kettle_views_aarav", 1240 + 500);
    await setEarned("res_tinycomet_test_zoya", 1200 + 500);
    payWorker.mockImplementation(async (id: string) => {
      if (id === "res_kettle_views_aarav") throw new Error("not built yet: lane A owns payWorker");
      return { paidCents: 500, take: null, payout: null };
    });
    reader.mockRejectedValueOnce(new Error("The video site did not answer (error 500). It will be tried again."));
    await db.update(results).set({ nextCheckAt: new Date() }).where(eq(results.id, "res_kettle_views_aarav"));

    const summary = await tick(soon());
    expect(summary.problems).toHaveLength(2);
    expect(summary.problems.join("\n")).toContain("Payment for result res_kettle_views_aarav: not built yet: lane A owns payWorker");
    expect(summary.problems.join("\n")).toContain("It will be tried again");
    expect(summary).toMatchObject({ payoutsSent: 1, paidCents: 500 });
    expect(summary.checksRun).toBeGreaterThanOrEqual(1);
  });
});

describe("the tick address", () => {
  const before = process.env.TICK_SECRET;
  afterEach(() => {
    if (before === undefined) delete process.env.TICK_SECRET;
    else process.env.TICK_SECRET = before;
  });
  const call = (headers: Record<string, string> = {}) => GET(new Request("http://localhost:3002/api/tick", { headers }));

  it("is switched off when no password is set", async () => {
    delete process.env.TICK_SECRET;
    expect((await call()).status).toBe(503);
  });

  it("refuses a missing or wrong password, and a password in the address", async () => {
    process.env.TICK_SECRET = "example-password-for-tests";
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await GET(new Request("http://localhost:3002/api/tick?secret=example-password-for-tests"))).status).toBe(401);
  });

  it("runs the tick with the right password, in either header", async () => {
    process.env.TICK_SECRET = "example-password-for-tests";
    const response = await call({ authorization: "Bearer example-password-for-tests" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, checksRun: 1, problems: [] });
    const posted = await POST(new Request("http://localhost:3002/api/tick", { method: "POST", headers: { "x-tick-secret": "example-password-for-tests" } }));
    expect(posted.status).toBe(200);
  });
});
