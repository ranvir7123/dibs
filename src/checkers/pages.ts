/**
 * Dibs opens a public web page itself and reads its words.
 *
 * A worker hands in only a link. Dibs fetches the page from its own server,
 * so nobody can fake it with a screenshot. Because the link is typed by a
 * stranger, the page is opened carefully:
 *  - only http and https links;
 *  - never an address inside a private network or on this machine. The
 *    address is checked at the very moment of connecting, so a site cannot
 *    show a public address for the check and a private one for the visit;
 *  - at most 3 redirects, each one checked the same way;
 *  - 10 seconds at most, and 1.5 MB at most;
 *  - only pages made of text.
 *
 * Every failure is an Error whose message is one plain sentence that is safe
 * to show the worker.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

/** A page Dibs opened, turned into plain words. */
export interface PublicPage {
  /** The link that was handed in. */
  url: string;
  /** Where it ended up after any redirects. */
  finalUrl: string;
  /** The page's own title, or empty text when it has none. */
  title: string;
  /** The words on the page, with scripts and tags removed. */
  text: string;
  /** True when the page had more words than Dibs keeps, so the end was left off. */
  cut: boolean;
}

/** Looks a host name up and returns the addresses it points at. */
export type HostLookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

/**
 * Stand-ins for the network, so tests need none.
 * fetch: replaces the real request. The host name is then looked up and checked just before each call.
 * lookup: replaces the real name lookup. Without a stand-in fetch, it is used at the moment of connecting.
 */
export interface PageTools {
  fetch?: (link: string, options: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  lookup?: HostLookup;
}

export const PAGE_TIMEOUT_MS = 10_000;
export const PAGE_MAX_BYTES = 1_500_000;
export const PAGE_MAX_REDIRECTS = 3;
/** The most characters of one page that are kept. */
export const PAGE_TEXT_LIMIT = 40_000;

const NOT_PUBLIC = "Dibs only opens public web pages.";
const TOO_SLOW = "Dibs could not open this page (it took longer than 10 seconds).";
const NO_ANSWER = "Dibs could not open this page (the site did not answer).";
const TOO_BIG = "Dibs could not read this page (it is bigger than 1.5 MB).";

const realLookup: HostLookup = (host) => dnsLookup(host, { all: true });

/** True when local addresses are allowed, which is only for proving the feature on a laptop. */
const localAllowed = () => process.env.DIBS_ALLOW_LOCAL_PAGES?.trim() === "1";

function isPublicV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return false; // "this network", private, this machine
  if (a === 100 && b >= 64 && b <= 127) return false; // shared between an internet provider's customers
  if (a === 169 && b === 254) return false; // link-local (also where cloud hosts keep their secrets)
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // reserved, and addresses for examples
  if (a === 198 && (b === 18 || b === 19)) return false; // for testing networks
  if (a === 198 && b === 51 && c === 100) return false; // addresses for examples
  if (a === 203 && b === 0 && c === 113) return false; // addresses for examples
  if (a >= 224) return false; // group addresses and reserved
  return true;
}

/** An IPv6 address as its 8 numbers, or null when it cannot be read. */
function v6Groups(address: string): number[] | null {
  let text = address.split("%")[0].toLowerCase(); // drop a zone name such as %eth0
  // An IPv4 address written at the end ("::ffff:10.0.0.1") becomes two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) => (part ? part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN)) : []);
  const head = read(halves[0]);
  const end = halves.length === 2 ? read(halves[1]) : [];
  const gap = halves.length === 2 ? 8 - head.length - end.length : 0;
  if (gap < 0) return null;
  const groups = [...head, ...new Array<number>(gap).fill(0), ...end];
  return groups.length === 8 && groups.every((n) => Number.isInteger(n)) ? groups : null;
}

function isPublicV6(address: string): boolean {
  const g = v6Groups(address);
  if (!g) return false;
  const v4Inside = () => isPublicV4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // "::" and "::1" (this machine), or an IPv4 address wrapped in IPv6.
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return false;
    return v4Inside();
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Inside(); // IPv4 reached through a translator
  if (g[0] === 0x2002) return isPublicV4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // IPv4 carried inside IPv6
  if ((g[0] & 0xfe00) === 0xfc00) return false; // private
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // old private range
  if ((g[0] & 0xff00) === 0xff00) return false; // group addresses
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // addresses for examples
  return true;
}

