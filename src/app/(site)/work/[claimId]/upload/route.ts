import { getMyWork, handIn, storeHandInFile } from "@/contract";
import { isNotBuilt, plainError } from "@/ui/errors";
import { MAX_HAND_IN_BYTES, maxBytesFor } from "@/ui/handin";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";

/**
 * Takes a worker's file for a claim. The browser sends the file itself as the
 * request body and its name in the "x-file-name" header.
 *
 * This is a plain address instead of a form action because form actions
 * refuse anything over 1 MB, and a screen recording is far bigger.
 */
export async function POST(request: Request, { params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  const say = (status: number, error: string, notReady = false) => Response.json({ error, notReady }, { status });

  const viewer = await getViewer();
  if (!viewer) return say(401, "Please say who you are first, then hand in again.");

  const mine = await getMyWork(viewer.id);
  const item = mine?.items.find((candidate) => candidate.claim.id === claimId);
  if (!item) return say(403, "This job was taken by someone else. Switch to the person who called dibs on it.");
  if (item.job.card.checker.handIn !== "file") return say(400, "This job does not take a file.");
  // Checked before the file is read, so a file for a finished job is never stored (or written over a good one).
  if (item.claim.status === "closed" || item.job.status !== "open") return say(409, "This job has ended, so nothing more can be handed in.");

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_HAND_IN_BYTES) return say(413, "That file is too big for Dibs to take.");

  let fileName = "file";
  try {
    fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "file").replace(/[\\/]/g, "_").slice(0, 200) || "file";
  } catch {
    // A name that cannot be read is not worth refusing the file for.
  }

  // A photo or a PDF has a smaller limit than a recording: a bigger one is more than the AI can open.
  const limit = maxBytesFor(fileName);
  const tooBig = limit < MAX_HAND_IN_BYTES ? "That photo or PDF is too big. The most Dibs can take for a photo or a PDF is 20 MB." : "That file is too big for Dibs to take.";
  if (declared > limit) return say(413, tooBig);

  try {
    const bytes = await readUpTo(request, limit);
    if (bytes === null) return say(413, tooBig);
    if (bytes.byteLength === 0) return say(400, "That file is empty. Please choose another.");
    const kept = await storeHandInFile({ claimId, fileName, bytes });
    await handIn({ claimId, file: kept });
  } catch (error) {
    if (!isNotBuilt(error)) console.error(error);
    return say(isNotBuilt(error) ? 503 : 400, plainError(error), isNotBuilt(error));
  }
  return Response.json({ ok: true });
}

/**
 * Reads the request's body piece by piece and gives up (null) as soon as it
 * passes the limit, so a sender cannot fill the server's memory by lying
 * about the size.
 */
async function readUpTo(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    pieces.push(value);
  }
  const whole = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    whole.set(piece, offset);
    offset += piece.byteLength;
  }
  return whole;
}
