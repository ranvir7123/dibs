import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clockLabel, ffmpegPath, fileFamily, FRAMES, RecordingUnreadable, spreadEvenly, withPictures, withSendablePhoto } from "./frames";
import { AiTrouble } from "./trouble";

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

describe("files that are not what their name says", () => {
  afterEach(() => vi.unstubAllEnvs());

  /** Makes a folder for one test, runs it, and deletes the folder afterwards. */
  async function inFolder(run: (folder: string) => Promise<void>): Promise<void> {
    const folder = await mkdtemp(path.join(tmpdir(), "dibs-frames-test-"));
    try {
      await run(folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /**
   * Points the code at an ffmpeg that does not exist. If the code tried to
   * start ffmpeg, it would fail with "ffmpeg was not found" (an AiTrouble).
   * So a RecordingUnreadable error proves ffmpeg was never started.
   */
  function trapFfmpeg(folder: string): void {
    vi.stubEnv("FFMPEG_PATH", path.join(folder, "no-such-ffmpeg.exe"));
  }

  /** The first bytes of a real MP4 file, followed by nothing useful. */
  const MP4_START = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(52)]);
  /** The first bytes of a real PNG file. */
  const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  /** Plain text that makes a file big enough for the photo path to want to shrink it. */
  const bigText = () => Buffer.alloc(FRAMES.bigPhotoBytes + 1, "a");

  it("tells each kind of file from its first bytes", () => {
    const withWord = (word: string) => Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from(word)]);
    for (const word of ["ftyp", "moov", "mdat", "free", "wide", "skip"]) expect(fileFamily(withWord(word))).toBe("mp4");
    expect(fileFamily(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))).toBe("matroska");
    expect(fileFamily(Buffer.from("RIFF\0\0\0\0AVI LIST"))).toBe("avi");
    expect(fileFamily(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(fileFamily(PNG_START)).toBe("png");
    expect(fileFamily(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(fileFamily(Buffer.from("#EXTM3U\n"))).toBeNull();
    expect(fileFamily(Buffer.from("ffconcat version 1.0\n"))).toBeNull();
    expect(fileFamily(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(fileFamily(Buffer.alloc(0))).toBeNull();
  });

  it("the trap works: a file that looks like a video does reach ffmpeg, which is not there", () =>
    inFolder(async (folder) => {
      trapFfmpeg(folder);
      const looksReal = path.join(folder, "looks-real.mp4");
      await writeFile(looksReal, MP4_START);
      await expect(withPictures(looksReal, async () => "never reached")).rejects.toBeInstanceOf(AiTrouble);
    }));

  it("refuses a text playlist saved as .mp4 before ffmpeg is started", () =>
    inFolder(async (folder) => {
      trapFfmpeg(folder);
      const playlist = path.join(folder, "playlist.mp4");
      await writeFile(playlist, "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10.0,\nhttp://127.0.0.1:9/inside.ts\n#EXT-X-ENDLIST\n");
      const error = await withPictures(playlist, async () => "never reached").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RecordingUnreadable);
      expect((error as Error).message).toContain("This file is not a video that can be opened");
    }));

  it("refuses an ffmpeg list of other files saved as .mp4 before ffmpeg is started", () =>
    inFolder(async (folder) => {
      trapFfmpeg(folder);
      const list = path.join(folder, "list.mp4");
      await writeFile(list, "ffconcat version 1.0\nfile '/etc/passwd'");
      const error = await withPictures(list, async () => "never reached").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RecordingUnreadable);
      expect((error as Error).message).toContain("This file is not a video that can be opened");
    }));

  it("refuses a plain text file saved as .png in the photo path before ffmpeg is started", () =>
    inFolder(async (folder) => {
      trapFfmpeg(folder);
      const text = path.join(folder, "notes.png");
      await writeFile(text, bigText());
      const error = await withSendablePhoto({ path: text, mimeType: "image/png" }, async () => "never reached").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RecordingUnreadable);
      expect((error as Error).message).toContain("This file is not a photo that can be opened");
    }));

  it("refuses a file whose ending does not match what is inside it", () =>
    inFolder(async (folder) => {
      trapFfmpeg(folder);
      // A photo named like a video.
      const photoAsVideo = path.join(folder, "photo.mp4");
      await writeFile(photoAsVideo, PNG_START);
      await expect(withPictures(photoAsVideo, async () => "never reached")).rejects.toBeInstanceOf(RecordingUnreadable);
      // A video named like a photo.
      const videoAsPhoto = path.join(folder, "video.png");
      await writeFile(videoAsPhoto, Buffer.concat([MP4_START, bigText()]));
      await expect(withSendablePhoto({ path: videoAsPhoto, mimeType: "image/png" }, async () => "never reached")).rejects.toBeInstanceOf(RecordingUnreadable);
      // One kind of video named like another kind.
      const webmAsMp4 = path.join(folder, "really-webm.mp4");
      await writeFile(webmAsMp4, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]));
      const videoError = await withPictures(webmAsMp4, async () => "never reached").catch((caught: unknown) => caught);
      expect(videoError).toBeInstanceOf(RecordingUnreadable);
      expect((videoError as Error).message).toContain('name ends in ".mp4" but what is inside it is a different kind of file');
      // One kind of photo named like another kind.
      const jpegAsPng = path.join(folder, "really-jpeg.png");
      await writeFile(jpegAsPng, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), bigText()]));
      const photoError = await withSendablePhoto({ path: jpegAsPng, mimeType: "image/png" }, async () => "never reached").catch((caught: unknown) => caught);
      expect(photoError).toBeInstanceOf(RecordingUnreadable);
      expect((photoError as Error).message).toContain('name ends in ".png" but what is inside it is a different kind of file');
    }));

  it("leaves a small photo alone, as before", () =>
    inFolder(async (folder) => {
      trapFfmpeg(folder);
      const small = path.join(folder, "small.png");
      await writeFile(small, PNG_START);
      expect(await withSendablePhoto({ path: small, mimeType: "image/png" }, async (photo) => photo.path)).toBe(small);
    }));

  it.skipIf(!hasFfmpeg)(
    "still cuts real .mov, .webm, .mkv and .avi recordings",
    () =>
      inFolder(async (folder) => {
        const quiet = ["-hide_banner", "-loglevel", "error"];
        const source = path.join(folder, "source.mp4");
        expect(await ffmpeg(program, [...quiet, "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=5", "-pix_fmt", "yuv420p", source])).toBe(true);
        for (const ending of [".mov", ".webm", ".mkv", ".avi"]) {
          const video = path.join(folder, `two-seconds${ending}`);
          expect(await ffmpeg(program, [...quiet, "-i", source, video])).toBe(true);
          expect(await withPictures(video, async (pictures) => pictures.length)).toBe(2);
        }
      }),
    60_000,
  );

  it.skipIf(!hasFfmpeg)(
    "still shrinks a real big .png, .jpg and .webp photo",
    () =>
      inFolder(async (folder) => {
        // A 2000 x 1500 picture of random dots: random dots cannot be packed small, so the files come out big.
        const dots = path.join(folder, "dots.raw");
        await writeFile(dots, randomBytes(2000 * 1500 * 3));
        const fromDots = ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2000x1500", "-i", dots, "-frames:v", "1"];
        const photos = [
          { name: "big.png", mimeType: "image/png", how: [] as string[] },
          { name: "big.jpg", mimeType: "image/jpeg", how: ["-q:v", "1"] },
          { name: "big.webp", mimeType: "image/webp", how: ["-lossless", "1"] },
        ];
        for (const { name, mimeType, how } of photos) {
          const big = path.join(folder, name);
          expect(await ffmpeg(program, [...fromDots, ...how, big])).toBe(true);
          expect((await stat(big)).size).toBeGreaterThan(FRAMES.bigPhotoBytes);
          const shrunk = await withSendablePhoto({ path: big, mimeType }, async (photo) => ({ ...photo, size: (await stat(photo.path)).size }));
          expect(shrunk.mimeType).toBe("image/jpeg");
          expect(shrunk.path).not.toBe(big);
          expect(shrunk.size).toBeGreaterThan(0);
          expect(await stat(shrunk.path).catch(() => null)).toBeNull(); // the smaller copy is deleted afterwards
        }
      }),
    60_000,
  );
});
