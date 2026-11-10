/**
 * The one way to reach the database.
 *
 * - DATABASE_URL set: a hosted Postgres. Tables are created with
 *   "npm run db:migrate", not on the fly.
 * - DATABASE_URL empty: an embedded Postgres (PGlite) kept in a local folder,
 *   DIBS_DATA_DIR or .data/pglite. Tables are created on first use.
 *   Only ONE running program may open a folder at a time, so each lane sets
 *   its own DIBS_DATA_DIR. "memory://" keeps it in memory (used by tests).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** The database handle every query goes through. The same type for embedded and hosted. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

interface Opened {
  db: Db;
  close: () => Promise<void>;
  kind: "embedded" | "hosted";
  where: string;
}

// Kept on globalThis so the dev server's reloads reuse the open database
// instead of opening the same folder twice.
const holder = globalThis as unknown as { __dibsDb?: Promise<Opened> };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** Where the embedded database is kept, as an absolute folder path or "memory://". */
export function embeddedDataDir(): string {
  const dir = process.env.DIBS_DATA_DIR?.trim() || ".data/pglite";
  // The comment inside the call tells the build not to pack the whole project
  // just because this folder is chosen while the app runs.
  return dir.startsWith("memory://") ? "memory://" : path.resolve(/*turbopackIgnore: true*/ process.cwd(), dir);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // asks "is it there?" without stopping anything
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Marks the embedded database folder as in use by this program, with a small
 * file beside it holding this program's number. The embedded database does not
 * stop two programs opening one folder, and two writers would quietly ruin the
 * data, so this does. Returns the function that frees the folder again.
 */
function claimFolder(dir: string): () => void {
  mkdirSync(dir, { recursive: true });
  const lockFile = `${dir}.lock`;
  if (existsSync(lockFile)) {
    const owner = Number(readFileSync(lockFile, "utf8").trim());
    if (Number.isInteger(owner) && owner !== process.pid && isRunning(owner)) {
      throw new Error(
        `The database folder ${dir} is already open in another program (number ${owner}), ` +
          `most likely a running "npm run dev". Stop that program, or give this one its own ` +
          `folder by setting DIBS_DATA_DIR (for example .data/lane-a). If no such program is running, delete ${lockFile}.`,
      );
    }
    rmSync(lockFile, { force: true }); // left behind by a program that is gone
  }
  try {
    // "wx" fails if the file appeared in the meantime, so two programs starting together cannot both win.
    writeFileSync(lockFile, String(process.pid), { flag: "wx" });
  } catch {
    throw new Error(`The database folder ${dir} was opened by another program at the same moment. Try again, or set DIBS_DATA_DIR to your own folder.`);
  }
  const release = () => {
    try {
      if (readFileSync(lockFile, "utf8").trim() === String(process.pid)) rmSync(lockFile);
    } catch {
      // already gone
    }
  };
  process.once("exit", release);
  return release;
}

async function open(): Promise<Opened> {
  const url = process.env.DATABASE_URL?.trim();

  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url, max: 5 });
    // A dropped idle connection must not bring the whole app down.
    pool.on("error", (error) => console.error("Database connection problem:", error.message));
    return {
      db: drizzle(pool, { schema }) as unknown as Db,
      close: () => pool.end(),
      kind: "hosted",
      where: "hosted Postgres (DATABASE_URL)",
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = embeddedDataDir();
  const release = dir === "memory://" ? () => {} : claimFolder(dir);
  let client: InstanceType<typeof PGlite>;
  try {
    client = new PGlite(dir === "memory://" ? undefined : dir);
    await client.waitReady;
  } catch (error) {
    release();
    throw error;
  }
  const db = drizzle(client, { schema });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS });
  } catch (error) {
    await client.close().catch(() => {});
    release();
    throw error;
  }
  return {
    db: db as unknown as Db,
    close: async () => {
      await client.close();
      release();
    },
    kind: "embedded",
    where: dir === "memory://" ? "embedded Postgres in memory" : `embedded Postgres in ${dir}`,
  };
}

function opened(): Promise<Opened> {
  if (!holder.__dibsDb) {
    holder.__dibsDb = open().catch((error) => {
      holder.__dibsDb = undefined;
      throw error;
    });
  }
  return holder.__dibsDb;
}

/** The database, opened on first use and shared by everything in this program. */
export async function getDb(): Promise<Db> {
  return (await opened()).db;
}

/** A plain sentence saying which database is in use. Never includes the address or password. */
export async function describeDb(): Promise<string> {
  return (await opened()).where;
}

/** Which kind of database is in use. */
export async function dbKind(): Promise<"embedded" | "hosted"> {
  return (await opened()).kind;
}

/** Creates or updates the tables on a hosted Postgres. The embedded one does this by itself. */
export async function migrateDb(): Promise<void> {
  const o = await opened();
  if (o.kind === "hosted") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(o.db as never, { migrationsFolder: MIGRATIONS });
  }
}

/** Closes the database. Commands call this so they can finish; the web app never needs to. */
export async function closeDb(): Promise<void> {
  const pending = holder.__dibsDb;
  holder.__dibsDb = undefined;
  if (pending) await (await pending).close();
}
