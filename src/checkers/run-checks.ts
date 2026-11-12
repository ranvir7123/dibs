/**
 * Runs the checks for one claim's result: reads the numbers from their
 * source, runs the cheat tests, works out what was earned, and saves the
 * checks, one reading and the result. Moves no money and never writes the
 * status "paid" (lane A does that when money goes out).
 */
import { stat } from "node:fs/promises";
import { and, asc, desc, eq, gte, isNotNull, like, ne } from "drizzle-orm";
import { RecordingUnreadable } from "@/ai/frames";
import { AiCannotOpen, isAiTrouble, waitingOnAiNote } from "@/ai/trouble";
import { storedPageLinks, tidyAddress } from "@/contract/links";
import { formatCents } from "@/contract/money";
import type { Check, CheckGroup, CheckReport, Job, JobCard, Measured, ResultStatus } from "@/contract/types";
import { getDb } from "@/db/client";
import { newId } from "@/db/ids";
import { checks, claims, jobs, people, readings, results, trackedLinks } from "@/db/schema";
import { countSales } from "@/money";
import { settings } from "@/settings";
import { clicksLookReal, viewsLookReal } from "./cheat-tests";
import { countClicks, type ClickCounts } from "./clicks";
import { fileKind, handInPath, reachableHandIn } from "./files";
import { getPageReader } from "./pages";
import { earnedFor } from "./pay";
import { getVideoReader, NotAVideoLink, publicVideoUrl, videoIdFrom, type VideoStats } from "./video-site";
import { checkPages, giveOpinion, readHandIn, readTextFile, watchPromo, watchRecording, type FoundItem, type PageToCheck, type RuleSeen } from "./watch";

const DAY_MS = 86_400_000;

type Draft = Pick<Check, "key" | "group" | "label" | "passed" | "passedCount" | "totalCount" | "reason" | "headline" | "seenAtSeconds">;

const draft = (key: string, group: CheckGroup, label: string, passedCount: number, totalCount: number, reason: string, extra: { headline?: string | null; seenAtSeconds?: number | null } = {}): Draft => ({
  key,
  group,
  label,
  passed: passedCount === totalCount,
  passedCount,
  totalCount,
  reason,
  headline: extra.headline ?? null,
  seenAtSeconds: extra.seenAtSeconds ?? null,
});

const fromSaved = (c: Check): Draft => ({
  key: c.key,
  group: c.group,
  label: c.label,
  passed: c.passed,
  passedCount: c.passedCount,
  totalCount: c.totalCount,
  reason: c.reason,
  headline: c.headline,
  seenAtSeconds: c.seenAtSeconds,
});

/** One check that sums up several yes-or-no rules, such as "In the video 3/3". */
function groupedCheck(key: string, label: string, seen: RuleSeen[]): Draft {
  const missed = seen.filter((r) => !r.met);
  const reason = missed.length === 0 ? seen.map((r) => r.reason).join(" ") : missed.map((r) => `${r.label}: ${r.reason}`).join(" ");
  const firstSeen = seen.map((r) => r.seenAtSeconds).filter((s): s is number => s !== null);
  return draft(key, "must_show", label, seen.length - missed.length, seen.length, reason, {
    headline: missed.length ? `Missing: ${missed.map((r) => r.label).join(", ")}` : null,
    seenAtSeconds: firstSeen.length ? Math.min(...firstSeen) : null,
  });
}

const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(d);

/** A hand-in that cannot be checked as it is: the result waits and the worker is told why. */
class CannotCheck extends Error {}

/** The kinds of file AI can open, said the same way wherever a file is refused. */
const FILES_TAKEN = "a video (.mp4, .mov, .webm), a photo (.png, .jpg, .webp), a PDF (.pdf) or a plain text file (.txt, .md)";

/** The short title on a find that earned nothing, saying why. */
function refusalHeadline(item: FoundItem): string | null {
  if (item.verdict === "known") return item.matches ? `Already known: ${item.matches}` : "Already known";
  if (item.verdict === "already_paid") return "Already paid to another worker";
  if (item.verdict === "not_real") return "Not a real problem";
  return null;
}

