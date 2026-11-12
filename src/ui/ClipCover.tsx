"use client";

import { useCallback, useState } from "react";
import type { Cover } from "./cover";

/**
 * The cover picture behind a video box. It only shows once it has really
 * loaded: if it fails, the box looks as it does with no picture. YouTube
 * answers a missing video with a tiny grey stand-in (120 wide), which is
 * treated as "no picture" too.
 */
export function ClipCover({ cover }: { cover: Cover }) {
  const [state, setState] = useState<"wait" | "ok" | "bad">("wait");

  const judge = useCallback(
    (img: HTMLImageElement | null) => {
      // A picture that finished before this code woke up is judged here.
      if (!img || !img.complete) return;
      setState(img.naturalWidth > (cover.from === "youtube" ? 120 : 0) ? "ok" : "bad");
    },
    [cover.from],
  );

  if (state === "bad") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small picture from YouTube or our own folder; no resizing needed
    <img
      ref={judge}
      className={`cover ${cover.from}${state === "ok" ? " ok" : ""}`}
      src={cover.src}
      alt=""
      aria-hidden="true"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={(event) => judge(event.currentTarget)}
      onError={() => setState("bad")}
    />
  );
}
