import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AiKeyMissing, aiStatus, getAi, useAi, type Ai } from "./index";

const KEYS = ["ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY"] as const;
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  useAi(null);
  for (const k of KEYS) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

describe("the AI door", () => {
  it("can be swapped for a stand-in", async () => {
    const standIn: Ai = { text: async () => ({ ok: true }) as never, watch: async () => ({ ok: true }) as never };
    useAi(standIn);
    expect(getAi()).toBe(standIn);
    useAi(null);
    expect(getAi()).not.toBe(standIn);
  });

  it("says plainly which key is missing, and never pretends to answer", async () => {
    for (const k of KEYS) delete process.env[k];
    expect(aiStatus()).toEqual({ text: null, watch: null });
    const schema = z.object({ a: z.string() });
    await expect(getAi().text({ system: "s", prompt: "p", schema })).rejects.toThrow(/ANTHROPIC_API_KEY or GOOGLE_AI_API_KEY/);
    await expect(getAi().watch({ video: { kind: "public_link", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" }, prompt: "p", schema })).rejects.toBeInstanceOf(AiKeyMissing);
  });

  it("uses Claude for text when its key is there, and Gemini for watching", () => {
    process.env.ANTHROPIC_API_KEY = "x";
    process.env.GOOGLE_AI_API_KEY = "y";
    const status = aiStatus();
    expect(status.text).toMatch(/^Claude/);
    expect(status.watch).toMatch(/^Gemini/);
  });
});
