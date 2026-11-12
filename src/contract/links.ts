/**
 * Links a worker hands in for a job where Dibs opens each page itself.
 * Plain code with no imports that need a server, so it is safe to use anywhere.
 */
import type { CheckerSpec } from "./types";

/** The most links one hand-in may hold. */
export const MAX_PAGE_LINKS = 10;

/** True for a job where the worker hands in links and Dibs opens each page itself. */
export function dibsOpensPages(checker: Pick<CheckerSpec, "evidence" | "handIn">): boolean {
  return checker.handIn === "link" && checker.evidence.includes("live_site");
}

function webLink(text: string): URL | null {
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url : null;
  } catch {
    return null;
  }
}

/**
 * Splits what a worker pasted into separate links (one per line, or with
 * spaces between them). Throws one plain sentence when there are none, more
 * than 10, one that is not a full web link, or the same link twice.
 */
export function pageLinksFrom(pasted: string): string[] {
  const parts = pasted.split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error("Please paste at least one link, starting with https://");
  if (parts.length > MAX_PAGE_LINKS) throw new Error(`Please hand in ${MAX_PAGE_LINKS} links at most. You pasted ${parts.length}.`);
  const links: string[] = [];
  for (const part of parts) {
    const url = webLink(part);
    if (!url) throw new Error(`This is not a full link: ${part.slice(0, 80)}. Each link has to start with https://`);
    url.hash = ""; // the part after # never changes which page is opened
    if (links.includes(url.href)) throw new Error(`This link is there twice: ${url.href.slice(0, 80)}. Please paste each link once.`);
    links.push(url.href);
  }
  return links;
}

/**
 * One tidy form of a page's address, used to tell whether two links are the
 * same page: small letters for the site's name, no "www.", no port when it is
 * the usual one, no "/" at the end, and nothing after "?" or "#". The text
 * itself is returned, in small letters, when it is not a web link.
 */
export function tidyAddress(link: string): string {
  const url = webLink(link.trim());
  if (!url) return link.trim().toLowerCase();
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const usualPort = url.port === "" || (url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${usualPort ? "" : `:${url.port}`}${path}`;
}

/** The links kept in a result's hand-in text, one per line. */
export function storedPageLinks(handInUrl: string | null): string[] {
  return (handInUrl ?? "").split(/\s+/).filter(Boolean);
}
