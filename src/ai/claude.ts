/**
 * Claude, for the "write and judge text" job and the "look at pictures and
 * PDFs" job. Used through src/ai/index.ts only. The answer comes back in the
 * exact shape asked for and is checked against it.
 */
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { LookRequest, TextRequest } from "./index";
import { LIMITS, MODELS } from "./models";
import { AiCannotOpen, AiTrouble } from "./trouble";

export async function claudeText<T>(request: TextRequest<T>): Promise<T> {
  // A time limit and one retry, so a slow answer never leaves a screen hanging.
  const client = new Anthropic({ timeout: LIMITS.textTryMs, maxRetries: 1 });
  let message;
  try {
    message = await client.beta.messages.parse({
      model: MODELS.claudeText,
      max_tokens: 16000,
      // If this model declines a request, the same request is tried on another model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      output_config: { format: betaZodOutputFormat(request.schema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AiTrouble("The AI was too slow to answer. Please try again in a minute.");
    if (error instanceof Anthropic.AuthenticationError) throw new AiTrouble("The AI key (ANTHROPIC_API_KEY) was refused. Check it in .env.local.");
    if (error instanceof Anthropic.RateLimitError) throw new AiTrouble("The AI is busy right now (too many requests). Try again in a minute.");
    if (error instanceof Anthropic.APIError) throw new AiTrouble(`The AI could not answer (error ${error.status ?? "unknown"}).`);
    throw error;
  }
  if (message.stop_reason === "refusal") throw new AiTrouble("The AI declined to answer this request.");
  if (message.stop_reason === "max_tokens") throw new AiTrouble("The AI's answer was cut off before it finished.");
  if (message.parsed_output == null) throw new AiTrouble("The AI's answer did not have the shape that was asked for.");
  return message.parsed_output as T;
}

/** The kinds of picture Claude takes. */
const PICTURE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type PictureType = (typeof PICTURE_TYPES)[number];

type LookBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: PictureType; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

const asBase64 = async (path: string) => (await readFile(path)).toString("base64");

/**
 * Claude looks at pictures (each with its label just before it) and, when
 * given, a PDF, then answers the prompt. `timeoutMs` shortens the usual time
 * limit when part of the time has already been spent getting the pictures ready.
 */
export async function claudeLook<T>(request: LookRequest<T>, timeoutMs: number = LIMITS.watchTryMs): Promise<T> {
  const content: LookBlock[] = [];
  for (const picture of request.pictures) {
    const type = PICTURE_TYPES.find((known) => known === picture.mimeType);
    if (!type) throw new AiCannotOpen("The AI cannot open this kind of picture. Please hand in a .png, .jpg or .webp file.");
    if (picture.label) content.push({ type: "text", text: picture.label });
    content.push({ type: "image", source: { type: "base64", media_type: type, data: await asBase64(picture.path) } });
  }
  if (request.pdfPath) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: await asBase64(request.pdfPath) } });
  content.push({ type: "text", text: request.prompt });

  // One try only: pictures make a slow request, and a second try could run past the time the tick has. The tick tries again later.
  const client = new Anthropic({ timeout: Math.max(1_000, Math.min(timeoutMs, LIMITS.watchTryMs)), maxRetries: 0 });
  let message;
  try {
    message = await client.beta.messages.parse({
      model: MODELS.claudeText,
      max_tokens: 16000,
      // If this model declines a request, the same request is tried on another model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: request.system,
      messages: [{ role: "user", content }],
      output_config: { format: betaZodOutputFormat(request.schema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AiTrouble("The AI was too slow to answer. Please try again in a minute.");
    if (error instanceof Anthropic.AuthenticationError) throw new AiTrouble("The AI key (ANTHROPIC_API_KEY) was refused. Check it in .env.local.");
    if (error instanceof Anthropic.RateLimitError) throw new AiTrouble("The AI is busy right now (too many requests). Try again in a minute.");
    // The AI says the file itself cannot be taken (error 400, or 413 for "too big"): asking again would not help.
    if (error instanceof Anthropic.APIError && (error.status === 400 || error.status === 413)) throw new AiCannotOpen();
    if (error instanceof Anthropic.APIError) throw new AiTrouble(`The AI could not answer (error ${error.status ?? "unknown"}).`);
    throw error;
  }
  if (message.stop_reason === "refusal") throw new AiTrouble("The AI declined to answer this request.");
  if (message.stop_reason === "max_tokens") throw new AiTrouble("The AI's answer was cut off before it finished.");
  if (message.parsed_output == null) throw new AiTrouble("The AI's answer did not have the shape that was asked for.");
  return message.parsed_output as T;
}
