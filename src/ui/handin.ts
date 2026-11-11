/** The biggest file the hand-in screen takes: 500 MB. A 4 minute screen recording is usually well under 100 MB. */
export const MAX_HAND_IN_BYTES = 500_000_000;

/**
 * The address a handed-in link or file can be opened at, or null when it has
 * none. A link is its own address. A file the worker uploaded is kept as
 * "<claim id>/<file name>" and is served from /hand-ins/. Anything else (the
 * sample data's pretend files) cannot be opened.
 */
export function handInAddress(where: string | null): string | null {
  if (!where) return null;
  if (/^https?:\/\//i.test(where)) return where;
  return /^clm_[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(where) ? `/hand-ins/${where}` : null;
}