interface Outcome {
  drafts: Draft[];
  measured: Measured;
  /** Set when the result must wait for a person or for the objection window. */
  waiting: boolean;
  /** For "once" pay: whether the finish line is met. */
  finishMet: boolean;
  /** Overrides the worked-out summary when set. */
  summary: string | null;
  objectionEndsAt: Date | null;
  /** Overrides the next check time when set (undefined = work it out). */
  nextCheckAt?: Date | null;
  /** Click numbers, when the job has a tracked link. */
  clicks: ClickCounts | null;
  /** When pay is not worked out this run (an opinion still open to objection). */
  holdPay: boolean;
  /** The views the video already had at hand-in. They are not paid for. */
  viewsAtHandIn: number;
}

export async function runChecksAt(claimId: string, now: Date = new Date()): Promise<CheckReport> {
  const db = await getDb();
  const claim = (await db.select().from(claims).where(eq(claims.id, claimId)))[0];
  if (!claim) throw new Error("No such claim.");
  const result = (await db.select().from(results).where(eq(results.claimId, claimId)))[0];
  if (!result) throw new Error("Nothing has been handed in for this claim yet, so there is nothing to check.");
  const job = (await db.select().from(jobs).where(eq(jobs.id, claim.jobId)))[0];
  const poster = (await db.select().from(people).where(eq(people.id, job.posterId)))[0];
  const link = (await db.select().from(trackedLinks).where(eq(trackedLinks.claimId, claimId)))[0] ?? null;
  const savedChecks = await db.select().from(checks).where(eq(checks.resultId, result.id)).orderBy(checks.position);

  const report = (status: ResultStatus, measured: Measured, list: Check[], earnedCents: number, summary: string): CheckReport => ({
    claimId,
    resultId: result.id,
    status,
    measured,
    checks: list,
    earnedCents,
    summary,
  });

  // The poster objected to an AI opinion: a person decides, and the checker leaves the result alone.
  if (result.objectedAt) return report(result.status, result.measured, savedChecks, result.earnedCents, result.summary ?? "");

  // A blocked result stays blocked until the worker hands in again. Otherwise a later,
  // calmer reading could quietly undo the block and pay for the faked numbers.
  if (result.status === "blocked" && result.lastCheckedAt && result.handedInAt.getTime() <= result.lastCheckedAt.getTime()) {
    return report(result.status, result.measured, savedChecks, result.earnedCents, result.summary ?? "");
  }

  const card: JobCard = job.card;
  const { evidence, cheatTests, mustShow } = card.checker;
  // AI's answers about a hand-in are kept until the worker hands in again, so a video is not watched every 10 minutes.
  const fresh = savedChecks.filter((c) => c.ranAt.getTime() >= result.handedInAt.getTime());
  const kept = (test: (c: Check) => boolean) => fresh.filter(test);

  const out: Outcome = { drafts: [], measured: {}, waiting: false, finishMet: false, summary: null, objectionEndsAt: null, clicks: null, holdPay: false, viewsAtHandIn: 0 };
  const isFile = result.handInKind === "file";
  const opensPages = result.handInKind === "link" && evidence.includes("live_site");
  let aiChecksAllPassed: boolean | null = null; // null = this job has no AI yes-or-no checks

  try {
    if (!card.checker.machineCheckable) {
      // ------------------------------------------------ AI's opinion, open to objection
      let opinion = kept((c) => c.group === "opinion" || c.group === "rule");
      if (opinion.length === 0) {
        const work = await handedInWork(claimId, result.handInKind, result.handInUrl, result.handInFile);
        const view = await giveOpinion({ work, card, posterName: poster.name, sentence: job.sentence });
        out.drafts.push(draft("opinion", "opinion", "AI's opinion", view.acceptable ? 1 : 0, 1, view.reason, { headline: view.acceptable ? null : "AI thinks this does not do the job" }));
        for (const r of view.rules) out.drafts.push(draft(`rule:${r.id}`, "rule", r.label, r.met ? 1 : 0, 1, r.reason));
        opinion = [];
      } else {
        out.drafts.push(...opinion.map(fromSaved));
      }
      const verdict = out.drafts.find((d) => d.key === "opinion")!;
      const ruleDrafts = out.drafts.filter((d) => d.group === "rule");
      if (ruleDrafts.length) {
        out.measured.rulesPassed = ruleDrafts.filter((d) => d.passed).length;
        out.measured.rulesTotal = ruleDrafts.length;
      }
      out.finishMet = verdict.passed;
      aiChecksAllPassed = verdict.passed;

      const windowIsNew = opinion.length === 0 || !result.objectionEndsAt;
      const endsAt = windowIsNew ? new Date(now.getTime() + settings.objectionWindowDays * DAY_MS) : result.objectionEndsAt!;
      // Kept after the window closes too, so a later run does not open a second window.
      out.objectionEndsAt = endsAt;
      if (now.getTime() < endsAt.getTime()) {
        out.waiting = true;
        out.holdPay = true;
        out.nextCheckAt = endsAt;
        out.summary = verdict.passed
          ? `AI thinks this does the job. The poster has ${settings.objectionWindowDays} days to object. Silence means it is paid.`
          : `AI thinks this does not do the job. The poster has ${settings.objectionWindowDays} days to object. Silence means the AI's answer stands.`;
      } else {
        out.nextCheckAt = null;
        out.summary = verdict.passed ? null : `The poster did not object in ${settings.objectionWindowDays} days, so the AI's answer stands: this does not do the job.`;
      }
    } else {
      // ------------------------------------------------ measured from sources
      let stats: VideoStats | null = null;
      // A job where Dibs opens each handed-in page itself has no video: its links are web pages.
      const isLink = result.handInKind === "link" && !opensPages;

      if (opensPages) {
        // The pages are opened and read by AI once per hand-in, not on every tick.
        const saved = kept((c) => c.group === "rule" || c.key === "in_pages" || c.key === "pages_opened");
        if (saved.length) out.drafts.push(...saved.map(fromSaved));
        else await checkLinks(out, { resultId: result.id, job, posterName: poster.name, links: storedPageLinks(result.handInUrl), now });
        const rules = out.drafts.filter((d) => d.group === "rule");
        if (card.payRule.kind === "per_rule") {
          out.measured.rulesPassed = rules.filter((d) => d.passed).length;
          out.measured.rulesTotal = rules.length;
        } else if (card.payRule.kind === "per_unit" && card.payRule.unit === "item") {
          out.measured.items = rules.filter((d) => d.passed).length;
        }
        const gate = out.drafts.filter((d) => d.group === "must_show" || d.group === "rule");
        if (gate.length) aiChecksAllPassed = gate.every((d) => d.passed);
      }

      if (isLink && (evidence.includes("public_page") || evidence.includes("ai_watch"))) {
        stats = await getVideoReader()(result.handInUrl ?? "");
        out.measured.views = stats.views;
        if (stats.likes !== null) out.measured.likes = stats.likes;
        if (stats.comments !== null) out.measured.comments = stats.comments;
        if (stats.seconds !== null) out.measured.mediaSeconds = stats.seconds;
      }

      // What the posted video must contain, watched by AI once per hand-in.
      if (isLink && mustShow.length > 0) {
        const saved = kept((c) => c.key === "in_video");
        if (saved.length) out.drafts.push(...saved.map(fromSaved));
        else {
          const id = videoIdFrom(result.handInUrl ?? "");
          if (!id) throw new NotAVideoLink();
          // The site's public address: set by hand, or (online) the one the host gives the site itself.
          const base = (process.env.DIBS_BASE_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim())?.replace(/\/$/, "");
          const seen = await watchPromo({ url: publicVideoUrl(id), card, posterName: poster.name, trackedLink: link ? `${base ?? ""}/r/${link.code}` : null });
          out.drafts.push(groupedCheck("in_video", "In the video", seen.rules));
          if (out.measured.mediaSeconds === undefined && seen.mediaSeconds !== null) out.measured.mediaSeconds = seen.mediaSeconds;
        }
        aiChecksAllPassed = out.drafts.every((d) => d.passed);
      }

      // An uploaded file: a recording or photo AI looks at, or a text file or PDF AI reads.
      if (isFile) {
        const aiKey = (c: Check) => c.group === "rule" || c.key === "in_recording" || c.key === "recording";
        const saved = kept(aiKey);
        if (saved.length) {
          out.drafts.push(...saved.map(fromSaved));
          if (result.measured.mediaSeconds !== undefined) out.measured.mediaSeconds = result.measured.mediaSeconds;
        } else {
          await checkFile(out, { claimId, resultId: result.id, job, posterName: poster.name, file: result.handInFile });
        }
        const rules = out.drafts.filter((d) => d.group === "rule");
        if (card.payRule.kind === "per_rule") {
          out.measured.rulesPassed = rules.filter((d) => d.passed).length;
          out.measured.rulesTotal = rules.length;
        } else if (card.payRule.kind === "per_unit" && card.payRule.unit === "item") {
          out.measured.items = rules.filter((d) => d.passed).length;
        }
        const gate = out.drafts.filter((d) => d.group === "must_show" || d.group === "rule");
        if (gate.length) aiChecksAllPassed = gate.every((d) => d.passed);
      }

      if (stats) {
        // Views the video already had when it was handed in are not paid for: only views since then count.
        const first = (
          await db
            .select()
            .from(readings)
            .where(and(eq(readings.resultId, result.id), gte(readings.at, result.handedInAt), isNotNull(readings.views)))
            .orderBy(asc(readings.at))
            .limit(1)
        )[0];
        out.viewsAtHandIn = first?.views ?? stats.views;
      }

      if (stats && evidence.includes("public_page") && (cheatTests.includes("view_jump") || cheatTests.includes("views_without_likes"))) {
        const last = (await db.select().from(readings).where(eq(readings.resultId, result.id)).orderBy(desc(readings.at)).limit(1))[0];
        const test = viewsLookReal({ views: stats.views, likes: stats.likes, previousViews: last?.views ?? null, tests: cheatTests });
        out.drafts.push(draft("views_real", "cheat", "Views look real", test.passed ? 1 : 0, 1, test.reason, { headline: test.headline }));
      }

      if (evidence.includes("paypal_sale")) {
        // Only sales the money side says count: paid, not refunded, and past the short wait
        // in which a buyer can still be refunded. Anything else would show as earned and never be paid.
        const tally = await countSales(claimId, now);
        const sold = tally.counted;
        out.measured.sales = sold;
        const orders = (n: number) => `${n} paid PayPal order${n === 1 ? "" : "s"}`;
        const notes = [
          sold === 0 ? "No sales count through this link yet." : `${orders(sold)} carr${sold === 1 ? "ies" : "y"} this worker's code.`,
          tally.waiting > 0 ? `${tally.waiting} more ${tally.waiting === 1 ? "is" : "are"} too new to count yet.` : "",
          tally.refunded > 0 ? `${tally.refunded} ${tally.refunded === 1 ? "was" : "were"} refunded and ${tally.refunded === 1 ? "does" : "do"} not count.` : "",
        ];
        out.drafts.push(draft("sales_real", "cheat", "Sales look real", 1, 1, notes.filter(Boolean).join(" ")));
      }

      if (link && (evidence.includes("tracked_link") || evidence.includes("paypal_sale"))) {
        const counts = await countClicks(link.code);
        out.clicks = counts;
        out.measured.clicksTotal = counts.clicksTotal;
        out.measured.clicksReal = counts.clicksReal;
        out.measured.visitors = counts.visitors;
        const test = clicksLookReal({ counts, views: stats?.views ?? null, tests: cheatTests });
        out.drafts.push(draft("clicks_real", "cheat", "Clicks look real", test.passed ? 1 : 0, 1, test.reason, { headline: test.headline }));
      }

      if (card.payRule.kind === "once") {
        const reached = card.target ? unitCount(card.target.unit, out.measured) >= card.target.count : null;
        if (reached !== null) out.finishMet = reached && aiChecksAllPassed !== false;
        else if (aiChecksAllPassed !== null) out.finishMet = aiChecksAllPassed;
        else {
          // One fixed amount with nothing the checker can test: it must not pay by itself.
          out.waiting = true;
          out.nextCheckAt = null;
          out.summary = "This job's finish line cannot be measured by Dibs yet, so a person has to decide.";
        }
      }
    }
  } catch (error) {
    if (!(error instanceof NotAVideoLink) && !(error instanceof CannotCheck) && !(error instanceof RecordingUnreadable) && !(error instanceof AiCannotOpen) && !isNotPublic(error)) {
      // The AI could not do its part (too busy, out of allowance, timed out). Nothing is
      // decided and nothing is saved except a plain note for the worker; the tick tries again.
      if (isAiTrouble(error) && (result.status === "checking" || result.status === "waiting")) {
        await db
          .update(results)
          .set({ summary: waitingOnAiNote(error), lastCheckedAt: now })
          .where(eq(results.id, result.id))
          .catch(() => {});
      }
      throw error;
    }
    // The hand-in itself is the problem. The worker is told, and can hand in again.
    const summary = (error as Error).message;
    const rows = await db
      .update(results)
      .set({ status: result.status === "paid" ? "paid" : "waiting", summary, lastCheckedAt: now, nextCheckAt: null })
      .where(eq(results.id, result.id))
      .returning();
    return report(rows[0].status, rows[0].measured, savedChecks, rows[0].earnedCents, summary);
  }

  // ------------------------------------------------ decide and save
  const failedGate = out.drafts.filter((d) => !d.passed && (d.group === "must_show" || d.group === "cheat"));
  const opinionRejected = !card.checker.machineCheckable && !out.holdPay && !out.finishMet;
  const blocked = failedGate.length > 0 || opinionRejected;
  const payable: Measured = out.measured.views === undefined ? out.measured : { ...out.measured, views: Math.max(0, out.measured.views - out.viewsAtHandIn) };
  const worked = blocked || out.holdPay ? 0 : earnedFor(card, payable, out.finishMet);
  const earned = Math.max(result.earnedCents, worked); // what was earned is never taken back

  const jobOver = job.status !== "open" || job.endsAt.getTime() <= now.getTime();
  const live = evidence.includes("public_page") || evidence.includes("tracked_link") || evidence.includes("paypal_sale");
  let nextCheckAt: Date | null;
  if (blocked || jobOver) nextCheckAt = null;
  else if (out.nextCheckAt !== undefined) nextCheckAt = out.nextCheckAt;
  else nextCheckAt = live ? new Date(now.getTime() + settings.checkEveryMinutes * 60_000) : null;

  const summary = out.summary ?? summarise(card, out, blocked, failedGate, earned);
  const footer = footerFor(isFile, out, failedGate);

  return db.transaction(async (tx) => {
    // Locks the result so a payment landing at the same moment is not overwritten.
    const locked = (await tx.select().from(results).where(eq(results.id, result.id)).for("update"))[0];
    if (locked.objectedAt) return report(locked.status, locked.measured, savedChecks, locked.earnedCents, locked.summary ?? "");
    const status: ResultStatus = blocked ? "blocked" : out.waiting ? (locked.status === "paid" ? "paid" : "waiting") : locked.status === "paid" ? "paid" : "checking";
    const earnedCents = Math.max(locked.earnedCents, earned);

    await tx.delete(checks).where(eq(checks.resultId, result.id));
    const rows = out.drafts.map((d, position) => ({ id: newId("chk"), resultId: result.id, ...d, position, ranAt: now }));
    const saved = rows.length ? await tx.insert(checks).values(rows).returning() : [];
    await tx.insert(readings).values({
      id: newId("rdg"),
      resultId: result.id,
      at: now,
      views: out.measured.views ?? null,
      likes: out.measured.likes ?? null,
      comments: out.measured.comments ?? null,
      clicksTotal: out.measured.clicksTotal ?? null,
      clicksReal: out.measured.clicksReal ?? null,
    });
    await tx
      .update(results)
      .set({
        status,
        measured: out.measured,
        earnedCents,
        summary,
        watchLabel: footer.label,
        watchNote: footer.note,
        watchOk: footer.ok,
        lastCheckedAt: now,
        nextCheckAt,
        objectionEndsAt: out.objectionEndsAt,
      })
      .where(eq(results.id, result.id));
    return report(status, out.measured, saved.sort((a, b) => a.position - b.position), earnedCents, summary);
  });
}

