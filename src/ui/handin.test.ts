import { describe, expect, it } from "vitest";
import { fileKind } from "@/checkers/files";
import { HAND_IN_ENDINGS, MAX_HAND_IN_BYTES, MAX_PHOTO_OR_PDF_BYTES, handInAddress, handInLooks, maxBytesFor } from "./handin";

describe("what kind of file a hand-in is", () => {
  it("knows photos and PDFs by their ending, whatever the capitals", () => {
    expect(fileKind("clm_a/1-bug.png")).toEqual({ kind: "image", mimeType: "image/png" });
    expect(fileKind("clm_a/1-bug.JPG")).toEqual({ kind: "image", mimeType: "image/jpeg" });
    expect(fileKind("clm_a/1-bug.jpeg")).toEqual({ kind: "image", mimeType: "image/jpeg" });
    expect(fileKind("clm_a/1-shop.webp")).toEqual({ kind: "image", mimeType: "image/webp" });
    expect(fileKind("clm_a/1-report.pdf")).toEqual({ kind: "pdf" });
    expect(fileKind("clm_a/1-run.mp4")).toEqual({ kind: "video", mimeType: "video/mp4" });
    expect(fileKind("clm_a/1-notes.txt")).toEqual({ kind: "text" });
    expect(fileKind("clm_a/1-notes.zip")).toEqual({ kind: "other" });
    expect(fileKind("clm_a/1-drawing.svg")).toEqual({ kind: "other" });
  });

  it("says the same on the screen side as the checker does, for every ending the file chooser offers", () => {
    const same = { video: "video", image: "photo", pdf: "pdf", text: "text", other: "other" } as const;
    for (const ending of [...HAND_IN_ENDINGS.split(","), ".zip", ".svg", ".gif", ""]) {
      expect([ending, handInLooks(`clm_a/1-file${ending}`)]).toEqual([ending, same[fileKind(`clm_a/1-file${ending}`).kind]]);
    }
    expect(HAND_IN_ENDINGS.split(",").every((ending) => fileKind(`x${ending}`).kind !== "other")).toBe(true);
    expect(handInLooks(null)).toBe("other");
  });

  it("takes a photo or a PDF up to 20 MB and a recording up to 500 MB", () => {
    expect(maxBytesFor("bug.PNG")).toBe(MAX_PHOTO_OR_PDF_BYTES);
    expect(maxBytesFor("report.pdf")).toBe(20_000_000);
    expect(maxBytesFor("run.mp4")).toBe(MAX_HAND_IN_BYTES);
    expect(maxBytesFor("notes.txt")).toBe(MAX_HAND_IN_BYTES);
  });
});

describe("where a hand-in can be opened", () => {
  it("opens a link as it is", () => {
    expect(handInAddress("https://www.youtube.com/watch?v=abc")).toBe("https://www.youtube.com/watch?v=abc");
  });
  it("opens an uploaded file from the hand-ins address", () => {
    expect(handInAddress("clm_abc123/1794354213147-stand-in.mp4")).toBe("/hand-ins/clm_abc123/1794354213147-stand-in.mp4");
  });
  it("has no address for the sample data's pretend files, or anything that climbs out of the folder", () => {
    expect(handInAddress("sample/zoya-level-test.mp4")).toBeNull();
    expect(handInAddress("clm_abc/../../.env.local")).toBeNull();
    expect(handInAddress("clm_abc/a/b.mp4")).toBeNull();
    expect(handInAddress(null)).toBeNull();
  });
});
