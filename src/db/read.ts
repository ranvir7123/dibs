/**
 * The reads the screens draw from. Built by the Start lane; any lane may call
 * them. Paid and held money is always added up from the money moves here,
 * never stored a second time.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type {
  Board,
  BoardJob,
  Check,
  CountedUnit,
  Job,
  JobCategory,
  JobMoney,
  JobPage,
  Measured,
  MoneyMove,
  MyWork,
  MyWorkItem,
  Person,
  Reading,
  Result,
  ResultCard,
  TrackedLink,
} from "../contract/types";
import { getDb, type Db } from "./client";
import { checks, claims, jobs, moneyMoves, people, readings, results, trackedLinks } from "./schema";

const DAY_MS = 86_400_000;

/** Whole days from now until a moment, never below 0. */
export function daysLeftUntil(endsAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / DAY_MS));
}

/** Adds up a job's money from its money moves. Only moves PayPal confirmed ("done") count. */
export function addUpJobMoney(moves: MoneyMove[]): JobMoney {
  const sum = (kind: MoneyMove["kind"]) =>
    moves.filter((m) => m.kind === kind && m.status === "done").reduce((total, m) => total + m.amountCents, 0);
  const lockedCents = sum("hold");
  const paidCents = sum("take");
  const letGoCents = sum("let_go");
  return { lockedCents, paidCents, letGoCents, heldCents: lockedCents - paidCents - letGoCents };
}

const MEASURE_FOR_UNIT: Record<CountedUnit, keyof Measured> = {
  view: "views",
  click: "clicksReal",
  sale: "sales",
  item: "items",
};

function groupBy<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

async function peopleById(db: Db, ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.select().from(people).where(inArray(people.id, unique));
  return new Map(rows.map((p) => [p.id, p]));
}

/** Builds the result cards for a set of results, with their checks, readings, payouts and links. */
async function buildCards(db: Db, rows: Result[]): Promise<ResultCard[]> {
  if (rows.length === 0) return [];
  const resultIds = rows.map((r) => r.id);
  const claimIds = rows.map((r) => r.claimId);

  const [checkRows, readingRows, payoutRows, linkRows, workers] = await Promise.all([
    db.select().from(checks).where(inArray(checks.resultId, resultIds)).orderBy(asc(checks.position), asc(checks.id)),
    db.select().from(readings).where(inArray(readings.resultId, resultIds)).orderBy(asc(readings.at), asc(readings.id)),
    db
      .select()
      .from(moneyMoves)
      .where(and(inArray(moneyMoves.resultId, resultIds), eq(moneyMoves.kind, "payout"), eq(moneyMoves.status, "done")))
      .orderBy(asc(moneyMoves.createdAt)),
    db.select().from(trackedLinks).where(inArray(trackedLinks.claimId, claimIds)),
    peopleById(
      db,
      rows.map((r) => r.workerId),
    ),
  ]);

  const checksFor = groupBy<Check>(checkRows, (c) => c.resultId);
  const readingsFor = groupBy<Reading>(readingRows, (r) => r.resultId);
  const payoutsFor = groupBy<MoneyMove>(payoutRows, (m) => m.resultId);
  const linkFor = new Map<string, TrackedLink>(linkRows.map((l) => [l.claimId, l]));

  return rows.map((result) => {
    const itsChecks = checksFor.get(result.id) ?? [];
    const itsPayouts = payoutsFor.get(result.id) ?? [];
    return {
      result,
      worker: workers.get(result.workerId)!,
      checks: itsChecks,
      readings: readingsFor.get(result.id) ?? [],
      checksPassed: itsChecks.reduce((n, c) => n + c.passedCount, 0),
      checksTotal: itsChecks.reduce((n, c) => n + c.totalCount, 0),
      paidCents: itsPayouts.reduce((n, m) => n + m.amountCents, 0),
      lastPayout: itsPayouts.at(-1) ?? null,
      link: linkFor.get(result.claimId) ?? null,
    };
  });
}

/** What has reached a person's PayPal across every job. */
async function earnedBy(db: Db, personId: string): Promise<{ earnedCents: number; payouts: MoneyMove[] }> {
  const payouts = await db
    .select()
    .from(moneyMoves)
    .where(and(eq(moneyMoves.personId, personId), eq(moneyMoves.kind, "payout"), eq(moneyMoves.status, "done")))
    .orderBy(desc(moneyMoves.createdAt));
  return { payouts, earnedCents: payouts.reduce((n, m) => n + m.amountCents, 0) };
}

/** One person, or null when the id is unknown. */
export async function getPerson(personId: string): Promise<Person | null> {
  const db = await getDb();
  const rows = await db.select().from(people).where(eq(people.id, personId));
  return rows[0] ?? null;
}

/** Everyone who has joined Dibs, newest first. For the "who are you" screen, so a person who has done nothing yet can still be picked. */
export async function getPeople(): Promise<Person[]> {
  const db = await getDb();
  return db.select().from(people).orderBy(desc(people.createdAt), asc(people.id));
}

/** A job's money: locked, paid, still held, let go. All zero for an unknown or draft job. */
export async function getJobMoney(jobId: string): Promise<JobMoney> {
  const db = await getDb();
  return addUpJobMoney(await db.select().from(moneyMoves).where(eq(moneyMoves.jobId, jobId)));
}

/**
 * The board: every open job, newest first, with its money. Pass the id of the
 * person looking (from the dibs_person cookie) to fill in what they have earned.
 */
