/**
 * Small helpers for lane A's JSON addresses: who is asking (the dibs_person
 * cookie), reading the request, and answering { ok, ... } or { ok: false, message }.
 */
import { MoneyRefusal } from "./refusal";

/** The same name as PERSON_COOKIE in src/contract (not imported from there, to keep this file free of the database). */
const PERSON_COOKIE = "dibs_person";

/** The id in the caller's dibs_person cookie, or null. */
export function callerId(request: Request): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === PERSON_COOKIE) return decodeURIComponent(part.slice(at + 1).trim()) || null;
  }
  return null;
}

/** The request's JSON as an object ({} when it is not JSON). */
export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json().catch(() => null);
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export const yes = (data: Record<string, unknown> = {}) => Response.json({ ok: true, ...data });
export const no = (message: string, status = 400) => Response.json({ ok: false, message }, { status });

/**
 * Turns a thrown error into an answer. A plain "no" keeps its own sentence;
 * anything else gets a fixed sentence, so nothing internal reaches the page.
 */
export function failed(error: unknown, what: string): Response {
  if (error instanceof MoneyRefusal) return no(error.message, 400);
  console.error(`${what}:`, error instanceof Error ? error.message : error);
  return no("PayPal could not do that just now. Nothing was changed. Please try again.", 502);
}