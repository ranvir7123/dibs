import { afterAll, describe, expect, it } from "vitest";
import { closeDb, describeDb, getDb } from "./client";
import * as schema from "./schema";

afterAll(closeDb);

describe("the database", () => {
  it("opens in memory for tests, never in the real folder", async () => {
    await getDb();
    expect(await describeDb()).toBe("embedded Postgres in memory");
  });

  it("starts with all ten tables, empty", async () => {
    const db = await getDb();
    const tables = [
      schema.people,
      schema.jobs,
      schema.claims,
      schema.results,
      schema.checks,
      schema.readings,
      schema.moneyMoves,
      schema.trackedLinks,
      schema.clicks,
      schema.sales,
    ];
    for (const table of tables) {
      expect(await db.select().from(table)).toEqual([]);
    }
  });

  it("gives the same database to every caller", async () => {
    expect(await getDb()).toBe(await getDb());
  });

  it("refuses money that is not whole cents", async () => {
    const db = await getDb();
    await db.insert(schema.people).values({ id: "per_t", name: "Tester", paypalEmail: "t@example.com" });
    const job = {
      id: "job_t",
      posterId: "per_t",
      sentence: "s",
      title: "t",
      category: "other" as const,
      card: {} as never,
      endsAt: new Date(),
    };
    await expect(db.insert(schema.jobs).values({ ...job, budgetCents: 12.5 })).rejects.toThrow();
    await expect(db.insert(schema.jobs).values({ ...job, budgetCents: 0 })).rejects.toThrow();
    await db.insert(schema.jobs).values({ ...job, budgetCents: 1250 });
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
  });
});
