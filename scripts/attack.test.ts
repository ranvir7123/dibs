import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../src/db/client";
import { seed } from "../src/db/seed";
import { plainCountProblem, probeLink, readClickCount, sendClicks, standInProblem } from "./attack-lib";
import { startStandIn } from "./stand-in-link-server";

// kabir.cuts's link in the sample data: it starts with no clicks at all.
const CODE = "kabirn2w";

describe("the click attack against the stand-in link server", () => {
  let standIn: Awaited<ReturnType<typeof startStandIn>>;

  beforeAll(async () => {
    await seed(await getDb());
    standIn = await startStandIn();
  });

  afterAll(async () => {
    await standIn.close();
    await closeDb();
  });

  it("stores every click and counts one visitor once", async () => {
    const before = await readClickCount(CODE);
    expect(before).toEqual({ known: true, stored: 0, counted: 0 });

    const report = await sendClicks({ baseUrl: standIn.baseUrl, code: CODE, clicks: 200, atOnce: 20 });
    expect(report.sent).toBe(200);
    expect(report.answered).toBe(200);
    expect(report.failed).toBe(0);
    expect(report.statuses).toEqual({ "302": 200 });

    const after = await readClickCount(CODE);
    expect(after).toEqual({ known: true, stored: 200, counted: 1 });
  });

  it("a second attack from the same machine adds nothing to the count", async () => {
    await sendClicks({ baseUrl: standIn.baseUrl, code: CODE, clicks: 50, atOnce: 10 });
    expect(await readClickCount(CODE)).toEqual({ known: true, stored: 250, counted: 1 });
  });

  it("says a link is there before any attack starts", async () => {
    expect(await probeLink(standIn.baseUrl, CODE)).toEqual({ ok: true, status: 302 });
    // The probe itself is one more click from the same visitor: stored, not counted.
    expect(await readClickCount(CODE)).toEqual({ known: true, stored: 251, counted: 1 });
  });

  it("refuses an unknown link instead of attacking it", async () => {
    const probe = await probeLink(standIn.baseUrl, "nosuchlink");
    expect(probe.ok).toBe(false);
    expect(probe.status).toBe(404);
    expect(await readClickCount("nosuchlink")).toEqual({ known: false, stored: 0, counted: 0 });
  });

  it("explains a locked database without telling anyone to stop the app", () => {
    const fromClient = new Error('The database folder C:\\x\\.data\\pglite is already open in another program (number 123), most likely a running "npm run dev". Stop that program, or ...');
    const plain = plainCountProblem(fromClient);
    expect(plain).toContain("built-in database");
    expect(plain).not.toContain("Stop that program");
    expect(plain).not.toContain("C:\\");
    expect(plainCountProblem(new Error("connection refused"))).toBe("connection refused");
  });

  it("refuses to run the stand-in on a hosted database", () => {
    expect(standInProblem("embedded")).toBeNull();
    expect(standInProblem("hosted")).toContain("DATABASE_URL");
  });

  it("refuses a site that is not there", async () => {
    const probe = await probeLink("http://127.0.0.1:9", CODE);
    expect(probe.ok).toBe(false);
    expect(probe.status).toBeNull();
  });
});
