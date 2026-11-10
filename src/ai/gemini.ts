/**
 * Google's Gemini, for the "watch video" job (and for text when there is no
 * Claude key). Used through src/ai/index.ts only.
 *
 * Facts from Google's docs, read 10 Nov 2026:
 * - A PUBLIC video link can be watched straight from its address. Unlisted and
 *   private videos are refused.
 * - A file is uploaded first (up to 2 GB, kept 48 hours), then watched.
 * - Video is looked at one picture per second by default, and the model is
 *   asked for moments as MM:SS.
 *
 * Every call has a time limit. A model that is too busy is skipped and the
 * next one in src/ai/models.ts is tried.
 */
import { ApiError, FileState, GoogleGenAI, createPartFromUri, type Part } from "@google/genai";
import { z } from "zod";
import type { TextRequest, WatchRequest } from "./index";
import { LIMITS, MODELS } from "./models";

/** How often to look whether an uploaded recording is ready. */
const UPLOAD_POLL_MS = 3_000;

function client(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY!.trim() });
}

/** An AI failure in plain words, safe to show on screen. */
export class AiTrouble extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTrouble";
  }
}

function readAnswer<T>(text: string | undefined, schema: z.ZodType<T>): T {
  if (!text) throw new AiTrouble("The AI gave no answer. Please try again.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiTrouble("The AI's answer could not be read. Please try again.");
  }
  const checked = schema.safeParse(data);
  if (!checked.success) throw new AiTrouble("The AI's answer did not have the shape that was asked for. Please try again.");
  return checked.data;
}

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : undefined);
const timedOut = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /aborted|timed? ?out/i.test(error.message));
/** Too busy, over its allowance, or briefly broken: worth trying the next model. */
const busy = (error: unknown) => {
  const status = statusOf(error);
  return status === 429 || (status !== undefined && status >= 500) || timedOut(error);
};

function plain(error: unknown, job: "text" | "watch", tried: number): AiTrouble {
  if (error instanceof AiTrouble) return error;
  const status = statusOf(error);
  if (status === 401 || status === 403) return new AiTrouble("The AI key (GOOGLE_AI_API_KEY) was refused. Check it in .env.local.");
  if (status === 400 && job === "watch") return new AiTrouble("The AI could not open this video. It must be a public video, or a normal video file.");
  if (busy(error)) {
    return new AiTrouble(
      job === "watch"
        ? `The AI was too busy or too slow to watch this video (${tried} model${tried === 1 ? "" : "s"} tried). It will be tried again.`
        : `The AI was too busy or too slow to answer (${tried} model${tried === 1 ? "" : "s"} tried). Please try again in a minute.`,
    );
  }
  return new AiTrouble(`The AI could not answer (error ${status ?? "unknown"}). Please try again.`);
}

/**
 * Asks each model in turn until one answers, inside a time limit for each
 * try and for all of them together.
 */
async function ask<T>(job: "text" | "watch", models: readonly string[], parts: Part[], schema: z.ZodType<T>, system: string | undefined, deadline: number): Promise<T> {
  const tryMs = job === "text" ? LIMITS.textTryMs : LIMITS.watchTryMs;
  let last: unknown = new Error("no model was tried");
  let tried = 0;
  for (const model of models) {
    const left = deadline - Date.now();
    if (left < 5_000) break;
    tried++;
    try {
      const response = await client().models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema),
          abortSignal: AbortSignal.timeout(Math.min(tryMs, left)),
          // The SDK's own retries are off: this loop moves to the next model instead.
          httpOptions: { timeout: Math.min(tryMs, left), retryOptions: { attempts: 1 } },
        },
      });
      return readAnswer(response.text, schema);
    } catch (error) {
      last = error;
      if (!busy(error) && !(error instanceof AiTrouble)) break; // a real refusal: another model would say the same
    }
  }
  throw plain(last, job, tried);
}

export async function geminiText<T>(request: TextRequest<T>): Promise<T> {
  return ask("text", MODELS.geminiText, [{ text: request.prompt }], request.schema, request.system, Date.now() + LIMITS.textTotalMs);
}

export async function geminiWatch<T>(request: WatchRequest<T>): Promise<T> {
  const deadline = Date.now() + LIMITS.watchTotalMs;
  const { video } = request;
  if (video.kind === "public_link") {
    return ask("watch", MODELS.geminiWatch, [{ fileData: { fileUri: video.url } }, { text: request.prompt }], request.schema, undefined, deadline);
  }

  const ai = client();
  let file;
  try {
    file = await ai.files.upload({ file: video.path, config: { mimeType: video.mimeType, abortSignal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())) } });
  } catch (error) {
    throw plain(error, "watch", 0);
  }
  try {
    while (file.state === FileState.PROCESSING) {
      if (Date.now() + UPLOAD_POLL_MS > deadline) throw new AiTrouble("The recording took too long to get ready for AI to watch. It will be tried again.");
      await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_MS));
      file = await ai.files.get({ name: file.name! });
    }
    if (file.state === FileState.FAILED || !file.uri) throw new AiTrouble("AI could not open the recording. Is it a normal video file?");
    return await ask("watch", MODELS.geminiWatch, [createPartFromUri(file.uri, file.mimeType ?? video.mimeType), { text: request.prompt }], request.schema, undefined, deadline);
  } catch (error) {
    throw plain(error, "watch", 1);
  } finally {
    // The recording is not left on Google's side once it has been watched.
    if (file.name) await ai.files.delete({ name: file.name }).catch(() => {});
  }
}
