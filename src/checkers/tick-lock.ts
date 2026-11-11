/**
 * Makes sure only one tick works at a time, even when two programs start one
 * at the same moment (the timer's own run, the site's /api/tick address, a
 * poster pressing "End this job").
 *
 * - Inside one program: a simple "busy" mark.
 * - Across programs sharing a hosted database: a lock the database itself
 *   hands out (a Postgres "advisory lock": a named lock that only one
 *   connection can hold). It is held by one open connection for as long as
 *   the tick works, and the database lets it go by itself if that program dies.
 * - The built-in laptop database can only be open in one program anyway.
 */
import { sql } from "drizzle-orm";
import { dbKind, getDb } from "@/db/client";

/** The lock's number in the database. Any fixed number works; this one spells nothing and is used nowhere else. */
const TICK_LOCK = 4_207_713;

const holder = globalThis as unknown as { __dibsTickRunning?: boolean };

/** True while a tick is working in this program. */
export const tickBusyHere = () => holder.__dibsTickRunning === true;

/**
 * Runs the work if no other tick is running anywhere. Returns ran: false,
 * having done nothing, when another one holds the lock.
 */
export async function withTickLock<T>(work: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  if (holder.__dibsTickRunning) return { ran: false };
  holder.__dibsTickRunning = true;
  try {
    if ((await dbKind()) !== "hosted") return { ran: true, value: await work() };

    const db = await getDb();
    // The lock lives exactly as long as this one open connection's transaction.
    // The work itself uses the database's other connections.
    return await db.transaction(async (tx) => {
      const answer = await tx.execute(sql`select pg_try_advisory_xact_lock(${TICK_LOCK}) as got`);
      const rows = (answer as unknown as { rows: Array<{ got: boolean }> }).rows;
      if (!rows[0]?.got) return { ran: false as const };
      return { ran: true as const, value: await work() };
    });
  } finally {
    holder.__dibsTickRunning = false;
  }
}
