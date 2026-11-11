import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileKind, handInPath } from "@/checkers/files";

export const dynamic = "force-dynamic";

/**
 * Sends back a file a worker handed in (a recording or a document), so the
 * result card can play it. Answers part of the file when the browser asks for
 * a range, which is what lets a video jump to the moment a rule was met.
 *
 * Only files inside the hand-ins folder, of the kinds the checker opens, are
 * sent. Dibs has no passwords, so like every result card this is open to
 * anyone who has the address.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const missing = () => new Response("No such file.", { status: 404 });
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part.startsWith("."))) return missing();
  const relative = parts.join("/");
  const kind = fileKind(relative);
  if (kind.kind === "other") return missing();

  let full: string;
  try {
    full = handInPath(relative);
  } catch {
    return missing();
  }
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) return missing();

  const size = info.size;
  const headers: Record<string, string> = {
    "content-type": kind.kind === "video" ? kind.mimeType : "text/plain; charset=utf-8",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    // "bytes=100-" is from 100 to the end; "bytes=-500" is the last 500.
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
}