export async function getBoard(viewerId?: string | null): Promise<Board> {
  const db = await getDb();
  const now = new Date();
  const openJobs: Job[] = await db.select().from(jobs).where(eq(jobs.status, "open")).orderBy(desc(jobs.createdAt));

  const jobIds = openJobs.map((j) => j.id);
  const [moves, posters] = await Promise.all([
    jobIds.length ? db.select().from(moneyMoves).where(inArray(moneyMoves.jobId, jobIds)) : Promise.resolve([]),
    peopleById(
      db,
      openJobs.map((j) => j.posterId),
    ),
  ]);
  const movesFor = groupBy<MoneyMove>(moves, (m) => m.jobId);

  const boardJobs: BoardJob[] = openJobs.map((job) => ({
    job,
    poster: posters.get(job.posterId)!,
    money: addUpJobMoney(movesFor.get(job.id) ?? []),
    daysLeft: daysLeftUntil(job.endsAt, now),
  }));

  const categoryCounts: Record<JobCategory | "all", number> = {
    all: openJobs.length,
    promotion: 0,
    testing: 0,
    sales: 0,
    writing: 0,
    design: 0,
    other: 0,
  };
  for (const job of openJobs) categoryCounts[job.category] += 1;

  const viewer = viewerId ? await getPerson(viewerId) : null;
  const viewerEarnedCents = viewer ? (await earnedBy(db, viewer.id)).earnedCents : 0;

  return { jobs: boardJobs, categoryCounts, viewer, viewerEarnedCents };
}

/** Every job a person has posted, newest first: drafts, open and ended. Empty for an unknown person. */
export async function getMyJobs(posterId: string): Promise<BoardJob[]> {
  const db = await getDb();
  const now = new Date();
  const rows: Job[] = await db.select().from(jobs).where(eq(jobs.posterId, posterId)).orderBy(desc(jobs.createdAt));
  if (rows.length === 0) return [];
  const poster = (await getPerson(posterId))!;
  const moves = await db
    .select()
    .from(moneyMoves)
    .where(
      inArray(
        moneyMoves.jobId,
        rows.map((j) => j.id),
      ),
    );
  const movesFor = groupBy<MoneyMove>(moves, (m) => m.jobId);
  return rows.map((job) => ({
    job,
    poster,
    money: addUpJobMoney(movesFor.get(job.id) ?? []),
    daysLeft: daysLeftUntil(job.endsAt, now),
  }));
}

/** Everything for one job's page, or null when the job id is unknown. Works for drafts too. */
export async function getJobPage(jobId: string): Promise<JobPage | null> {
  const db = await getDb();
  const job: Job | undefined = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0];
  if (!job) return null;

  const [poster, openClaims, moves, resultRows] = await Promise.all([
    getPerson(job.posterId),
    db
      .select()
      .from(claims)
      .where(and(eq(claims.jobId, jobId), eq(claims.status, "open"))),
    db.select().from(moneyMoves).where(eq(moneyMoves.jobId, jobId)),
    db.select().from(results).where(eq(results.jobId, jobId)).orderBy(asc(results.handedInAt)),
  ]);
  const cards = await buildCards(db, resultRows);

  const counts = { all: cards.length, paid: 0, checking: 0, blocked: 0, waiting: 0 };
  for (const card of cards) counts[card.result.status] += 1;

  const target = job.card.target;
  const progress = target
    ? {
        unit: target.unit,
        target: target.count,
        // Blocked results do not count towards the finish line.
        count: cards
          .filter((c) => c.result.status !== "blocked")
          .reduce((n, c) => n + (c.result.measured[MEASURE_FOR_UNIT[target.unit]] ?? 0), 0),
      }
    : null;

  const readTimes = resultRows.flatMap((r) => (r.lastCheckedAt ? [r.lastCheckedAt.getTime()] : []));

  return {
    job,
    poster: poster!,
    money: addUpJobMoney(moves),
    daysLeft: daysLeftUntil(job.endsAt),
    progress,
    results: cards,
    counts,
    notHandedIn: openClaims.length,
    lastReadAt: readTimes.length ? new Date(Math.max(...readTimes)) : null,
  };
}

/** A worker's own page: their jobs, each result with its reasons, and their payouts. Null when the person is unknown. */
export async function getMyWork(personId: string): Promise<MyWork | null> {
  const db = await getDb();
  const person = await getPerson(personId);
  if (!person) return null;

  const claimRows = await db.select().from(claims).where(eq(claims.workerId, personId)).orderBy(desc(claims.createdAt));
  const { earnedCents, payouts } = await earnedBy(db, personId);
  if (claimRows.length === 0) return { person, earnedCents, items: [], payouts };

  const claimIds = claimRows.map((c) => c.id);
  const jobIds = [...new Set(claimRows.map((c) => c.jobId))];
  const [jobRows, resultRows, linkRows] = await Promise.all([
    db.select().from(jobs).where(inArray(jobs.id, jobIds)),
    db.select().from(results).where(inArray(results.claimId, claimIds)),
    db.select().from(trackedLinks).where(inArray(trackedLinks.claimId, claimIds)),
  ]);
  const posters = await peopleById(
    db,
    jobRows.map((j) => j.posterId),
  );
  const cards = await buildCards(db, resultRows);

  const jobFor = new Map<string, Job>(jobRows.map((j) => [j.id, j]));
  const cardFor = new Map(cards.map((c) => [c.result.claimId, c]));
  const linkFor = new Map(linkRows.map((l) => [l.claimId, l]));

  const items: MyWorkItem[] = claimRows.map((claim) => {
    const job = jobFor.get(claim.jobId)!;
    return {
      claim,
      job,
      poster: posters.get(job.posterId)!,
      link: linkFor.get(claim.id) ?? null,
      card: cardFor.get(claim.id) ?? null,
    };
  });

  return { person, earnedCents, items, payouts };
}
