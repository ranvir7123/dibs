import { videoIdFrom } from "@/checkers/video-site";

/** The picture shown behind "Open the video" on a result card. */
export interface Cover {
  src: string;
  /** "youtube": the video's own picture from YouTube. "sample": a stand-in photo for a made-up sample video. */
  from: "youtube" | "sample";
}

/**
 * The made-up sample videos have no real picture, so each gets a free-to-use
 * photo that fits its job. Where each photo came from: public/demo/thumbs/SOURCES.md
 */
const SAMPLE_COVERS: Record<string, string> = {
  "https://video.example.com/watch/aarav-kettle-launch": "/demo/thumbs/teapot-cup.jpg",
  "https://video.example.com/watch/meera-kettle-launch": "/demo/thumbs/white-teapot.jpg",
  "https://video.example.com/watch/kabir-kettle-launch": "/demo/thumbs/kettle-hand.jpg",
  "https://video.example.com/watch/isha-kettle-launch": "/demo/thumbs/glass-teapot.jpg",
};

/**
 * The cover picture for a handed-in video link, or null when there is none
 * (then the box stays plain dark). A YouTube link gets that video's own picture.
 */
export function coverFor(link: string | null | undefined): Cover | null {
  const clean = link?.trim();
  if (!clean) return null;
  const sample = SAMPLE_COVERS[clean];
  if (sample) return { src: sample, from: "sample" };
  const videoId = videoIdFrom(clean);
  return videoId ? { src: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, from: "youtube" } : null;
}
