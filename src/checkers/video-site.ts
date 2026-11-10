/**
 * Reads a public video's numbers from the video site (YouTube).
 *
 * With YOUTUBE_API_KEY set, it asks the site's official address. Without a
 * key, or if the key is refused, it reads the public page itself, the same
 * page anyone sees in a browser. Plain code, no AI: numbers must be exact.
 */

export interface VideoStats {
  videoId: string;
  views: number;
  /** Null when the owner hides likes, or the page did not show them. */
  likes: number | null;
  /** Null when comments are off, or (page reading) not shown as an exact number. */
  comments: number | null;
  /** Length of the video in seconds, when known. */
  seconds: number | null;
  /** Where the numbers came from. */
  source: "official" | "page";
}

/** The video's id from any usual YouTube link (watch, youtu.be, shorts, embed, live). Null when it is not one. */
export function videoIdFrom(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0])) id = parts[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** The plain public address of a video, which is what AI is given to watch. */
export function publicVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const NOT_PUBLIC = "This video is private, unlisted or removed. Only a public video can be checked.";

/** "PT4M13S" to 253. */
export function secondsFromIsoDuration(text: string): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(text);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

const count = (value: unknown): number | null => {
  const n = Number(value);
  return typeof value === "string" && value !== "" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** Reads the official address's answer. Throws NOT_PUBLIC when the video is not there or not public. */
export function statsFromOfficial(videoId: string, body: unknown): VideoStats {
  const item = (body as { items?: Array<Record<string, Record<string, unknown>>> }).items?.[0];
  if (!item || (item.status?.privacyStatus ?? "public") !== "public") throw new Error(NOT_PUBLIC);
  const views = count(item.statistics?.viewCount);
  if (views === null) throw new Error("The video site did not give a view count for this video.");
  return {
    videoId,
    views,
    likes: count(item.statistics?.likeCount),
    comments: count(item.statistics?.commentCount),
    seconds: typeof item.contentDetails?.duration === "string" ? secondsFromIsoDuration(item.contentDetails.duration) : null,
    source: "official",
  };
}

/** Reads the numbers out of the public page's own text. */
export function statsFromPage(videoId: string, html: string): VideoStats {
  const first = (pattern: RegExp) => pattern.exec(html)?.[1] ?? null;
  const playable = first(/"playabilityStatus":\{"status":"([A-Z_]+)"/);
  if (first(/"isPrivate":(true|false)/) === "true" || first(/"isUnlisted":(true|false)/) === "true" || (playable !== null && playable !== "OK")) {
    throw new Error(NOT_PUBLIC);
  }
  const views = count(first(/"viewCount":"(\d+)"/));
  if (views === null) throw new Error("The video's page did not show a view count. The video may be private or removed.");
  return {
    videoId,
    views,
    likes: count(first(/"likeCount":"?(\d+)"?/)),
    comments: null, // the page only shows a rounded number ("10M"), so it is not used
    seconds: count(first(/"lengthSeconds":"(\d+)"/)),
    source: "page",
  };
}

type Fetch = typeof fetch;

async function readOfficial(videoId: string, key: string, get: Fetch): Promise<VideoStats | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,status,contentDetails&id=${videoId}&key=${encodeURIComponent(key)}`;
  const response = await get(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null; // key refused or quota used up: the page is read instead
  return statsFromOfficial(videoId, await response.json());
}

async function readPage(videoId: string, get: Fetch): Promise<VideoStats> {
  const response = await get(publicVideoUrl(videoId), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`The video site did not answer (error ${response.status}). It will be tried again.`);
  return statsFromPage(videoId, await response.text());
}

/**
 * The views, likes and comments of a public video, read from the video site.
 * Throws a plain sentence when the link is not a video we can read.
 */
export async function readVideoStats(link: string, get: Fetch = fetch): Promise<VideoStats> {
  const videoId = videoIdFrom(link);
  if (!videoId) throw new NotAVideoLink();
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (key) {
    const official = await readOfficial(videoId, key, get);
    if (official) return official;
  }
  return readPage(videoId, get);
}

/** The hand-in link is not a video Dibs can read. The message is shown to the worker. */
export class NotAVideoLink extends Error {
  constructor() {
    super("This link is not a video we can read. Please hand in the link to a public YouTube video.");
    this.name = "NotAVideoLink";
  }
}

export type VideoReader = (link: string) => Promise<VideoStats>;
const holder = globalThis as unknown as { __dibsVideoReader?: VideoReader | null };
/** The video reader in use. Tests swap it for a stand-in. */
export const getVideoReader = (): VideoReader => holder.__dibsVideoReader ?? ((link) => readVideoStats(link));
export function useVideoReader(reader: VideoReader | null): void {
  holder.__dibsVideoReader = reader;
}
