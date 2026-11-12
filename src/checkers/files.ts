/**
 * Keeps files workers upload (recordings, photos, PDFs, translations) in a folder on this
 * machine, and finds them again for the checker.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { claims } from "@/db/schema";

/**
 * The folder uploads are kept in. Online it is set with DIBS_FILES_DIR to a
 * folder on the site's own disk that survives a new build. On a laptop it is
 * .data/hand-ins. Tests use a throwaway folder.
 */
function baseDir(): string {
  if (process.env.DIBS_DATA_DIR?.trim().startsWith("memory://")) return path.join(tmpdir(), "dibs-test-hand-ins");
  const set = process.env.DIBS_FILES_DIR?.trim();
  if (set) return path.resolve(/*turbopackIgnore: true*/ set);
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data", "hand-ins");
}

/**
 * Where a program that is NOT the site (the timer's tick, a background task)
 * can fetch uploaded files from: the site's address inside the host's own
 * network when DIBS_WEB_HOSTPORT is set, otherwise the site's public address.
 */
function filesAddress(): string | null {
  const inside = process.env.DIBS_WEB_HOSTPORT?.trim();
  if (inside) return `http://${inside}`;
  return process.env.DIBS_BASE_URL?.trim().replace(/\/+$/, "") || null;
}

/** How long fetching one uploaded file from the site may take. */
const FETCH_FILE_MS = 120_000;

/**
 * The full path of a handed-in file on THIS machine. The site keeps uploads on
 * its own disk; the tick may run on another machine, so when the file is not
 * here it is fetched from the site (the same address the result card plays it
 * from) into a temporary folder. Returns the usual path when there is nowhere
 * to fetch from, so the caller's "file not found" message still applies.
 */
export async function reachableHandIn(file: string, get: typeof fetch = fetch): Promise<string> {
  const local = handInPath(file);
  if (await stat(local).catch(() => null)) return local;
  const site = filesAddress();
  if (!site) return local;

  const copy = path.join(tmpdir(), "dibs-fetched-hand-ins", ...file.split("/"));
  if (await stat(copy).catch(() => null)) return copy;
  const address = `${site}/hand-ins/${file.split("/").map(encodeURIComponent).join("/")}`;
  let response: Response;
  try {
    response = await get(address, { signal: AbortSignal.timeout(FETCH_FILE_MS) });
  } catch {
    throw new Error("The handed-in file could not be fetched from the site just now. It will be tried again.");
  }
  if (response.status === 404) return local;
  if (!response.ok) throw new Error(`The handed-in file could not be fetched from the site (error ${response.status}). It will be tried again.`);
  await mkdir(path.dirname(copy), { recursive: true });
  await writeFile(copy, new Uint8Array(await response.arrayBuffer()));
  return copy;
}

const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/mp4",
};
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const TEXT_TYPES = new Set([".txt", ".md", ".csv", ".json", ".html", ".srt"]);

/** What kind of file a hand-in is, from its ending. mimeType is the file's kind in the words programs use, such as "image/png". */
export type FileKind = { kind: "video"; mimeType: string } | { kind: "image"; mimeType: string } | { kind: "pdf" } | { kind: "text" } | { kind: "other" };

export function fileKind(file: string): FileKind {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO_TYPES[ext]) return { kind: "video", mimeType: VIDEO_TYPES[ext] };
  if (IMAGE_TYPES[ext]) return { kind: "image", mimeType: IMAGE_TYPES[ext] };
  if (ext === ".pdf") return { kind: "pdf" };
  if (TEXT_TYPES.has(ext)) return { kind: "text" };
  return { kind: "other" };
}

/** The full path of a kept file. Refuses anything that points outside the uploads folder. */
export function handInPath(file: string): string {
  const base = baseDir();
  const full = path.resolve(base, file);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error("That file is not one that was handed in to Dibs.");
  return full;
}

export async function keepHandInFile(input: { claimId: string; fileName: string; bytes: Uint8Array }): Promise<string> {
  if (input.bytes.byteLength === 0) throw new Error("The file is empty. Please upload it again.");
  if (!/^[A-Za-z0-9_-]+$/.test(input.claimId)) throw new Error("No such claim. Call dibs on the job first.");
  const db = await getDb();
  const claim = (await db.select().from(claims).where(eq(claims.id, input.claimId)))[0];
  if (!claim) throw new Error("No such claim. Call dibs on the job first.");

  const ext = path.extname(input.fileName).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const stem = path.basename(input.fileName, path.extname(input.fileName)).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "file";
  const relative = `${input.claimId}/${Date.now()}-${stem}${ext}`;
  const full = handInPath(relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, input.bytes);
  return relative;
}
