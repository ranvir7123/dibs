import type { Db } from "./client";
import * as schema from "./schema";
import { buildSeed, type SeedRows } from "./seed-data";

/** Rows per insert. Keeps each statement well under Postgres's limit on values in one statement. */
const CHUNK = 1000;

/** Stops the sample data wiping a hosted database by accident. Set DIBS_ALLOW_SEED=1 to mean it. */
export function assertSeedAllowed(kind: "embedded" | "hosted", env: Record<string, string | undefined> = process.env): void {
  if (kind === "hosted" && env.DIBS_ALLOW_SEED !== "1") {
    throw new Error(
      "Loading the sample data empties every table, and DATABASE_URL points at a hosted database. " +
        "If you really mean it, set DIBS_ALLOW_SEED=1 for this one command.",
    );
  }
}

/**
 * Empties every table, then loads the sample data. Safe to run again and
 * again: the result is always the same rows. It wipes real data too, so it is
 * for laptops and demos only.
 */
export async function seed(db: Db, now: Date = new Date()): Promise<SeedRows> {
  const rows = buildSeed(now);

  await db.transaction(async (tx) => {
    // Children first, so nothing is left pointing at a deleted row.
    await tx.delete(schema.sales);
    await tx.delete(schema.clicks);
    await tx.delete(schema.trackedLinks);
    await tx.delete(schema.moneyMoves);
    await tx.delete(schema.readings);
    await tx.delete(schema.checks);
    await tx.delete(schema.results);
    await tx.delete(schema.claims);
    await tx.delete(schema.jobs);
    await tx.delete(schema.people);

    // Parents first.
    await tx.insert(schema.people).values(rows.people);
    await tx.insert(schema.jobs).values(rows.jobs);
    await tx.insert(schema.claims).values(rows.claims);
    await tx.insert(schema.results).values(rows.results);
    await tx.insert(schema.checks).values(rows.checks);
    await tx.insert(schema.readings).values(rows.readings);
    await tx.insert(schema.moneyMoves).values(rows.moneyMoves);
    await tx.insert(schema.trackedLinks).values(rows.trackedLinks);
    for (let i = 0; i < rows.clicks.length; i += CHUNK) {
      await tx.insert(schema.clicks).values(rows.clicks.slice(i, i + CHUNK));
    }
    await tx.insert(schema.sales).values(rows.sales);
  });

  return rows;
}
