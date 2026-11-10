/**
 * The working parts of the filming reset (scripts/demo-reset.ts).
 *
 * Everything is written through the Start lane's own functions: seed() for the
 * sample board and joinDibs() for the people in the video. No table is edited
 * by hand here. The jobs in the video are NOT made here: they are posted on
 * camera, because locking money needs a person to approve it on PayPal's page.
 */
import { count, eq } from "drizzle-orm";
import { formatCents } from "../src/contract/money";
import { dbKind, getDb, migrateDb } from "../src/db/client";
import { getBoard, getMyJobs, getMyWork } from "../src/db/read";
import { people } from "../src/db/schema";
import { assertSeedAllowed, seed } from "../src/db/seed";
import { joinDibs } from "../src/db/write";
import { cast, type CastMember } from "./demo-cast";

type Env = Record<string, string | undefined>;

export interface DemoOptions {
  /** Where the PayPal test emails are read from. The real command passes process.env. */
  env: Env;
  /** A practice run: nobody needs a PayPal test email, and nobody can be paid. */
  practice?: boolean;
}

export interface DemoState {
  /** The jobs on the board, newest first, with their money as shown on screen. */
  jobs: { title: string; poster: string; locked: string; paid: string; held: string }[];
  /** The people in the video. */
  cast: {
    role: string;
    name: string;
    /** The person's id on Dibs, or null when they are not in the database. */
    id: string | null;
    /** True when their email came from a PayPal test account, so PayPal can pay them. */
    payable: boolean;
    jobsPosted: number;
    claims: number;
  }[];
  /** Everyone in the database: the sample people plus the cast. */
  peopleCount: number;
}

const practiceEmail = (member: CastMember) => `${member.role.replace(/\s+/g, ".")}.practice@example.com`;
const fromEnv = (member: CastMember, env: Env) => env[member.emailFrom]?.trim().toLowerCase() || null;

/**
 * The email each person in the video joins with. Stops with a plain sentence
 * when a PayPal test email is missing or two people would share one.
 */
export function castEmails(options: DemoOptions): { member: CastMember; email: string; payable: boolean }[] {
  const missing: string[] = [];
  const list = cast.map((member) => {
    if (options.practice) return { member, email: practiceEmail(member), payable: false };
    const real = fromEnv(member, options.env);
    if (real) return { member, email: real, payable: true };
    if (member.spareEmail) return { member, email: member.spareEmail, payable: false };
    missing.push(member.emailFrom);
    return { member, email: "", payable: false };
  });
  if (missing.length > 0) {
    throw new Error(
      `These PayPal test emails are missing from .env.local: ${missing.join(", ")}. ` +
        "Add them (PayPal's developer page lists the pretend accounts), or add --practice to rehearse with people who cannot be paid.",
    );
  }
  const seen = new Map<string, string>();
  for (const { member, email } of list) {
    const other = seen.get(email);
    if (other) {
      throw new Error(`"${other}" and "${member.role}" have the same email. Dibs keeps one person per email, so each needs their own PayPal test account.`);
    }
    seen.set(email, member.role);
  }
  return list;
}

/** Reads the filming state back from the database. Changes nothing. */
export async function readDemoState(options: DemoOptions): Promise<DemoState> {
  const db = await getDb();
  const board = await getBoard();
  const peopleCount = (await db.select({ n: count() }).from(people))[0].n;

  const state: DemoState = {
    jobs: board.jobs.map(({ job, poster, money }) => ({
      title: job.title,
      poster: poster.name,
      locked: formatCents(money.lockedCents),
      paid: formatCents(money.paidCents),
      held: formatCents(money.heldCents),
    })),
    cast: [],
    peopleCount,
  };

  for (const member of cast) {
    // Look for the person under each email they could have joined with.
    const real = fromEnv(member, options.env);
    const candidates = [real, member.spareEmail ?? null, practiceEmail(member)].filter((email): email is string => email !== null);
    let found: { id: string; name: string; email: string } | null = null;
    for (const email of candidates) {
      const row = (await db.select().from(people).where(eq(people.paypalEmail, email)))[0];
      if (row) {
        found = { id: row.id, name: row.name, email };
        break;
      }
    }
    state.cast.push({
      role: member.role,
      name: found?.name ?? member.name,
      id: found?.id ?? null,
      payable: found !== null && found.email === real,
      jobsPosted: found ? (await getMyJobs(found.id)).length : 0,
      claims: found ? ((await getMyWork(found.id))?.items.length ?? 0) : 0,
    });
  }
  return state;
}

/**
 * Puts the database into the starting state for filming: the sample board
 * (six pretend jobs, as a backdrop) and the people in the video, who have
 * posted nothing and taken nothing yet. Everything else in the database is
 * wiped. Safe to run again and again.
 */
export async function resetForFilming(options: DemoOptions): Promise<DemoState> {
  const joining = castEmails(options); // stop before wiping anything if an email is missing
  const db = await getDb();
  assertSeedAllowed(await dbKind());
  await migrateDb();
  await seed(db);
  for (const { member, email } of joining) {
    await joinDibs({ name: member.name, paypalEmail: email });
  }
  return readDemoState(options);
}
