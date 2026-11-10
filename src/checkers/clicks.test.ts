import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { GET } from "@/app/r/[code]/route";
import { closeDb, getDb, type Db } from "@/db/client";
import { clicks, trackedLinks } from "@/db/schema";
import { seed } from "@/db/seed";
import { settings } from "@/settings";
import { burstReason, countClicks, recordClick, REPEAT_REASON, visitorKeyFor } from "./clicks";

let db: Db;
beforeAll(async () => {
  db = await getDb();
  await seed(db);
  // Fresh links with no clicks, on the seeded views job.
  for (const [code, claimId] of [
    ["testone1", "clm_kettle_views_kabir"],
    ["testtwo2", "clm_kettle_views_isha"],
  ] as const) {
    await db.delete(trackedLinks).where(eq(trackedLinks.claimId, claimId));
    await db.insert(trackedLinks).values({ code, claimId, jobId: "job_kettle_views", targetUrl: "https://kettleandclove.example.com/launch" });
  }
});
afterAll(closeDb);

describe("tracked links", () => {
  it("scrambles the visitor: same visitor, same mark; the raw address is not in it", () => {
    const a = visitorKeyFor("203.0.113.9", "Mozilla/5.0");
    expect(a).toBe(visitorKeyFor("203.0.113.9", "Mozilla/5.0"));
    expect(a).not.toBe(visitorKeyFor("203.0.113.10", "Mozilla/5.0"));
    expect(a).not.toContain("203.0.113.9");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("counts 5,000 clicks from one visitor as 1, and stores the reason on the other 4,999", async () => {
    const visitor = visitorKeyFor("203.0.113.9", "click-script");
    const start = Date.now() - 60 * 60_000;
    for (let i = 0; i < 5000; i++) await recordClick("testone1", visitor, new Date(start + i * 8));

    const counts = await countClicks("testone1");
    expect(counts).toMatchObject({ clicksTotal: 5000, clicksReal: 1, visitors: 1, repeats: 4999, mostFromOneVisitor: 5000 });
    expect(counts.burst).toMatchObject({ clicks: 5000, seconds: 40 });

    const leftOut = (await db.select({ n: count() }).from(clicks).where(and(eq(clicks.linkCode, "testone1"), eq(clicks.counted, false), eq(clicks.leftOutReason, REPEAT_REASON))))[0].n;
    expect(leftOut).toBe(4999);
    const withReason = (await db.select({ n: count() }).from(clicks).where(and(eq(clicks.linkCode, "testone1"), isNotNull(clicks.leftOutReason))))[0].n;
    expect(withReason).toBe(4999);
  }, 300_000);

  it("counts one when the same visitor clicks twice at the same instant", async () => {
    const at = new Date();
    const visitor = visitorKeyFor("198.51.100.1", "phone");
    const both = await Promise.all([recordClick("testtwo2", visitor, at), recordClick("testtwo2", visitor, at)]);
    expect(both.filter((c) => c?.counted).length).toBe(1);
    expect(both.find((c) => !c?.counted)?.leftOutReason).toBe(REPEAT_REASON);
  });

  it("leaves a machine-speed burst out of the count even when every visitor is different", async () => {
    const { maxClicksInWindow } = settings.cheatTests.clickBurst;
    const start = Date.now() - 30 * 60_000;
    const before = await countClicks("testtwo2");
    for (let i = 0; i < maxClicksInWindow + 10; i++) await recordClick("testtwo2", visitorKeyFor(`192.0.2.${i}`, "bot"), new Date(start + i * 100));
    const after = await countClicks("testtwo2");
    expect(after.clicksTotal - before.clicksTotal).toBe(maxClicksInWindow + 10);
    expect(after.clicksReal - before.clicksReal).toBe(maxClicksInWindow);
    expect(after.burst?.clicks).toBe(maxClicksInWindow + 10);
    const burstRows = (await db.select({ n: count() }).from(clicks).where(and(eq(clicks.linkCode, "testtwo2"), eq(clicks.leftOutReason, burstReason()))))[0].n;
    expect(burstRows).toBe(10);
  });

  it("the address stores the click and sends the visitor on; an unknown code is a plain 404", async () => {
    const before = (await countClicks("testtwo2")).clicksTotal;
    const request = new Request("http://localhost:3002/r/testtwo2", { headers: { "x-forwarded-for": "203.0.113.77, 10.0.0.1", "user-agent": "Mozilla/5.0" } });
    const response = await GET(request, { params: Promise.resolve({ code: "testtwo2" }) });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://kettleandclove.example.com/launch");
    expect((await countClicks("testtwo2")).clicksTotal).toBe(before + 1);
    const stored = await db.select().from(clicks).where(eq(clicks.visitorKey, visitorKeyFor("203.0.113.77", "Mozilla/5.0")));
    expect(stored).toHaveLength(1);

    for (const code of ["nosuchcd", "../../etc"]) {
      const missing = await GET(new Request("http://localhost:3002/r/x"), { params: Promise.resolve({ code }) });
      expect(missing.status).toBe(404);
    }
    expect(await recordClick("nosuchcd", "v")).toBeNull();
  });
});
