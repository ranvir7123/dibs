/**
 * Cuts a recording into still pictures, one per second, so an AI that looks
 * at pictures can check it. Also shrinks a photo that is too big to send.
 *
 * The cutting is done by ffmpeg, a free program for working with video. It is
 * found in this order: the path in FFMPEG_PATH, then the copy that comes with
 * the "ffmpeg-static" package, then plain "ffmpeg" on this machine.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LIMITS } from "./models";
import { AiTrouble } from "./trouble";

/** How a recording is cut. Engineering limits, not product numbers. */
export const FRAMES = {
  /** Only this much of the start of a recording is looked at: 10 minutes. */
  maxSeconds: 600,
  /** The most pictures sent to the AI for one recording. */
  maxPictures: 90,
  /** Pictures are made no wider than this, in pixels. */
  maxWidth: 1024,
  /** How long ffmpeg may take, so cutting plus the AI's answer fit inside the time for one video. */
  cutMs: LIMITS.watchTotalMs - LIMITS.watchTryMs,
  /** A photo bigger than this is made smaller before it is sent to the AI. */
  bigPhotoBytes: 3_500_000,
  /** A shrunk photo is no wider than this, in pixels. */
  photoWidth: 1568,
} as const;

/** One picture taken from a recording. */
export interface Frame {
  path: string;
  mimeType: "image/jpeg";
  /** The moment it was taken, in whole seconds from the start. */
  seconds: number;
  /** The same moment as MM:SS, for example "Picture at 00:12". */
  label: string;
}

/** The recording itself is the problem (not a video, damaged, or empty). The message is safe to show the worker. */
export class RecordingUnreadable extends Error {
  constructor(message = "This recording could not be opened. Please hand in a normal video file (.mp4, .mov, .webm).") {
    super(message);
    this.name = "RecordingUnreadable";
  }
}

/** Where ffmpeg is on this machine. */
export async function ffmpegPath(): Promise<string> {
  const set = process.env.FFMPEG_PATH?.trim();
  if (set) return set;
  try {
    const packaged = (await import("ffmpeg-static")).default as string | null;
    if (packaged && (await stat(packaged).catch(() => null))) return packaged;
  } catch {
    // The package is not installed here: fall through to the machine's own ffmpeg.
  }
  return "ffmpeg";
}

/** Runs ffmpeg with a list of arguments (never a shell sentence) and a time limit. */
async function runFfmpeg(args: string[]): Promise<void> {
  const program = await ffmpegPath();
  await new Promise<void>((resolve, reject) => {
    execFile(program, args, { timeout: FRAMES.cutMs, windowsHide: true, maxBuffer: 4_000_000 }, (error) => {
      if (!error) return resolve();
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reject(new AiTrouble("The program that cuts a recording into pictures (ffmpeg) was not found on this site. It will be tried again."));
      if (error.killed) return reject(new AiTrouble("The recording took too long to get ready for AI to look at. It will be tried again."));
      reject(new RecordingUnreadable());
    });
  });
}

/** 75 to "01:15". */
export function clockLabel(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Keeps at most `max` things from a list, spread evenly from the first to the last. */
export function spreadEvenly<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  if (max <= 1) return list.slice(0, Math.max(0, max));
  const picked = new Set<number>();
  for (let i = 0; i < max; i++) picked.add(Math.round((i * (list.length - 1)) / (max - 1)));
  return list.filter((_, index) => picked.has(index));
}

/**
 * Cuts a recording into pictures, hands them to `handle`, and deletes them
 * afterwards whatever happens. One picture per second, from the first 10
 * minutes; when there are more than 90, 90 spread evenly are kept.
 */
export async function withPictures<T>(videoPath: string, handle: (pictures: Frame[]) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(path.join(tmpdir(), "dibs-pictures-"));
  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-t",
      String(FRAMES.maxSeconds),
      "-i",
      videoPath,
      "-vf",
      `fps=1,scale='min(${FRAMES.maxWidth},iw)':-2`,
      "-q:v",
      "4",
      path.join(folder, "%05d.jpg"),
    ]);
    // ffmpeg names them 00001.jpg, 00002.jpg and so on: number N was taken at second N - 1.
    const names = (await readdir(folder)).filter((name) => /^\d+\.jpg$/.test(name)).sort();
    if (names.length === 0) throw new RecordingUnreadable("This recording has no pictures in it that can be looked at. Please hand in a normal video file (.mp4, .mov, .webm).");
    const all: Frame[] = names.map((name) => {
      const seconds = Number.parseInt(name, 10) - 1;
      return { path: path.join(folder, name), mimeType: "image/jpeg", seconds, label: `Picture at ${clockLabel(seconds)}` };
    });
    return await handle(spreadEvenly(all, FRAMES.maxPictures));
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Hands a photo to `handle`. A photo that is too big for the AI to take is first
 * made smaller (a copy; the handed-in file is never changed), and the copy is
 * deleted afterwards.
 */
export async function withSendablePhoto<T>(photo: { path: string; mimeType: string }, handle: (photo: { path: string; mimeType: string }) => Promise<T>): Promise<T> {
  const info = await stat(photo.path).catch(() => null);
  if (!info || info.size <= FRAMES.bigPhotoBytes) return handle(photo);
  const folder = await mkdtemp(path.join(tmpdir(), "dibs-photo-"));
  try {
    const smaller = path.join(folder, "photo.jpg");
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-nostdin", "-i", photo.path, "-vf", `scale='min(${FRAMES.photoWidth},iw)':-2`, "-frames:v", "1", "-q:v", "3", smaller]);
    return await handle({ path: smaller, mimeType: "image/jpeg" });
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}