function isNotPublic(error: unknown): boolean {
  return error instanceof Error && /Only a public video can be checked/.test(error.message);
}

function unitCount(unit: "view" | "click" | "sale" | "item", m: Measured): number {
  return unit === "view" ? (m.views ?? 0) : unit === "click" ? (m.clicksReal ?? 0) : unit === "sale" ? (m.sales ?? 0) : (m.items ?? 0);
}

/** The handed-in work, ready for AI to give an opinion on. */
async function handedInWork(claimId: string, kind: string, url: string | null, file: string | null): Promise<Parameters<typeof giveOpinion>[0]["work"]> {
  if (kind === "link") {
    const id = videoIdFrom(url ?? "");
    if (!id) throw new CannotCheck("AI can only open a link to a public YouTube video. Please hand in the work as a file, or as a public video link.");
    return { kind: "video", video: { kind: "public_link", url: publicVideoUrl(id) } };
  }
  if (!file) throw new CannotCheck("Nothing was handed in for AI to look at.");
  ownFile(claimId, file);
  const type = fileKind(file);
  if (type.kind === "other") throw new CannotCheck(`AI cannot open this kind of file yet. Please hand in ${FILES_TAKEN}.`);
  if (type.kind === "text") return { kind: "text", text: await readTextFile(await reachable(file)).catch(asCannotCheck) };
  const full = await found(file, type.kind === "video" ? "recording" : type.kind === "image" ? "photo" : "file");
  if (type.kind === "video") return { kind: "video", video: { kind: "file", path: full, mimeType: type.mimeType } };
  if (type.kind === "image") return { kind: "photo", path: full, mimeType: type.mimeType };
  return { kind: "pdf", path: full };
}

