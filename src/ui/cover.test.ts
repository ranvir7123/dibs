import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coverFor } from "./cover";

describe("coverFor", () => {
  it("gives a YouTube video its own picture", () => {
    const want = { src: "https://img.youtube.com/vi/jNQXAC9IVRw/hqdefault.jpg", from: "youtube" };
    expect(coverFor("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toEqual(want);
    expect(coverFor("https://youtu.be/jNQXAC9IVRw?t=5")).toEqual(want);
    expect(coverFor("  https://www.youtube.com/shorts/jNQXAC9IVRw ")).toEqual(want);
  });

  it("gives each made-up sample video a photo that is really in the project", () => {
    const seen = new Set<string>();
    for (const name of ["aarav", "meera", "kabir", "isha"]) {
      const cover = coverFor(`https://video.example.com/watch/${name}-kettle-launch`);
      expect(cover?.from).toBe("sample");
      expect(cover?.src).toMatch(/^\/demo\/thumbs\/[a-z-]+\.jpg$/);
      expect(existsSync(join(process.cwd(), "public", cover!.src))).toBe(true);
      seen.add(cover!.src);
    }
    expect(seen.size).toBe(4);
  });

  it("gives nothing for a link it does not know, or no link", () => {
    expect(coverFor(null)).toBeNull();
    expect(coverFor(undefined)).toBeNull();
    expect(coverFor("")).toBeNull();
    expect(coverFor("not a link")).toBeNull();
    expect(coverFor("https://video.example.com/watch/someone-else")).toBeNull();
    expect(coverFor("https://evil.example/youtube.com/watch?v=jNQXAC9IVRw")).toBeNull();
    expect(coverFor("https://www.youtube.com/watch?v=short")).toBeNull();
  });
});
