import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pageLinksFrom } from "@/contract/links";
import { isPublicAddress, PAGE_MAX_BYTES, PAGE_TEXT_LIMIT, readPublicPage, wordsFromHtml, type HostLookup } from "./pages";

// Stand-ins: no test here reaches the internet.
const publicHost: HostLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

afterEach(() => {
  delete process.env.DIBS_ALLOW_LOCAL_PAGES;
});

describe("which addresses count as public", () => {
  it("refuses this machine, private networks and other addresses that are not on the open internet", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.20", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::5", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:c0a8:0101", "64:ff9b::a00:1", "2001:db8::1", "not an address"]) {
      expect([address, isPublicAddress(address)]).toEqual([address, false]);
    }
  });
  it("lets ordinary public addresses through", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect([address, isPublicAddress(address)]).toEqual([address, true]);
    }
  });
});

describe("readPublicPage with a stand-in for the network", () => {
  it("refuses a private address, whether it is written in the link or hidden behind a name", async () => {
    const fetcher = vi.fn();
    for (const link of ["http://127.0.0.1/admin", "http://192.168.0.1/", "http://[::1]:3000/", "http://169.254.169.254/latest/meta-data", "ftp://example.com/file", "file:///etc/passwd", "https://user:secret@example.com/", "not a link"]) {
      await expect(readPublicPage(link, { fetch: fetcher, lookup: publicHost })).rejects.toThrow("Dibs only opens public web pages.");
    }
    const inside: HostLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    await expect(readPublicPage("https://looks-fine.example/page", { fetch: fetcher, lookup: inside })).rejects.toThrow("Dibs only opens public web pages.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses 169.254.169.254 and 0.0.0.0 written as plain addresses, and every private IPv6 form", async () => {
    const fetcher = vi.fn();
    const links = ["http://169.254.169.254/", "http://0.0.0.0/", "http://[::1]/", "http://[fc00::1]/", "http://[fdab:1234::9]/", "http://[fe80::1]/", "http://[febf::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/", "http://[::ffff:7f00:1]/"];
    for (const link of links) {
      await expect(readPublicPage(link, { fetch: fetcher, lookup: publicHost }), link).rejects.toThrow("Dibs only opens public web pages.");
    }
    // The same addresses hidden behind a harmless-looking name.
    for (const address of ["::1", "fc00::1", "fdab:1234::9", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "169.254.169.254", "0.0.0.0"]) {
      const lookup: HostLookup = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
      await expect(readPublicPage("https://harmless-looking.example/", { fetch: fetcher, lookup }), address).rejects.toThrow("Dibs only opens public web pages.");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a name that points at a private address", async () => {
    const lookup: HostLookup = async (host) => [{ address: host === "inside.example" ? "192.168.1.10" : "93.184.216.34", family: 4 }];
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://inside.example/router" } }));
    await expect(readPublicPage("https://ok.example/", { fetch: fetcher, lookup })).rejects.toThrow("Dibs only opens public web pages.");
    expect(fetcher).toHaveBeenCalledTimes(1); // the private target was never asked for
  });

  it("follows a redirect, checking the new host the same way, and keeps the title", async () => {
    const lookup = vi.fn(publicHost);
    const fetcher = vi.fn(async (link: string) =>
      link === "https://short.example/go" ? new Response(null, { status: 302, headers: { location: "https://listing.example/cafe?id=7" } }) : html("<html><head><title>Saffron Lane Caf&#233; &amp; Co | TownPages</title></head><body><h1>Saffron Lane</h1><p>Phone 020&nbsp;5550&nbsp;4412</p></body></html>"),
    );
    const page = await readPublicPage("https://short.example/go", { fetch: fetcher, lookup });
    expect(page).toEqual({ url: "https://short.example/go", finalUrl: "https://listing.example/cafe?id=7", title: "Saffron Lane Café & Co | TownPages", text: "Saffron Lane Phone 020 5550 4412", cut: false });
    expect(lookup.mock.calls.map((call) => call[0])).toEqual(["short.example", "listing.example"]);
    expect(fetcher).toHaveBeenCalledWith("https://short.example/go", expect.objectContaining({ redirect: "manual" }));
  });

  it("refuses a redirect that leads to a private address, and stops after 3 redirects", async () => {
    const toInside = vi.fn(async () => new Response(null, { status: 301, headers: { location: "http://10.0.0.8/secret" } }));
    await expect(readPublicPage("https://ok.example/", { fetch: toInside, lookup: publicHost })).rejects.toThrow("Dibs only opens public web pages.");
    expect(toInside).toHaveBeenCalledTimes(1);

    let hops = 0;
    const forever = vi.fn(async () => new Response(null, { status: 302, headers: { location: `https://ok.example/${++hops}` } }));
    await expect(readPublicPage("https://ok.example/", { fetch: forever, lookup: publicHost })).rejects.toThrow("Dibs could not open this page (it sends visitors on too many times).");
    expect(forever).toHaveBeenCalledTimes(4); // the first page and 3 redirects
  });

  it("strips scripts, styles and tags, and decodes the common entities", () => {
    const words = wordsFromHtml(`<html><head><title> Caf&#233; </title><style>p { color: red }</style><script>var phone = "999";</script></head>
      <body><!-- hidden note --><noscript>Turn scripts on</noscript><template><p>Not shown</p></template>
      <h1>Saffron&nbsp;Lane Caf&#xE9;</h1><p>Open 8&nbsp;am &ndash; 9 pm &amp; later &lt;by request&gt;</p><script>ignore("me")</script></body></html>`);
    expect(words).toEqual({ title: "Café", text: "Saffron Lane Café Open 8 am - 9 pm & later <by request>" });
  });

  it("refuses a body that is too big, by its stated size or by what actually arrives", async () => {
    const stated = async () => html("small", 200, { "content-length": String(PAGE_MAX_BYTES + 1) });
    await expect(readPublicPage("https://big.example/", { fetch: stated, lookup: publicHost })).rejects.toThrow("Dibs could not read this page (it is bigger than 1.5 MB).");
    const arrives = async () => html("x".repeat(PAGE_MAX_BYTES + 10));
    await expect(readPublicPage("https://big.example/", { fetch: arrives, lookup: publicHost })).rejects.toThrow("Dibs could not read this page (it is bigger than 1.5 MB).");
  });

  it("says plainly why a page could not be opened", async () => {
    const tools = (fetcher: () => Promise<Response>) => ({ fetch: fetcher, lookup: publicHost });
    await expect(readPublicPage("https://gone.example/x", tools(async () => html("Not here", 404)))).rejects.toThrow("Dibs could not open this page (error 404).");
    await expect(readPublicPage("https://pic.example/x.png", tools(async () => new Response("png", { headers: { "content-type": "image/png" } })))).rejects.toThrow("Dibs can only read web pages made of text.");
    await expect(readPublicPage("https://down.example/", tools(async () => Promise.reject(new TypeError("fetch failed"))))).rejects.toThrow("Dibs could not open this page (the site did not answer).");
    await expect(readPublicPage("https://empty.example/", tools(async () => html("<script>draw()</script>")))).rejects.toThrow("Dibs opened this page but found no words on it.");
    const noSuchSite: HostLookup = async () => Promise.reject(new Error("ENOTFOUND"));
    await expect(readPublicPage("https://nowhere.example/", { fetch: async () => html("x"), lookup: noSuchSite })).rejects.toThrow("Dibs could not find this site. Please check the link.");
  });

  it("reads a plain text page, and cuts a very long page and says so", async () => {
    const page = await readPublicPage("https://long.example/", { fetch: async () => new Response(`${"word ".repeat(PAGE_TEXT_LIMIT)}`, { headers: { "content-type": "text/plain" } }), lookup: publicHost });
    expect(page.title).toBe("");
    expect(page.text.length).toBe(PAGE_TEXT_LIMIT);
    expect(page.cut).toBe(true);
  });
});

describe("readPublicPage on the real path, against a small server on this machine", () => {
  let server: Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      hits++;
      if (request.url === "/moved") {
        response.writeHead(302, { location: "/listing" }).end();
        return;
      }
      if (request.url === "/to-inside") {
        // From here on local pages are no longer allowed, so the next hop must be refused when it connects.
        delete process.env.DIBS_ALLOW_LOCAL_PAGES;
        response.writeHead(302, { location: `http://inside.example:${port}/listing` }).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<title>TownPages</title><body><h1>Saffron Lane Café</h1><script>x()</script></body>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("makes no connection when the name points at a private address", async () => {
    hits = 0;
    // The name looks harmless, but it points at this machine. The check happens at the moment of connecting.
    const lookup = vi.fn<HostLookup>(async () => [{ address: "127.0.0.1", family: 4 }]);
    await expect(readPublicPage(`http://harmless-looking.example:${port}/listing`, { lookup })).rejects.toThrow("Dibs only opens public web pages.");
    expect(lookup).toHaveBeenCalledWith("harmless-looking.example");
    expect(hits).toBe(0);
    await expect(readPublicPage(`http://127.0.0.1:${port}/listing`)).rejects.toThrow("Dibs only opens public web pages.");
    expect(hits).toBe(0);
  });

  it("checks a redirect's target at the moment of connecting too, and never connects to a private one", async () => {
    // The first hop is let through only so this test has a server to answer it. The server switches
    // the allowance off before it redirects, so the second hop meets the normal rule.
    process.env.DIBS_ALLOW_LOCAL_PAGES = "1";
    hits = 0;
    const lookup = vi.fn<HostLookup>(async () => [{ address: "127.0.0.1", family: 4 }]);
    await expect(readPublicPage(`http://first.example:${port}/to-inside`, { lookup })).rejects.toThrow("Dibs only opens public web pages.");
    expect(lookup.mock.calls.map((call) => call[0])).toEqual(["first.example", "inside.example"]);
    expect(hits).toBe(1); // only the first hop reached the server
  });

  it("refuses private IPv6 answers at the moment of connecting", async () => {
    hits = 0;
    for (const address of ["::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
      const lookup: HostLookup = async () => [{ address, family: 6 }];
      await expect(readPublicPage(`http://harmless-looking.example:${port}/listing`, { lookup }), address).rejects.toThrow("Dibs only opens public web pages.");
    }
    expect(hits).toBe(0);
  });

  it("opens a page on this machine only when DIBS_ALLOW_LOCAL_PAGES is 1, following a redirect by hand", async () => {
    process.env.DIBS_ALLOW_LOCAL_PAGES = "1";
    hits = 0;
    const lookup = vi.fn<HostLookup>(async () => [{ address: "127.0.0.1", family: 4 }]);
    const page = await readPublicPage(`http://demo-site.example:${port}/moved`, { lookup });
    expect(page).toMatchObject({ finalUrl: `http://demo-site.example:${port}/listing`, title: "TownPages", text: "Saffron Lane Café", cut: false });
    expect(hits).toBe(2);
    expect(lookup).toHaveBeenCalledTimes(2); // looked up again for every connection
  });
});

describe("several links in one hand-in", () => {
  it("splits links on spaces and new lines and keeps them in order", () => {
    expect(pageLinksFrom(" https://a.example/one\nhttps://b.example/two   http://localhost:3000/demo/listings/townpages.html#top \r\n")).toEqual(["https://a.example/one", "https://b.example/two", "http://localhost:3000/demo/listings/townpages.html"]);
  });
  it("refuses none, more than 10, a link that is not a web link, and the same link twice", () => {
    expect(() => pageLinksFrom("  \n ")).toThrow("Please paste at least one link, starting with https://");
    expect(() => pageLinksFrom(Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`).join("\n"))).toThrow("Please hand in 10 links at most. You pasted 11.");
    expect(() => pageLinksFrom("https://a.example/one\nwww.b.example")).toThrow("This is not a full link: www.b.example. Each link has to start with https://");
    expect(() => pageLinksFrom("https://a.example/one\njavascript:alert(1)")).toThrow("This is not a full link");
    expect(() => pageLinksFrom("https://a.example/one https://A.example/one#part")).toThrow("This link is there twice: https://a.example/one. Please paste each link once.");
    expect(pageLinksFrom(Array.from({ length: 10 }, (_, i) => `https://a.example/${i}`).join(" "))).toHaveLength(10);
  });
});