/** A worker may only hand in a file that was uploaded for their own claim. */
function ownFile(claimId: string, file: string): void {
  if (!file.startsWith(`${claimId}/`) || file.includes("..")) throw new CannotCheck("That file was not uploaded for this job. Please upload your file again.");
}

/** The file's path on this machine, fetched from the site first when the tick runs somewhere else. */
async function reachable(file: string): Promise<string> {
  handInPath(file); // refuses a path outside the uploads folder before anything is fetched
  return reachableHandIn(file);
}

function asCannotCheck(error: unknown): never {
  throw new CannotCheck(error instanceof Error ? error.message : String(error));
}

/** The file's path on this machine, or a plain refusal when it is not there. */
async function found(file: string, word: "recording" | "photo" | "file"): Promise<string> {
  const full = await reachable(file);
  if (!(await stat(full).catch(() => null))) throw new CannotCheck(`The handed-in ${word} could not be found. Please upload it again.`);
  return full;
}

/**
 * Finds on this job that were already counted for OTHER workers, as short
 * descriptions. Each find is paid once, so the AI is told about them. A
 * blocked result earned nothing, so its finds are left out.
 */
async function findsAlreadyPaid(jobId: string, resultId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ label: checks.label, reason: checks.reason })
    .from(checks)
    .innerJoin(results, eq(checks.resultId, results.id))
    .where(and(eq(results.jobId, jobId), ne(results.id, resultId), ne(results.status, "blocked"), eq(checks.passed, true), like(checks.key, "item:%")))
    .orderBy(asc(checks.ranAt), asc(checks.position));
  return rows.map((row) => (row.reason ? `${row.label}: ${row.reason}` : row.label));
}

