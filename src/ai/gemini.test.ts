import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Google's client is replaced by a stand-in, so no real AI is called here.
// These tests cover what happens AROUND the AI: time limits, busy models,
// and plain-words errors. Real AI answers were checked by hand with the
// commands in src/checkers/cli.
const generateContent = vi.fn();
vi.mock("@google/genai", async (importActual) => {
  const actual = await importActual<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent: (args: unknown) => generateContent(args) };
      files = { upload: vi.fn(), get: vi.fn(), delete: vi.fn() };
    },
  };
});

import { ApiError } from "@google/genai";
import { geminiText, geminiWatch } from "./gemini";
import { MODELS } from "./models";

const schema = z.object({ greeting: z.string() });
const failWith = (make: () => Error) => async () => {
  throw make();
};
const busy = () => new ApiError({ status: 503, message: "This model is currently experiencing high demand." });
/** The error a call ends with, or null when it worked. */
const failure = (call: Promise<unknown>): Promise<Error | null> => call.then(
  () => null,
  (error) => error as Error,
);
const video = { kind: "public_link", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" } as const;
const before = process.env.GOOGLE_AI_API_KEY;

beforeAll(() => {
  process.env.GOOGLE_AI_API_KEY = "example-key-for-tests";
});
afterAll(() => {
  if (before === undefined) delete process.env.GOOGLE_AI_API_KEY;
  else process.env.GOOGLE_AI_API_KEY = before;
});
beforeEach(() => {
  // In braces on purpose: a value returned from here would be run by the test runner as a clean-up step.
  generateContent.mockReset();
});

describe("asking Google's AI", () => {
  it("moves to the next model when the first is too busy", async () => {
    generateContent.mockImplementationOnce(failWith(busy)).mockResolvedValueOnce({ text: '{"greeting":"Hello"}' });
    await expect(geminiText({ system: "s", prompt: "p", schema })).resolves.toEqual({ greeting: "Hello" });
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual([MODELS.geminiText[0], MODELS.geminiText[1]]);
  });

  it("gives every try a time limit and switches the client's own retries off", async () => {
    generateContent.mockResolvedValue({ text: '{"greeting":"Hello"}' });
    await geminiText({ system: "s", prompt: "p", schema });
    const { config } = generateContent.mock.calls[0][0];
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(config.httpOptions.timeout).toBeGreaterThan(0);
    expect(config.httpOptions.retryOptions).toEqual({ attempts: 1 });
  });

  it("says so in plain words when every model is too busy", async () => {
    generateContent.mockImplementation(failWith(busy));
    expect((await failure(geminiText({ system: "s", prompt: "p", schema })))?.message).toContain(`The AI was too busy or too slow to answer (${MODELS.geminiText.length} models tried). Please try again in a minute.`);
    expect(generateContent).toHaveBeenCalledTimes(MODELS.geminiText.length);
  });

  it("says the AI has used up its allowance when every model answers 429", async () => {
    const daily = () => new ApiError({ status: 429, message: "generate_content_free_tier_requests limit 20 GenerateRequestsPerDayPerProjectPerModel-FreeTier" });
    generateContent.mockImplementation(failWith(daily));
    expect((await failure(geminiText({ system: "s", prompt: "p", schema })))?.message).toBe(`The AI has used up its allowance for now (${MODELS.geminiText.length} models tried). Please try again later.`);
    expect(generateContent).toHaveBeenCalledTimes(MODELS.geminiText.length); // each model was given its chance
    generateContent.mockClear();
    expect((await failure(geminiWatch({ video, prompt: "p", schema })))?.message).toBe(
      `The AI has used up its allowance for now and could not watch this video (${MODELS.geminiWatch.length} models tried). It will be tried again.`,
    );
  });

  it("treats a 504 as busy, tries the next model, and never passes the raw error on", async () => {
    generateContent.mockImplementation(failWith(() => new ApiError({ status: 504, message: "Deadline expired before operation could complete." })));
    const error = await failure(geminiWatch({ video, prompt: "p", schema }));
    expect(error?.name).toBe("AiTrouble");
    expect(error?.message).toBe(`The AI was too busy or too slow to watch this video (${MODELS.geminiWatch.length} models tried). It will be tried again.`);
    expect(generateContent).toHaveBeenCalledTimes(MODELS.geminiWatch.length);
  });

  it("uses the model that still answers when the others are out of allowance or timing out", async () => {
    generateContent
      .mockImplementationOnce(failWith(() => new ApiError({ status: 504, message: "timeout" })))
      .mockImplementationOnce(failWith(() => new ApiError({ status: 429, message: "limit 20" })))
      .mockResolvedValueOnce({ text: '{"greeting":"Hello"}' });
    expect(await geminiText({ system: "s", prompt: "p", schema })).toEqual({ greeting: "Hello" });
  });

  it("says so in plain words when watching runs out of time", async () => {
    generateContent.mockImplementation(failWith(() => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })));
    expect((await failure(geminiWatch({ video, prompt: "p", schema })))?.message).toContain("too busy or too slow to watch this video");
  });

  it("does not try other models for a video it cannot open", async () => {
    generateContent.mockImplementation(failWith(() => new ApiError({ status: 400, message: "bad request" })));
    expect((await failure(geminiWatch({ video, prompt: "p", schema })))?.message).toContain("It must be a public video");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not try other models for a refused key", async () => {
    generateContent.mockImplementation(failWith(() => new ApiError({ status: 403, message: "API key not valid" })));
    expect((await failure(geminiText({ system: "s", prompt: "p", schema })))?.message).toContain("The AI key (GOOGLE_AI_API_KEY) was refused");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer in the wrong shape rather than passing it on", async () => {
    generateContent.mockResolvedValue({ text: '{"hello":1}' });
    expect((await failure(geminiText({ system: "s", prompt: "p", schema })))?.message).toContain("did not have the shape that was asked for");
  });

  it("refuses an answer that cannot be read", async () => {
    generateContent.mockResolvedValue({ text: "not json" });
    expect((await failure(geminiText({ system: "s", prompt: "p", schema })))?.message).toContain("could not be read");
  });
});
