import { describe, expect, it } from "vitest";
import { handInAddress } from "./handin";

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