/**
 * The addresses of pages already counted for OTHER workers on this job, in
 * their tidy form. A page is paid once, and that is decided here by its
 * address, not by AI. Check "item:N" on a result belongs to its Nth link.
 */
async function pagesAlreadyPaid(jobId: string, resultId: string): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db
    .select({ key: checks.key, handInUrl: results.handInUrl })
    .from(checks)
    .innerJoin(results, eq(checks.resultId, results.id))
    .where(and(eq(results.jobId, jobId), ne(results.id, resultId), ne(results.status, "blocked"), eq(checks.passed, true), like(checks.key, "item:%")));
  const paid = new Set<string>();
  for (const row of rows) {
    const link = storedPageLinks(row.handInUrl)[Number(row.key.slice("item:".length)) - 1];
    if (link) paid.add(tidyAddress(link));
  }
  return paid;
}

/**
 * A handed-in file for a measured job. AI looks at a recording or a photo, or
 * reads a text file or a PDF, against the rules.
 */
async function checkFile(out: Outcome, input: { claimId: string; resultId: string; job: Job; posterName: string; file: string | null }): Promise<void> {
  const { claimId, job, posterName, file } = input;
  const card = job.card;
  if (!file) throw new CannotCheck("Nothing was handed in for AI to look at.");
  ownFile(claimId, file);
  const type = fileKind(file);
  if (type.kind === "other") throw new CannotCheck(`AI cannot open this kind of file yet. Please hand in ${FILES_TAKEN}.`);

  if (type.kind === "text" || type.kind === "pdf") {
    const work = type.kind === "pdf" ? ({ kind: "pdf", path: await found(file, "file") } as const) : ({ kind: "text", text: await readTextFile(await reachable(file)).catch(asCannotCheck) } as const);
    const read = await readHandIn({ work, card, posterName });
    if (read.mustShow.length) out.drafts.push(groupedCheck("in_recording", "In the file", read.mustShow));
    for (const r of read.rules) out.drafts.push(draft(`rule:${r.id}`, "rule", r.label, r.met ? 1 : 0, 1, r.reason));
    return;
  }

  const isPhoto = type.kind === "image";
  const word = isPhoto ? "photo" : "recording";
  const full = await found(file, word);
  const countsItems = card.payRule.kind === "per_unit" && card.payRule.unit === "item";
  const seen = await watchRecording({
    video: isPhoto ? { kind: "photo", path: full, mimeType: type.mimeType } : { kind: "file", path: full, mimeType: type.mimeType },
    card,
    posterName,
    sentence: job.sentence,
    alreadyPaid: countsItems ? await findsAlreadyPaid(job.id, input.resultId) : [],
  });
  if (seen.mediaSeconds !== null) out.measured.mediaSeconds = seen.mediaSeconds;
  if (seen.mustShow.length) out.drafts.push(groupedCheck("in_recording", `In the ${word}`, seen.mustShow));
  for (const r of seen.rules) out.drafts.push(draft(`rule:${r.id}`, "rule", r.label, r.met ? 1 : 0, 1, r.reason, { seenAtSeconds: r.seenAtSeconds }));
  // Each find is its own line. Only a new find counts towards pay; a refused one says why and blocks nothing.
  seen.items.forEach((item, i) =>
    out.drafts.push(draft(`item:${i + 1}`, "rule", item.label, item.verdict === "new" ? 1 : 0, 1, item.reason, { seenAtSeconds: item.seenAtSeconds, headline: refusalHeadline(item) })),
  );

  const parts = [seen.oneTake, seen.rightSubject].filter((p): p is { ok: boolean; reason: string } => p !== null);
  if (parts.length) {
    const bad = parts.filter((p) => !p.ok);
    out.drafts.push(
      draft("recording", "cheat", `The ${word} is real`, parts.length - bad.length, parts.length, (bad.length ? bad : parts).map((p) => p.reason).join(" "), {
        headline: bad.length ? `The ${word} did not pass` : null,
      }),
    );
  }
}

