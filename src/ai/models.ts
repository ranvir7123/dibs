/**
 * Which model does which AI job, and how long each may take. Change a name
 * here to swap the model.
 *
 * - claudeText: writing the job card and judging text, when ANTHROPIC_API_KEY is set.
 * - geminiText / geminiWatch: Google's models, tried in this order. When one
 *   is too busy to answer (it says so with error 503 or 429), the next is tried.
 *   On 10 Nov 2026 the first in each list was too busy for hours while the
 *   others answered in about 3 seconds, which is why there is a list.
 */
export const MODELS = {
  claudeText: "claude-opus-5-5",
  geminiText: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
  geminiWatch: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
} as const;

/**
 * Time limits, so a slow AI never leaves a screen or the tick hanging.
 * These are engineering limits, not product numbers: the tick itself must
 * finish inside the web host's 300 seconds.
 */
export const LIMITS = {
  /** One try at writing or judging text. */
  textTryMs: 60_000,
  /** All tries at one text request together. */
  textTotalMs: 100_000,
  /** One try at watching a video. */
  watchTryMs: 150_000,
  /** Everything for one video together: upload, getting ready, and all tries. */
  watchTotalMs: 230_000,
} as const;
