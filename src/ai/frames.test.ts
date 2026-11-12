import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clockLabel, ffmpegPath, RecordingUnreadable, spreadEvenly, withPictures } from "./frames";

/** Runs ffmpeg once. True when it ran and ended well. */
const ffmpeg = (program: string, args: string[]) => new Promise<boolean>((resolve) => execFile(program, args, { timeout: 30_000, windowsHide: true }, (error) => resolve(!error)));

// The cutting test needs ffmpeg on this machine. Without it, that one test is skipped.
const program = await ffmpegPath();
const hasFfmpeg = await ffmpeg(program, ["-version"]);

describe("cutting a recording into pictures", () => {
  it("writes each moment as MM:SS", () => {
    expect(clockLabel(0)).toBe("00:00");
    expect(clockLabel(75)).toBe("01:15");
    expect(clockLabel(599)).toBe("09:59");
  });

  it("keeps at most 90 pictures, spread evenly from the first to the last", () => {
    const seconds = Array.from({ length: 600 }, (_, i) => i);
    const kept = spreadEvenly(seconds, 90);
    expect(kept).toHaveLength(90);
    expect(kept[0]).toBe(0);
    expect(kept[89]).toBe(599);
    const gaps = kept.slice(1).map((s, i) => s - kept[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(spreadEvenly([1, 2, 3], 90)).toEqual([1, 2, 3]);
  });

  it.skipIf(!hasFfmpeg)("takes one picture per second, labels each with its time, and deletes them afterwards", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "dibs-frames-test-"));
    try {
      // A 3 second test pattern, made by ffmpeg itself. 1280 wide, to prove the pictures are made smaller.
      const video = path.join(folder, "three-seconds.mp4");
      expect(await ffmpeg(program, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=1280x720:rate=10", "-pix_fmt", "yuv420p", video])).toBe(true);

      let kept: string[] = [];
      const labels = await withPictures(video, async (pictures) => {
        kept = pictures.map((p) => p.path);
        for (const p of pictures) expect((await stat(p.path)).size).toBeGreaterThan(0);
        expect(pictures.every((p) => p.mimeType === "image/jpeg")).toBe(true);
        return pictures.map((p) => p.label);
      });
      expect(labels).toEqual(["Picture at 00:00", "Picture at 00:01", "Picture at 00:02"]);
      for (const file of kept) expect(await stat(file).catch(() => null)).toBeNull(); // deleted afterwards

      // A file that is not a video is refused in plain words, and nothing is left behind.
      const notVideo = path.join(folder, "not-a-video.mp4");
      await writeFile(notVideo, "this is not a video");
      await expect(withPictures(notVideo, async () => "never reached")).rejects.toBeInstanceOf(RecordingUnreadable);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
