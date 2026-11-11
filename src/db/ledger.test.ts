import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { JobCard } from "@/contract/types";
import { closeDb, getDb, type Db } from "./client";
import { getLedger, stoppedCents } from "./ledger";
import { getMyJobs, getPeople } from "./read";
import { jobs } from "./schema";
import { seed } from "./seed";

let db: Db;
let idOf: (name: string) => string;

beforeAll(async () => {
  db = await getDb();
  await seed(db);
  const everyone = await getPeople();
  idOf = (name) => {
    const person = everyone.find((p) => p.name === name);
    if (!person) throw new Error(`The sample data has no person called ${name}`);
    return person.id;
  };
});
afterAll(closeDb);

describe("the ledger of one business", () => {
  it("lists the lock, each payment with its payout reference, and the blocked result", async () => {
    const ledger = await getLedger(idOf("Kettle & Clove"));
    const views = ledger.rows.filter((row) => row.job === "Get our launch video 10,000 views");

    const lock = views.find((row) => row.kind === "locked")!;
    expect(lock).toMatchObject({ amountCents: 5000, paypalRef: "SAMPLE-HOLD-KETTLE-VIEWS", worker: null, stillLockedCents: 3760 });

    const paid = views.filter((row) => row.kind === "paid").sort((a, b) => a.amountCents - b.amountCents);
    expect(paid.map((row) => [row.amountCents, row.worker, row.takeRef, row.paypalRef, row.measured, row.units])).toEqual([
      [400, "aarav.clips", "SAMPLE-TAKE-0201", "SAMPLE-PAYOUT-0202", "2,000 views", 2000],
      [840, "aarav.clips", "SAMPLE-TAKE-0203", "4GH81652WS903271B", "4,200 views", 4200],
    ]);

    // 140 views at $2.00 for every 1,000 is 28 cents the blocked result was not paid.
    const blocked = views.find((row) => row.kind === "blocked")!;
    expect(blocked).toMatchObject({ worker: "meera.reels", amountCents: 28, measured: "5,000 clicks, 1 real", paypalRef: null });
  });

  it("adds the totals up from the same rows, and they agree with the job pages", async () => {
    const posterId = idOf("Kettle & Clove");
    const ledger = await getLedger(posterId);
    const mine = await getMyJobs(posterId);

    expect(ledger.jobCount).toBe(mine.length);
    expect(ledger.totals.lockedNowCents).toBe(mine.reduce((n, j) => n + j.money.heldCents, 0));
    expect(ledger.totals.paidCents).toBe(mine.reduce((n, j) => n + j.money.paidCents, 0));
    expect(ledger.totals.releasedCents).toBe(mine.reduce((n, j) => n + j.money.letGoCents, 0));
    expect(ledger.rows.reduce((n, row) => n + row.stillLockedCents, 0)).toBe(ledger.totals.lockedNowCents);
    expect(ledger.totals.blockedCount).toBe(ledger.rows.filter((row) => row.kind === "blocked").length);
    expect(ledger.totals.blockedCents).toBe(28);
  });

  it("is newest first", async () => {
    const { rows } = await getLedger(idOf("Loom & Thread"));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((row) => row.when)).toEqual([...rows.map((row) => row.when)].sort().reverse());
  });

  it("never includes another business's money", async () => {
    const posterId = idOf("Loom & Thread");
    const ownJobIds = new Set((await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.posterId, posterId))).map((j) => j.id));
    const { rows } = await getLedger(posterId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => ownJobIds.has(row.jobId))).toBe(true);
    expect(rows.some((row) => row.paypalRef === "SAMPLE-HOLD-KETTLE-VIEWS")).toBe(false);
  });

  it("is empty for a worker who posted nothing, and for an unknown person", async () => {
    expect(await getLedger(idOf("aarav.clips"))).toMatchObject({ rows: [], jobCount: 0 });
    expect((await getLedger("per_nobody")).rows).toEqual([]);
  });
});

describe("what a blocked result was stopped from being paid", () => {
  const card = (payRule: JobCard["payRule"], capCents: number) => ({ payRule, capCents }) as JobCard;

  it("counts the cheat clicks at the job's own rate, minus what was already paid", () => {
    const perClick = card({ kind: "per_unit", unit: "click", unitLabel: "clicks", centsPerBatch: 10, batchSize: 1 }, 5000);
    expect(stoppedCents(perClick, { clicksTotal: 300, clicksReal: 20 }, 5000, 200)).toBe(2800);
  });

  it("never goes above the job's budget or below zero", () => {
    const perClick = card({ kind: "per_unit", unit: "click", unitLabel: "clicks", centsPerBatch: 10, batchSize: 1 }, 5000);
    expect(stoppedCents(perClick, { clicksTotal: 5000, clicksReal: 1 }, 5000, 0)).toBe(5000);
    expect(stoppedCents(perClick, { clicksTotal: 5, clicksReal: 5 }, 5000, 900)).toBe(0);
  });

  it("is zero for pay that is not per unit", () => {
    expect(stoppedCents(card({ kind: "once", cents: 2000 }, 2000), { views: 9000 }, 2000, 0)).toBe(0);
  });
});
