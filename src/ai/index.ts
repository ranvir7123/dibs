/**
 * The one door to AI. Lane B's checkers call only this file, so the model
 * behind each job can be swapped without touching them.
 *
 * AI has three jobs here:
 *   text  - write and judge text (the job card, reading a handed-in file)
 *   watch - watch a video (a public video link, or an uploaded recording)
 *   look  - look at pictures and PDFs (a handed-in photo or PDF)
 *
 * An uploaded recording is cut into pictures, one per second, and Claude
 * looks at them. A public video link is watched by Gemini.
 *
 * Which model does which job is set in src/ai/models.ts. AI never moves
 * money and never calls PayPal.
 */
import type { z } from "zod";
import { LIMITS, MODELS } from "./models";

export { AiCannotOpen, AiTrouble, isAiTrouble, waitingOnAiNote } from "./trouble";

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

/** One picture for AI to look at, kept on this machine. */
export interface Picture {
  path: string;
  /** What kind of picture it is, for example "image/jpeg". */
  mimeType: string;
  /** A line shown to the AI just before the picture, for example "Picture at 00:12". */
  label?: string;
}

export interface LookRequest<T> {
  system?: string;
  prompt: string;
  /** In the order the AI should see them. May be empty when there is only a PDF. */
  pictures: Picture[];
  /** A PDF kept on this machine, placed before the prompt. */
  pdfPath?: string;
  schema: z.ZodType<T>;
}

export interface Ai {
  text<T>(request: TextRequest<T>): Promise<T>;
  watch<T>(request: WatchRequest<T>): Promise<T>;
  look<T>(request: LookRequest<T>): Promise<T>;
}

/** Thrown when the key an AI job needs is not in the keys file. The message is safe to show on screen. */
export class AiKeyMissing extends Error {
  constructor(
    public readonly job: "text" | "watch" | "look",
    public readonly keyNames: string[],
  ) {
    super(
      job === "text"
        ? `AI cannot write or judge text yet: add ${keyNames.join(" or ")} to .env.local.`
        : job === "watch"
          ? `AI cannot watch video yet: add ${keyNames.join(" or ")} to .env.local.`
          : `AI cannot look at pictures or PDFs yet: add ${keyNames.join(" or ")} to .env.local.`,
    );
    this.name = "AiKeyMissing";
  }
}

const has = (name: string) => Boolean(process.env[name]?.trim());

/**
 * Which AI jobs can run with the keys present. Names only, never a key's value.
 * watch: Claude looks at an uploaded recording (cut into pictures); Gemini watches a public video link.
 */
export function aiStatus(): { text: string | null; watch: string | null; look: string | null } {
  const claude = has("ANTHROPIC_API_KEY") ? `Claude (${MODELS.claudeText})` : null;
  const gemini = has("GOOGLE_AI_API_KEY") ? `Gemini (${MODELS.geminiWatch.join(", then ")})` : null;
  return {
    text: claude ?? (has("GOOGLE_AI_API_KEY") ? `Gemini (${MODELS.geminiText.join(", then ")})` : null),
    watch:
      claude && gemini
        ? `${claude} for uploaded recordings, ${gemini} for public video links`
        : claude
          ? `${claude} for uploaded recordings only (public video links need GOOGLE_AI_API_KEY)`
          : gemini,
    look: claude,
  };
}

/** Said to the AI before the pictures cut from a recording. */
const PICTURES_NOTE = "These are pictures taken from the recording, one per second, each labelled with its time. There is no sound.";

/** The most picture data sent in one request, so it stays inside what the AI takes. */
const MAX_PICTURE_BYTES = 18_000_000;

/** Drops every second picture until all of them together are small enough to send. */
async function insideSizeLimit<P extends { path: string }>(pictures: P[]): Promise<P[]> {
  const { stat } = await import("node:fs/promises");
  let kept = pictures;
  for (;;) {
    let total = 0;
    for (const picture of kept) total += (await stat(picture.path)).size;
    if (total <= MAX_PICTURE_BYTES || kept.length <= 1) return kept;
    kept = kept.filter((_, index) => index % 2 === 0);
  }
}

const realAi: Ai = {
  async text(request) {
    if (has("ANTHROPIC_API_KEY")) return (await import("./claude")).claudeText(request);
    if (has("GOOGLE_AI_API_KEY")) return (await import("./gemini")).geminiText(request);
    throw new AiKeyMissing("text", ["ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY"]);
  },
  async watch(request) {
    const { video } = request;
    // An uploaded recording: cut into pictures and looked at by Claude.
    if (video.kind === "file" && has("ANTHROPIC_API_KEY")) {
      const deadline = Date.now() + LIMITS.watchTotalMs;
      const { withPictures, clockLabel } = await import("./frames");
      const { claudeLook } = await import("./claude");
      return withPictures(video.path, async (all) => {
        const pictures = await insideSizeLimit(all);
        const last = all[all.length - 1];
        const note = `${PICTURES_NOTE} The pictures run from 00:00 to ${clockLabel(last.seconds)}.`;
        return claudeLook({ prompt: `${note}\n\n${request.prompt}`, pictures, schema: request.schema }, deadline - Date.now());
      });
    }
    // A public video link always goes to Gemini, and so does a recording when there is no Claude key.
    if (has("GOOGLE_AI_API_KEY")) return (await import("./gemini")).geminiWatch(request);
    throw new AiKeyMissing("watch", video.kind === "file" ? ["ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY"] : ["GOOGLE_AI_API_KEY"]);
  },
  async look(request) {
    if (!has("ANTHROPIC_API_KEY")) throw new AiKeyMissing("look", ["ANTHROPIC_API_KEY"]);
    const { claudeLook } = await import("./claude");
    // A single big photo (straight from a phone) is made smaller first, or the AI would refuse it.
    if (request.pictures.length === 1) {
      const { withSendablePhoto } = await import("./frames");
      const [only] = request.pictures;
      return withSendablePhoto(only, (ready) => claudeLook({ ...request, pictures: [{ ...ready, label: only.label }] }));
    }
    return claudeLook(request);
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
