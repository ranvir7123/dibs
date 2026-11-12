/** The biggest file the hand-in screen takes: 500 MB. A 4 minute screen recording is usually well under 100 MB. */
export const MAX_HAND_IN_BYTES = 500_000_000;

/** The biggest photo or PDF the hand-in screen takes: 20 MB. Bigger ones are more than the AI can open. */
export const MAX_PHOTO_OR_PDF_BYTES = 20_000_000;

/** The file endings the checker can open. Kept the same as src/checkers/files.ts (a test checks they agree). */
const VIDEO_ENDINGS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];
const PHOTO_ENDINGS = [".png", ".jpg", ".jpeg", ".webp"];
const TEXT_ENDINGS = [".txt", ".md", ".csv", ".json", ".html", ".srt"];

/** For the file chooser, so it offers the kinds of file the checker can open. */
export const HAND_IN_ENDINGS = [...VIDEO_ENDINGS, ...PHOTO_ENDINGS, ".pdf", ...TEXT_ENDINGS].join(",");

/** What a handed-in file is, from its ending: something to play, a picture to show, a PDF, plain text, or none of these. */
export function handInLooks(file: string | null): "video" | "photo" | "pdf" | "text" | "other" {
  const ending = /\.[A-Za-z0-9]+$/.exec(file ?? "")?.[0].toLowerCase() ?? "";
  if (VIDEO_ENDINGS.includes(ending)) return "video";
  if (PHOTO_ENDINGS.includes(ending)) return "photo";
  if (ending === ".pdf") return "pdf";
  if (TEXT_ENDINGS.includes(ending)) return "text";
  return "other";
}

/** The biggest a file with this name may be: 20 MB for a photo or a PDF, 500 MB for anything else. */
export function maxBytesFor(fileName: string): number {
  const looks = handInLooks(fileName);
  return looks === "photo" || looks === "pdf" ? MAX_PHOTO_OR_PDF_BYTES : MAX_HAND_IN_BYTES;
}

/**
 * The address a handed-in link or file can be opened at, or null when it has
 * none. A link is its own address. A file the worker uploaded is kept as
 * "<claim id>/<file name>" and is served from /hand-ins/. Anything else (the
 * sample data's pretend files) cannot be opened.
 */
export function handInAddress(where: string | null): string | null {
  if (!where) return null;
  if (/^https?:\/\//i.test(where)) return where;
  return /^clm_[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(where) ? `/hand-ins/${where}` : null;
}
