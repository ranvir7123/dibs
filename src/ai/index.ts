/**
 * The one door to AI. Lane B's checkers call only this file, so the model
 * behind each job can be swapped without touching them.
 *
 * AI has two jobs here:
 *   text  - write and judge text (the job card, reading a handed-in file)
 *   watch - watch a video (a public video link, or an uploaded recording)
 *
 * Which model does which job is set in src/ai/models.ts. AI never moves
 * money and never calls PayPal.
 */
import type { z } from "zod";
import { MODELS } from "./models";

export { AiTrouble, isAiTrouble, waitingOnAiNote } from "./trouble";

/** A video for AI to watch: a public link on the video site, or a file kept on this machine. */
export type VideoSource =
  | { kind: "public_link"; url: string }
  | { kind: "file"; path: string; mimeType: string };

export interface TextRequest<T> {
  /** Standing instructions: who the AI is and the rules it must keep. */
  system: string;
  /** This one request. */
  prompt: string;
  /** The exact shape the answer must have. The answer is checked against it. */
  schema: z.ZodType<T>;
}

export interface WatchRequest<T> {
  video: VideoSource;
  prompt: string;
  schema: z.ZodType<T>;
}

export interface Ai {
  text<T>(request: TextRequest<T>): Promise<T>;
  watch<T>(request: WatchRequest<T>): Promise<T>;
}

/** Thrown when the key an AI job needs is not in the keys file. The message is safe to show on screen. */
export class AiKeyMissing extends Error {
  constructor(
    public readonly job: "text" | "watch",
    public readonly keyNames: string[],
  ) {
    super(
      job === "text"
        ? `AI cannot write or judge text yet: add ${keyNames.join(" or ")} to .env.local.`
        : `AI cannot watch video yet: add ${keyNames.join(" or ")} to .env.local.`,
    );
    this.name = "AiKeyMissing";
  }
}

const has = (name: string) => Boolean(process.env[name]?.trim());

/** Which AI jobs can run with the keys present. Names only, never a key's value. */
export function aiStatus(): { text: string | null; watch: string | null } {
  return {
    text: has("ANTHROPIC_API_KEY") ? `Claude (${MODELS.claudeText})` : has("GOOGLE_AI_API_KEY") ? `Gemini (${MODELS.geminiText.join(", then ")})` : null,
    watch: has("GOOGLE_AI_API_KEY") ? `Gemini (${MODELS.geminiWatch.join(", then ")})` : null,
  };
}

const realAi: Ai = {
  async text(request) {
    if (has("ANTHROPIC_API_KEY")) return (await import("./claude")).claudeText(request);
    if (has("GOOGLE_AI_API_KEY")) return (await import("./gemini")).geminiText(request);
    throw new AiKeyMissing("text", ["ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY"]);
  },
  async watch(request) {
    if (has("GOOGLE_AI_API_KEY")) return (await import("./gemini")).geminiWatch(request);
    throw new AiKeyMissing("watch", ["GOOGLE_AI_API_KEY"]);
  },
};

const holder = globalThis as unknown as { __dibsAi?: Ai | null };

/** The AI in use. */
export function getAi(): Ai {
  return holder.__dibsAi ?? realAi;
}

/** Swaps the AI for a stand-in (tests use recorded example answers). Pass null to go back to the real one. */
export function useAi(ai: Ai | null): void {
  holder.__dibsAi = ai;
}
