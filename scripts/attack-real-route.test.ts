/**
 * The click attack against the REAL tracked link code (lane B's
 * src/app/r/[code]/route.ts), not the stand-in. The route's own GET function
 * is put behind a small web server here, so the attack reaches it over HTTP
 * exactly as it will on the site, and the count can be read from the same
 * database afterwards.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "../src/app/r/[code]/route";
import { closeDb, getDb } from "../src/db/client";
import { seed } from "../src/db/seed";
import { probeLink, readClickCount, sendClicks } from "./attack-lib";

const CODE = "kabirn2w"; // kabir.cuts's sample link: no clicks yet

describe("the click attack against the real link route", () => {
  let baseUrl = "";
  let stop: () => Promise<void> = async () => {};

  beforeAll(async () => {
    await seed(await getDb());
    const server = createServer((request, response) => {
      const code = /^\/r\/([^/?#]+)/.exec(request.url ?? "")?.[1] ?? "";
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      GET(new Request(`http://dibs.test${request.url}`, { headers }), { params: Promise.resolve({ code }) })
        .then(async (answer) => {
          response.writeHead(answer.status, Object.fromEntries(answer.headers)).end(await answer.text());
        })
        .catch(() => response.writeHead(500).end());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    stop = () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
  });

  afterAll(async () => {
    await stop();
    await closeDb();
  });

  it("5,000 clicks from one machine are all stored and counted as 1", async () => {
    expect(await readClickCount(CODE)).toEqual({ known: true, stored: 0, counted: 0 });
    expect((await probeLink(baseUrl, CODE)).ok).toBe(true);

    const report = await sendClicks({ baseUrl, code: CODE, clicks: 5000, atOnce: 50 });
    console.log(`real route: sent ${report.sent}, answered ${report.answered}, failed ${report.failed}, answers ${JSON.stringify(report.statuses)}, ${report.seconds.toFixed(1)} seconds`);
    expect(report.answered).toBe(5000);
    expect(report.failed).toBe(0);

    const after = await readClickCount(CODE);
    console.log(`real route: stored ${after.stored}, counted ${after.counted}`);
    expect(after).toEqual({ known: true, stored: 5001, counted: 1 });
  });

  it("an unknown link answers 404, so no attack is sent", async () => {
    expect(await probeLink(baseUrl, "nosuchlink")).toEqual({ ok: false, status: 404 });
  });
});