/** True when an address is out on the public internet: not this machine, not a private or reserved range. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address.split("%")[0]);
  return kind === 4 ? isPublicV4(address) : kind === 6 ? isPublicV6(address) : false;
}

const NOT_FOUND = "Dibs could not find this site. Please check the link.";

/** A refusal whose message is already a plain sentence for the worker. */
class Refused extends Error {}

/** The host of a link without the [ ] that wrap an IPv6 address. */
const bareHost = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");

/**
 * Refuses a link that is not a web address, or whose host is written as a
 * private address. A host written as a name is checked later, when its
 * addresses are known. Returns the link parsed.
 */
function publicLink(link: string): URL {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error(NOT_PUBLIC);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(NOT_PUBLIC);
  if (url.username || url.password) throw new Error(NOT_PUBLIC);
  const host = bareHost(url);
  if (!host) throw new Error(NOT_PUBLIC);
  if (!localAllowed() && isIP(host) && !isPublicAddress(host)) throw new Error(NOT_PUBLIC);
  return url;
}

/**
 * The addresses a host name points at, all checked. Every one must be public,
 * or a name could point at a public and a private address and slip through.
 */
async function checkedAddresses(host: string, lookup: HostLookup): Promise<Array<{ address: string; family: number }>> {
  let found: Array<{ address: string; family: number }>;
  try {
    found = await lookup(host);
  } catch {
    throw new Refused(NOT_FOUND);
  }
  if (found.length === 0) throw new Refused(NOT_FOUND);
  if (!localAllowed() && !found.every((entry) => isPublicAddress(entry.address))) throw new Refused(NOT_PUBLIC);
  return found;
}

/**
 * The name lookup handed to the connection itself. The connection can only
 * go to an address this function returns, and it only returns addresses it
 * has just checked. (It is not called when the host is written as an address;
 * publicLink has already checked those.)
 */
function checkingLookup(lookup: HostLookup): LookupFunction {
  return (hostname, options, callback) => {
    checkedAddresses(hostname, lookup).then(
      (found) => {
        const family = typeof options.family === "number" ? options.family : 0;
        const fitting = family === 4 || family === 6 ? found.filter((entry) => entry.family === family) : found;
        if (fitting.length === 0) return callback(new Refused(NOT_FOUND), "", 0);
        if (options.all) callback(null, fitting);
        else callback(null, fitting[0].address, fitting[0].family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Refused(NOT_FOUND), "", 0),
    );
  };
}

/**
 * The real request. It uses Node's own http and https with the checking
 * lookup above, and a fresh connection every time, so no earlier connection
 * to an unchecked address can be reused.
 */
function pinnedRequest(lookup: HostLookup): NonNullable<PageTools["fetch"]> {
  return (link, options) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(link);
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = send(url, { method: "GET", headers: options.headers, signal: options.signal, lookup: checkingLookup(lookup), agent: false }, (answer) => {
        try {
          const status = answer.statusCode ?? 0;
          const headers = new Headers();
          for (const [name, value] of Object.entries(answer.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          // Some answers never carry a page (such as "nothing changed").
          const empty = status < 200 || status === 204 || status === 205 || status === 304;
          if (empty) answer.resume();
          resolve(new Response(empty ? null : (Readable.toWeb(answer) as ReadableStream<Uint8Array>), { status: status >= 200 && status <= 599 ? status : 502, headers }));
        } catch (error) {
          answer.destroy();
          reject(error);
        }
      });
      request.on("error", reject);
      request.end();
    });
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', copy: "(c)", middot: "·", bull: "·" };

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d{1,7});/g, (whole, digits: string) => codePoint(Number(digits)) ?? whole)
    .replace(/&#x([0-9a-f]{1,6});/gi, (whole, hex: string) => codePoint(parseInt(hex, 16)) ?? whole)
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/&amp;/gi, "&"); // last, so "&amp;lt;" stays as the text "&lt;"
}

