/**
 * A stand-in for the tracked link address (/r/<code>), which lane B owns.
 *
 * It exists only so the click attack can be proven before the real address is
 * built. It does what the contract says the real one does: adds one Click row
 * for every visit and sends the visitor on to the link's target page. A visitor
 * is counted once per link (settings.cheatTests.repeatVisitor); every later
 * click from them is stored but left out of the count.
 *
 * It is not part of the product and is never put online.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { newId } from "../src/db/ids";
import { clicks, trackedLinks } from "../src/db/schema";
import { settings } from "../src/settings";

interface LinkState {
  targetUrl: string;
  /** How many clicks have been counted for each visitor so far. */
  countedByVisitor: Map<string, number>;
}

/** A scrambled mark for the visitor, made from their address and browser name. Never the raw address. */
function visitorKeyOf(request: IncomingMessage): string {
  const from = `${request.socket.remoteAddress ?? ""}|${request.headers["user-agent"] ?? ""}`;
  return createHash("sha256").update(from).digest("hex").slice(0, 32);
}

export interface StandIn {
  /** Where the stand-in listens, for example http://127.0.0.1:51234 */
  baseUrl: string;
  close(): Promise<void>;
}

/** Starts the stand-in. Port 0 (the default) means any free port. */
export async function startStandIn(port = 0): Promise<StandIn> {
  const db = await getDb();
  const links = new Map<string, Promise<LinkState | null>>();

  const loadLink = async (code: string): Promise<LinkState | null> => {
    const link = (await db.select().from(trackedLinks).where(eq(trackedLinks.code, code)))[0];
    if (!link) return null;
    const already = await db
      .select({ visitorKey: clicks.visitorKey })
      .from(clicks)
      .where(and(eq(clicks.linkCode, code), eq(clicks.counted, true)));
    const countedByVisitor = new Map<string, number>();
    for (const { visitorKey } of already) countedByVisitor.set(visitorKey, (countedByVisitor.get(visitorKey) ?? 0) + 1);
    return { targetUrl: link.targetUrl, countedByVisitor };
  };

  const server = createServer((request, response) => {
    const match = /^\/r\/([^/?#]+)/.exec(request.url ?? "");
    if (request.method !== "GET" || !match) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not a tracked link.");
      return;
    }
    const code = decodeURIComponent(match[1]);
    if (!links.has(code)) {
      links.set(
        code,
        loadLink(code).catch((error: unknown) => {
          links.delete(code); // do not remember a failed look-up
          throw error;
        }),
      );
    }

    links
      .get(code)!
      .then(async (link) => {
        if (!link) {
          links.delete(code); // the link may be made later
          response.writeHead(404, { "content-type": "text/plain" }).end("No such link.");
          return;
        }
        // Decided in one go, with nothing awaited in between, so two clicks
        // arriving together cannot both be the visitor's first.
        const visitorKey = visitorKeyOf(request);
        const countedSoFar = link.countedByVisitor.get(visitorKey) ?? 0;
        const counted = countedSoFar < settings.cheatTests.repeatVisitor.countedClicksPerVisitor;
        if (counted) link.countedByVisitor.set(visitorKey, countedSoFar + 1);

        await db.insert(clicks).values({
          id: newId("clk"),
          linkCode: code,
          visitorKey,
          counted,
          leftOutReason: counted ? null : "The same visitor clicked again.",
        });
        response.writeHead(302, { location: link.targetUrl }).end();
      })
      .catch((error: unknown) => {
        response.writeHead(500, { "content-type": "text/plain" }).end(error instanceof Error ? error.message : "The stand-in failed.");
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const { port: listeningOn } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${listeningOn}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
