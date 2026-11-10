/**
 * Turns anything that was thrown into one plain sentence a person can read.
 *
 * Three kinds of error reach the screens:
 * 1. A part of Dibs another builder owns that is not built yet. Its function
 *    throws "not built yet: lane A owns startHold".
 * 2. A plain sentence from the database functions, such as
 *    "Please give the email your PayPal uses." These are shown as they are.
 * 3. Anything else (a bug). The details stay in the server's log.
 */

const NOT_BUILT = /^not built yet: lane [A-D] owns (\w+)/;

const NOT_BUILT_WORDS: Record<string, string> = {
  writeJobCard: "The part of Dibs that writes job cards is not switched on yet. Nothing was saved and no money was locked.",
  startHold: "The PayPal step is not switched on yet. Your job card is saved, and no money was locked.",
  confirmHold: "The PayPal step is not switched on yet. Your job card is saved, and no money was locked.",
  payWorker: "Paying out is not switched on yet. Nothing was sent.",
  letGo: "Letting the held money go is not switched on yet. Nothing was changed.",
  recordSale: "Counting sales is not switched on yet.",
  runChecks: "The checker is not switched on yet. Nothing was checked or paid.",
  tick: "The checker is not switched on yet. Nothing was checked or paid.",
  storeHandInFile: "Taking in files is not switched on yet. Your file was not saved, so please keep it.",
};

const GENERIC = "Something went wrong on our side. Please try again.";

export function isNotBuilt(error: unknown): boolean {
  return error instanceof Error && NOT_BUILT.test(error.message);
}

export function plainError(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC;

  const notBuilt = NOT_BUILT.exec(error.message);
  if (notBuilt) {
    return NOT_BUILT_WORDS[notBuilt[1]] ?? "This part of Dibs is not switched on yet. Nothing was changed.";
  }

  // The other lanes' functions throw a plain Error (not a TypeError or a
  // database driver's own kind) whose message is one sentence starting with
  // a capital letter. Anything else is treated as a bug and kept off screen.
  const message = error.message.trim();
  const looksLikeASentence = error.constructor === Error && /^[A-Z]/.test(message) && !message.includes("\n") && message.length <= 240;
  return looksLikeASentence ? message : GENERIC;
}