/** The short title on a handed-in page that earned nothing, saying why. */
function pageRefusalHeadline(item: FoundItem): string | null {
  return item.verdict === "not_real" ? "Does not match" : refusalHeadline(item);
}

/**
 * Links handed in for a job where Dibs opens each page itself. Every page is
 * fetched by Dibs, then AI compares its words with what the poster asked for.
 * A page that cannot be opened is refused by itself and does not stop the others.
 */
async function checkLinks(out: Outcome, input: { resultId: string; job: Job; posterName: string; links: string[]; now: Date }): Promise<void> {
  const { job, links, now } = input;
  const card = job.card;
  if (links.length === 0) throw new CannotCheck("No link was handed in. Please paste the links to the pages.");

  const read = await Promise.all(links.map((url) => getPageReader()(url).then((page) => ({ page }), (error: unknown) => ({ url, error: error instanceof Error ? error.message : "Dibs could not open this page." }))));
  const countsItems = card.payRule.kind === "per_unit" && card.payRule.unit === "item";
  const paidBefore = countsItems ? await pagesAlreadyPaid(job.id, input.resultId) : new Set<string>();
  const landed: string[] = [];
  const pages: PageToCheck[] = read.map((one) => {
    if ("error" in one) return one;
    // Two links that lead to the same page are one page, so only the first can count. Addresses are
    // compared in their tidy form, so "www.", capital letters, a "/" at the end or "?x=1" do not make a new page.
    const place = tidyAddress(one.page.finalUrl);
    const before = landed.indexOf(place);
    landed.push(place);
    if (before >= 0) return { url: one.page.url, error: `This link leads to the same page as link ${before + 1}, so it is counted once.` };
    if (paidBefore.has(place) || paidBefore.has(tidyAddress(one.page.url))) {
      return { url: one.page.url, error: "This page was already counted and paid for another worker on this job.", alreadyPaid: true };
    }
    return { url: one.page.url, title: one.page.title, text: one.page.text, cut: one.page.cut };
  });
  const opened = read.filter((one) => !("error" in one)).length;

  const seen = await checkPages({
    pages,
    card,
    posterName: input.posterName,
    sentence: job.sentence,
    alreadyPaid: countsItems ? await findsAlreadyPaid(job.id, input.resultId) : [],
  });
  if (seen.mustShow.length) out.drafts.push(groupedCheck("in_pages", "On the pages", seen.mustShow));
  for (const r of seen.rules) out.drafts.push(draft(`rule:${r.id}`, "rule", r.label, r.met ? 1 : 0, 1, r.reason));
  // Each page is its own line. Only a page that matches counts towards pay; a refused one says why and blocks nothing.
  seen.items.forEach((item, i) => out.drafts.push(draft(`item:${i + 1}`, "rule", item.label, item.verdict === "new" ? 1 : 0, 1, item.reason, { headline: pageRefusalHeadline(item) })));
  out.drafts.push(
    draft("pages_opened", "cheat", "Dibs opened the pages itself", opened > 0 ? 1 : 0, 1, `Opened ${opened} of ${links.length} page${links.length === 1 ? "" : "s"} at ${clock(now)}. No screenshots were used.`, {
      headline: opened > 0 ? null : "No page could be opened",
    }),
  );
}

