/**
 * Runs the checks for one claim's result: reads the numbers from their
 * source, runs the cheat tests, works out what was earned, and saves the
 * checks, one reading and the result. Moves no money and never writes the
 * status "paid" (lane A does that when money goes out).
 */
import { stat } from "node:fs/promises";
import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { formatCents } from "@/contract/money";
import type { Check, CheckGroup, CheckReport, JobCard, Measured, ResultStatus } from "@/contract/types";
import { getDb } from "@/db/client";
import { newId } from "@/db/ids";
import { checks, claims, jobs, people, readings, results, sales, trackedLinks } from "@/db/schema";
import { settings } from "@/settings";
import { clicksLookReal, viewsLookReal } from "./cheat-tests";
import { countClicks, type ClickCounts } from "./clicks";
import { fileKind, handInPath } from "./files";
import { earnedFor } from "./pay";
import { getVideoReader, NotAVideoLink, publicVideoUrl, videoIdFrom, type VideoStats } from "./video-site";
import { giveOpinion, readHandIn, readTextFile, watchPromo, watchRecording, type RuleSeen } from "./watch";

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
      const isLink = result.handInKind === "link";
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
          const base = process.env.DIBS_BASE_URL?.trim().replace(/\/$/, "");
          const seen = await watchPromo({ url: publicVideoUrl(id), card, posterName: poster.name, trackedLink: link ? `${base ?? ""}/r/${link.code}` : null });
          out.drafts.push(groupedCheck("in_video", "In the video", seen.rules));
          if (out.measured.mediaSeconds === undefined && seen.mediaSeconds !== null) out.measured.mediaSeconds = seen.mediaSeconds;
        }
        aiChecksAllPassed = out.drafts.every((d) => d.passed);
      }

      // An uploaded file: a recording AI watches, or a text file AI reads.
      if (isFile) {
        const aiKey = (c: Check) => c.group === "rule" || c.key === "in_recording" || c.key === "recording";
        const saved = kept(aiKey);
        if (saved.length) {
          out.drafts.push(...saved.map(fromSaved));
          if (result.measured.mediaSeconds !== undefined) out.measured.mediaSeconds = result.measured.mediaSeconds;
        } else {
          await checkFile(out, claimId, card, poster.name, result.handInFile);
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
        const sold = (await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(sales).where(eq(sales.claimId, claimId)))[0].n;
        out.measured.sales = sold;
        out.drafts.push(draft("sales_real", "cheat", "Sales look real", 1, 1, sold === 0 ? "No sales through this link yet." : `${sold} paid PayPal order${sold === 1 ? "" : "s"} carr${sold === 1 ? "ies" : "y"} this worker's code.`));
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
    if (!(error instanceof NotAVideoLink) && !(error instanceof CannotCheck) && !isNotPublic(error)) throw error;
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
  if (type.kind === "video") return { kind: "video", video: { kind: "file", path: handInPath(file), mimeType: type.mimeType } };
  if (type.kind === "text") return { kind: "text", text: await readTextFile(handInPath(file)).catch(asCannotCheck) };
  throw new CannotCheck("AI cannot open this kind of file yet. Please hand in a video (.mp4, .mov, .webm) or a plain text file (.txt, .md).");
}

/** A worker may only hand in a file that was uploaded for their own claim. */
function ownFile(claimId: string, file: string): void {
  if (!file.startsWith(`${claimId}/`) || file.includes("..")) throw new CannotCheck("That file was not uploaded for this job. Please upload your file again.");
}

function asCannotCheck(error: unknown): never {
  throw new CannotCheck(error instanceof Error ? error.message : String(error));
}

/** A handed-in file for a measured job: AI watches a recording, or reads a text file, against the rules. */
async function checkFile(out: Outcome, claimId: string, card: JobCard, posterName: string, file: string | null): Promise<void> {
  if (!file) throw new CannotCheck("Nothing was handed in for AI to look at.");
  ownFile(claimId, file);
  const type = fileKind(file);
  if (type.kind === "other") throw new CannotCheck("AI cannot open this kind of file yet. Please hand in a video (.mp4, .mov, .webm) or a plain text file (.txt, .md).");
  const full = handInPath(file);

  if (type.kind === "text") {
    const read = await readHandIn({ text: await readTextFile(full).catch(asCannotCheck), card, posterName });
    if (read.mustShow.length) out.drafts.push(groupedCheck("in_recording", "In the file", read.mustShow));
    for (const r of read.rules) out.drafts.push(draft(`rule:${r.id}`, "rule", r.label, r.met ? 1 : 0, 1, r.reason));
    return;
  }

  if (!(await stat(full).catch(() => null))) throw new CannotCheck("The handed-in recording could not be found. Please upload it again.");
  const seen = await watchRecording({ video: { kind: "file", path: full, mimeType: type.mimeType }, card, posterName });
  if (seen.mediaSeconds !== null) out.measured.mediaSeconds = seen.mediaSeconds;
  if (seen.mustShow.length) out.drafts.push(groupedCheck("in_recording", "In the recording", seen.mustShow));
  for (const r of seen.rules) out.drafts.push(draft(`rule:${r.id}`, "rule", r.label, r.met ? 1 : 0, 1, r.reason, { seenAtSeconds: r.seenAtSeconds }));
  seen.items.forEach((item, i) => out.drafts.push(draft(`item:${i + 1}`, "rule", item.label, 1, 1, item.reason, { seenAtSeconds: item.seenAtSeconds })));

  const parts = [seen.oneTake, seen.rightSubject].filter((p): p is { ok: boolean; reason: string } => p !== null);
  if (parts.length) {
    const bad = parts.filter((p) => !p.ok);
    out.drafts.push(
      draft("recording", "cheat", "The recording is real", parts.length - bad.length, parts.length, (bad.length ? bad : parts).map((p) => p.reason).join(" "), {
        headline: bad.length ? "The recording did not pass" : null,
      }),
    );
  }
}

function summarise(card: JobCard, out: Outcome, blocked: boolean, failed: Draft[], earned: number): string {
  if (blocked) {
    const why = failed[0]?.headline ?? failed[0]?.label ?? "A check failed";
    return earned > 0 ? `Blocked: ${why}. Nothing more will be paid. The held money was not touched.` : `Blocked: ${why}. ${formatCents(0)} paid. The held money was not touched.`;
  }
  if (card.payRule.kind === "per_rule" && out.measured.rulesTotal) {
    return `${out.measured.rulesPassed} of ${out.measured.rulesTotal} rules passed, so ${formatCents(earned)} was earned without anyone approving it.`;
  }
  if (earned > 0) return `Everything passed. ${formatCents(earned)} earned so far, with nobody approving it.`;
  return "The checks passed. Nothing has been earned yet.";
}

function footerFor(isFile: boolean, out: Outcome, failed: Draft[]): { label: string | null; note: string | null; ok: boolean | null } {
  if (isFile) {
    const recording = out.drafts.find((d) => d.key === "recording");
    if (!recording) return { label: null, note: null, ok: null };
    return { label: "Recording check", note: recording.reason, ok: recording.passed };
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
