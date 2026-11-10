/**
 * Small helpers that turn numbers, dates and names into the words on screen.
 * Plain functions with no database access, so they are safe in the browser too.
 * Money is never formatted here: use formatCents from "@/contract/money".
 */
import type { JobCategory, ProofStrength } from "@/contract/types";

/**
 * The clock every date and time on screen is written in. Pages are drawn on
 * the server, which does not know where the reader is, so one zone is used
 * for everyone. India, because that is where Dibs is being shown.
 */
export const DISPLAY_TIME_ZONE = "Asia/Kolkata";

/** "aarav.clips" becomes "Aarav", "Kettle & Clove" becomes "Kettle". For "$12.40 sent to Aarav". */
export function firstName(name: string): string {
  const first = name.trim().split(/[\s._\-@]+/)[0] ?? "";
  if (!first) return "them";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** The letter inside the round picture. */
export function initial(name: string): string {
  const letter = name.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

/** A moment in a recording: 134 becomes "02:14". Null means the checker never saw it. */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "Not seen";
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** Short numbers for the chart's side labels: 8000 becomes "8K". */
export function compact(value: number): string {
  const short = (n: number) => String(Math.round(n * 10) / 10);
  if (value >= 1_000_000) return `${short(value / 1_000_000)}M`;
  if (value >= 1000) return `${short(value / 1000)}K`;
  return short(value);
}

/** A count with commas: 6200 becomes "6,200". */
export function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** "1 rule", "4 rules", "1,200 views". */
export function plural(value: number, word: string, many: string = `${word}s`): string {
  return `${count(value)} ${value === 1 ? word : many}`;
}

/** How much of the money bar is green, in percent with one decimal. Never divides by zero. */
export function paidShare(paidCents: number, lockedCents: number): number {
  if (lockedCents <= 0) return 0;
  const share = (paidCents / lockedCents) * 100;
  return Math.min(100, Math.max(0, Math.round(share * 10) / 10));
}

/** Whole days from now until a moment, never below 0. */
export function daysUntil(end: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((end.getTime() - now.getTime()) / 86_400_000));
}

export function daysLeftLabel(daysLeft: number): string {
  return daysLeft <= 0 ? "Ends today" : `${daysLeft}D left`;
}

/** "2 minutes ago". */
export function ago(then: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.max(1, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

const dayMonthFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: DISPLAY_TIME_ZONE });
const longDayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: DISPLAY_TIME_ZONE });
const hourFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true, timeZone: DISPLAY_TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: DISPLAY_TIME_ZONE });

/** "10 Nov" */
export function dayMonth(date: Date): string {
  return dayMonthFormat.format(date);
}

/** "24 November" */
export function longDay(date: Date): string {
  return longDayFormat.format(date);
}

/** "10 AM" */
export function hourOfDay(date: Date): string {
  return hourFormat.format(date);
}

/** "18:15" */
export function timeOfDay(date: Date): string {
  return timeFormat.format(date);
}

export type Tone = "a1" | "a2" | "a3" | "a4";
const TONES: Tone[] = ["a1", "a2", "a3", "a4"];

/**
 * The colour of a person's round picture, always the same for the same name.
 * The three numbers were searched for so the people in the approved drawing
 * get the colours they have there.
 */
export function tone(name: string): Tone {
  let hash = 2;
  for (const letter of name) {
    hash = Math.imul(hash ^ letter.charCodeAt(0), 383) >>> 0;
  }
  return TONES[(hash >>> 15) % 4];
}

const CATEGORY_LABELS: Record<JobCategory, string> = {
  promotion: "Promotion",
  testing: "Testing",
  sales: "Sales",
  writing: "Writing",
  design: "Design",
  other: "Anything else",
};

/** The board tabs, in the drawing's order. */
export const CATEGORIES: JobCategory[] = ["promotion", "testing", "sales", "writing", "design", "other"];

export function categoryLabel(category: JobCategory): string {
  return CATEGORY_LABELS[category];
}

export function isCategory(value: string | undefined): value is JobCategory {
  return value !== undefined && (CATEGORIES as string[]).includes(value);
}

const PROOF_WORDS: Record<ProofStrength, string> = { strong: "strong", medium: "medium", weak: "weak" };

/** "Proof: medium" uses the small word; the job card uses it with a capital. */
export function proofWord(strength: ProofStrength, capital = false): string {
  const word = PROOF_WORDS[strength];
  return capital ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}