function summarise(card: JobCard, out: Outcome, blocked: boolean, failed: Draft[], earned: number): string {
  if (blocked) {
    const why = failed[0]?.headline ?? failed[0]?.label ?? "A check failed";
    return earned > 0 ? `Blocked: ${why}. Nothing more will be paid. The held money was not touched.` : `Blocked: ${why}. ${formatCents(0)} paid. The held money was not touched.`;
  }
  if (card.payRule.kind === "per_rule" && out.measured.rulesTotal) {
    return `${out.measured.rulesPassed} of ${out.measured.rulesTotal} rules passed, so ${formatCents(earned)} was earned without anyone approving it.`;
  }
  if (card.payRule.kind === "per_unit" && card.payRule.unit === "item") {
    const finds = out.drafts.filter((d) => d.key.startsWith("item:"));
    const counted = finds.filter((d) => d.passed).length;
    // A job where Dibs opens the pages itself counts pages; the others count finds.
    const word = out.drafts.some((d) => d.key === "pages_opened") ? "page" : "find";
    if (finds.length && counted === 0) {
      return earned > 0
        ? `None of the ${word}s in this hand-in counted. The ${formatCents(earned)} earned before stays earned.`
        : `None of the ${word}s counted, so nothing was earned. The held money was not touched.`;
    }
    if (finds.length) return `${counted} of ${finds.length} ${word}${finds.length === 1 ? "" : "s"} counted. ${formatCents(earned)} earned, with nobody approving it.`;
  }
  if (earned > 0) return `Everything passed. ${formatCents(earned)} earned so far, with nobody approving it.`;
  return "The checks passed. Nothing has been earned yet.";
}

function footerFor(isFile: boolean, out: Outcome, failed: Draft[]): { label: string | null; note: string | null; ok: boolean | null } {
  const pagesOpened = out.drafts.find((d) => d.key === "pages_opened");
  if (pagesOpened) return { label: pagesOpened.label, note: pagesOpened.reason, ok: pagesOpened.passed };
  if (isFile) {
    const recording = out.drafts.find((d) => d.key === "recording");
    if (!recording) return { label: null, note: null, ok: null };
    return { label: recording.label.includes("photo") ? "Photo check" : "Recording check", note: recording.reason, ok: recording.passed };
  }
  const cheats = out.drafts.filter((d) => d.group === "cheat");
  if (cheats.length === 0) return { label: null, note: null, ok: null };
  const bad = failed.find((d) => d.group === "cheat");
  if (!bad) return { label: "Live cheat check", note: "In the normal range", ok: true };
  if (bad.key === "clicks_real" && out.clicks?.burst) {
    return { label: "Live cheat check", note: `Fake clicks found at ${clock(out.clicks.burst.startedAt)} and left out of the count`, ok: false };
  }
  return { label: "Live cheat check", note: bad.headline ?? bad.reason, ok: false };
}
