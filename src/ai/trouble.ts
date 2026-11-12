/**
 * An AI failure in plain words. Thrown by every AI call when the AI is too
 * busy, has used up its allowance, timed out, was refused its key, or gave an
 * answer that cannot be used. It never carries a result: the caller must not
 * decide anything from it, only wait and try again.
 */
export class AiTrouble extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTrouble";
  }
}

/**
 * The AI refused the handed-in file itself (too big, too many pages, damaged,
 * or not really a picture or PDF). Trying again would give the same answer,
 * so the worker is told and can hand in another file. The message is safe to
 * show on screen.
 */
export class AiCannotOpen extends Error {
  constructor(message = "The AI could not open this file. It may be too big, have too many pages, or be damaged. Please hand in a smaller or simpler file.") {
    super(message);
    this.name = "AiCannotOpen";
  }
}

/** True for any error that means "the AI could not do its job", as opposed to a problem with what was handed in. */
export function isAiTrouble(error: unknown): error is Error {
  return error instanceof Error && (error.name === "AiTrouble" || error.name === "AiKeyMissing");
}

/**
 * What a worker is shown while their check waits on the AI. Says what
 * happened in plain words, leaves out anything about keys or settings, and
 * always ends by saying it is tried again without them doing anything.
 */
export function waitingOnAiNote(error: Error): string {
  const again = "It will be tried again by itself; you do not need to hand in again.";
  if (error.name === "AiKeyMissing" || /\bkey\b/i.test(error.message)) return `The AI is not available on this site right now, so this has not been checked yet. ${again}`;
  const what = error.message
    .replace(/\s*(Please try again[^.]*\.|It will be tried again\.)\s*$/i, "")
    .trim();
  return `${what} Nothing has been decided yet. ${again}`;
}
