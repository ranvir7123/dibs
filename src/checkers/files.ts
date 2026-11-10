/**
 * Keeps files workers upload (recordings, translations) in a folder on this
 * machine, and finds them again for the checker.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { claims } from "@/db/schema";

/** The folder uploads are kept in. Tests use a throwaway folder. */
function baseDir(): string {
  if (process.env.DIBS_DATA_DIR?.trim().startsWith("memory://")) return path.join(tmpdir(), "dibs-test-hand-ins");
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".data", "hand-ins");
}

const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/mp4",
};
const TEXT_TYPES = new Set([".txt", ".md", ".csv", ".json", ".html", ".srt"]);

/** What kind of file a hand-in is, from its ending. */
export function fileKind(file: string): { kind: "video"; mimeType: string } | { kind: "text" } | { kind: "other" } {
  const ext = path.extname(file).toLowerCase();
  if (VIDEO_TYPES[ext]) return { kind: "video", mimeType: VIDEO_TYPES[ext] };
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
