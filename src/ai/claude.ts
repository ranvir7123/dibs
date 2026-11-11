/**
 * Claude, for the "write and judge text" job. Used through src/ai/index.ts only.
 * The answer comes back in the exact shape asked for and is checked against it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { TextRequest } from "./index";
import { LIMITS, MODELS } from "./models";
import { AiTrouble } from "./trouble";

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