function codePoint(n: number): string | null {
  if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff) return null;
  return n === 160 ? " " : String.fromCodePoint(n);
}

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/** Turns a page's HTML into its title and its plain words. */
export function wordsFromHtml(html: string): { title: string; text: string } {
  const title = squeeze(decodeEntities((/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "").replace(/<[^>]*>/g, " "))).slice(0, 200);
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Whole blocks that hold no words a visitor reads. An unclosed block is dropped to the end of the page.
    .replace(/<(script|style|noscript|template|title)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return { title, text: squeeze(decodeEntities(text)) };
}

/** Reads the page's bytes, stopping as soon as it is clearly too big. */
async function readBody(response: Response): Promise<Uint8Array> {
  const said = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(said) && said > PAGE_MAX_BYTES) throw new Error(TOO_BIG);
  if (!response.body) {
    const all = new Uint8Array(await response.arrayBuffer());
    if (all.byteLength > PAGE_MAX_BYTES) throw new Error(TOO_BIG);
    return all;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PAGE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(TOO_BIG);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const named = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(named).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes); // a character set this machine does not know
  }
}

/**
 * Opens one public web page and returns its words.
 * Throws an Error with one plain sentence when the page cannot be opened or read.
 */
export async function readPublicPage(link: string, tools: PageTools = {}): Promise<PublicPage> {
  const lookup = tools.lookup ?? realLookup;
  // The real path checks each address at the moment of connecting. A stand-in connects nowhere, so the name is checked just before it is called.
  const doFetch = tools.fetch ?? pinnedRequest(lookup);
  const checkNameFirst = tools.fetch !== undefined;
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // One clock for the whole job: looking the site up, every redirect, and reading the page.
  const tooSlow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop.abort();
      reject(new Error(TOO_SLOW));
    }, PAGE_TIMEOUT_MS);
  });
  const work = (async (): Promise<PublicPage> => {
    let url = publicLink(link.trim());
    const first = url.href;
    for (let hop = 0; ; hop++) {
      let response: Response;
      try {
        if (checkNameFirst && !isIP(bareHost(url))) await checkedAddresses(bareHost(url), lookup);
        response = await doFetch(url.href, {
          redirect: "manual",
          signal: stop.signal,
          headers: { accept: "text/html, text/plain;q=0.9", "accept-encoding": "identity", "user-agent": "DibsPageCheck/1.0" },
        });
      } catch (error) {
        if (error instanceof Refused) throw new Error(error.message);
        throw new Error(stop.signal.aborted ? TOO_SLOW : NO_ANSWER);
      }

      if (response.status >= 300 && response.status < 400) {
        const where = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!where) throw new Error(`Dibs could not open this page (error ${response.status}).`);
        if (hop >= PAGE_MAX_REDIRECTS) throw new Error("Dibs could not open this page (it sends visitors on too many times).");
        let next: string;
        try {
          next = new URL(where, url).href;
        } catch {
          throw new Error(NO_ANSWER);
        }
        url = publicLink(next); // a redirect must not lead somewhere private either; its name is checked on the next turn
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Dibs could not open this page (error ${response.status}).`);
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const kind = contentType.split(";")[0].trim();
      if (kind !== "text/html" && kind !== "text/plain") {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("Dibs can only read web pages made of text. This link is something else, such as a picture or a download.");
      }

      let raw: string;
      try {
        raw = decode(await readBody(response), contentType);
      } catch (error) {
        if (error instanceof Error && error.message === TOO_BIG) throw error;
        throw new Error(stop.signal.aborted ? TOO_SLOW : NO_ANSWER);
      }
      const { title, text } = kind === "text/html" ? wordsFromHtml(raw) : { title: "", text: squeeze(raw) };
      if (!text) throw new Error("Dibs opened this page but found no words on it. Pages that only show their words after loading cannot be read yet.");
      return { url: first, finalUrl: url.href, title, text: text.slice(0, PAGE_TEXT_LIMIT), cut: text.length > PAGE_TEXT_LIMIT };
    }
  })();
  work.catch(() => undefined); // if the clock wins, a late failure here must not go unhandled
  try {
    return await Promise.race([work, tooSlow]);
  } finally {
    clearTimeout(timer);
  }
}

export type PageReader = (link: string) => Promise<PublicPage>;
const holder = globalThis as unknown as { __dibsPageReader?: PageReader | null };

/** The page reader in use. Tests swap it for a stand-in that needs no network. */
export function getPageReader(): PageReader {
  return holder.__dibsPageReader ?? ((link) => readPublicPage(link));
}

/** Swaps the page reader for a stand-in (tests). Pass null to go back to the real one. */
export function usePageReader(reader: PageReader | null): void {
  holder.__dibsPageReader = reader;
}
