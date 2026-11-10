/**
 * Who is using this browser. There are no passwords: a cookie holds the
 * person's id. Server code only.
 */
import { cookies } from "next/headers";
import { getPerson, PERSON_COOKIE } from "@/contract";
import type { Person } from "@/contract/types";

/** People this browser has joined as, so the switcher can offer them again. Ids joined with commas. */
export const KNOWN_COOKIE = "dibs_known";

const YEAR = 60 * 60 * 24 * 365;
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: YEAR };

/** The person using this browser, or null when nobody has been chosen (or the chosen person no longer exists). */
export async function getViewer(): Promise<Person | null> {
  const id = (await cookies()).get(PERSON_COOKIE)?.value;
  if (!id) return null;
  return getPerson(id);
}

/** Ids this browser has joined as, newest first. */
export async function getKnownIds(): Promise<string[]> {
  const raw = (await cookies()).get(KNOWN_COOKIE)?.value ?? "";
  return raw.split(",").filter((id) => /^per_[A-Za-z0-9_]+$/.test(id));
}

/** Remembers who this browser is. Only works inside a server action or a route handler. */
export async function setViewer(personId: string, alsoRemember = false): Promise<void> {
  const jar = await cookies();
  jar.set(PERSON_COOKIE, personId, cookieOptions);
  if (alsoRemember) {
    const known = (await getKnownIds()).filter((id) => id !== personId);
    jar.set(KNOWN_COOKIE, [personId, ...known].slice(0, 20).join(","), cookieOptions);
  }
}

/** Only addresses inside Dibs are followed after choosing who you are. */
export function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || next.includes("\\")) return "/";
  // Browsers drop tabs and line breaks from an address, which could turn "/<tab>/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const parsed = new URL(next, "http://dibs.invalid");
    if (parsed.origin !== "http://dibs.invalid") return "/";
    return parsed.pathname + parsed.search;
  } catch {
    return "/";
  }
}
