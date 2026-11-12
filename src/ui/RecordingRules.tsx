"use client";

import { useRef, useState } from "react";
import { clock } from "./format";
import { Icon } from "./Icon";
import { PageLinks } from "./PageLinks";

export interface SeenRule {
  key: string;
  label: string;
  reason: string;
  passed: boolean;
  /** The moment in the recording, in seconds. Null when the checker never saw it. */
  seenAtSeconds: number | null;
  /** A short title saying why it did not count, such as "Already known: ...". Null when there is none. */
  headline?: string | null;
}

/**
 * The recording and the rules the checker saw in it, side by side.
 * Tapping a rule moves the recording to the moment that rule was met.
 * `fileUrl` is only set when the file can be opened in the browser.
 * `looks` says what the file is: a recording is played, a photo is shown,
 * and anything else (a PDF, a text file) is a plain link.
 */
export function RecordingRules({
  rules,
  mediaSeconds,
  fileUrl,
  title,
  looks = "video",
  links = [],
}: {
  rules: SeenRule[];
  mediaSeconds: number | null;
  fileUrl: string | null;
  title: string;
  /** "pages" is a hand-in of links that Dibs opened itself: the links are listed and no times are shown. */
  looks?: "video" | "photo" | "pdf" | "text" | "other" | "pages";
  /** The handed-in links, for looks "pages". */
  links?: string[];
}) {
  // Only a recording has moments. A photo or a document shows no times.
  const timed = looks === "video";
  const firstSeen = rules.find((rule) => rule.seenAtSeconds !== null) ?? null;
  const [chosen, setChosen] = useState<string | null>(firstSeen?.key ?? null);
  const at = rules.find((rule) => rule.key === chosen)?.seenAtSeconds ?? null;
  const video = useRef<HTMLVideoElement>(null);

  const along = at !== null && mediaSeconds ? Math.min(100, Math.max(0, (at / mediaSeconds) * 100)) : 0;

  function jumpTo(key: string, seconds: number) {
    setChosen(key);
    if (video.current) {
      video.current.currentTime = seconds;
      void video.current.play().catch(() => undefined);
    }
  }

  return (
    <>
      {looks === "pages" ? (
        <PageLinks links={links} />
      ) : (
      <div className="clip game">
        {fileUrl && looks === "photo" ? (
          // A plain picture tag: the photo comes from the hand-ins folder, not from the site's own pictures.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl} alt={`Photo handed in for ${title}`} />
        ) : fileUrl && looks !== "video" ? (
          <a className="mid" style={{ margin: "auto" }} href={fileUrl} target="_blank" rel="noopener noreferrer">
            Open the file
            <span className="hide"> handed in for {title} (opens in a new tab)</span>
          </a>
        ) : fileUrl ? (
          <video ref={video} src={fileUrl} controls preload="metadata" aria-label={`Recording handed in for ${title}`} />
        ) : (
          <>
            <div className="row">
              <span className="chip-d">Screen recording</span>
              {mediaSeconds ? (
                <span className="chip-d num">
                  {clock(at ?? 0)} / {clock(mediaSeconds)}
                </span>
              ) : null}
            </div>
            <span className="mid">{at !== null ? `Play from ${clock(at)}` : "Recording handed in"}</span>
            <div>
              <div className="scrub" aria-hidden="true">
                <i style={{ marginLeft: `${along}%` }} />
              </div>
            </div>
          </>
        )}
      </div>
      )}

      <div className="rules">
        <h3>What the checker saw</h3>
        {rules.map((rule) => {
          const inside = (
            <>
              <Icon name={rule.passed ? "ok" : "no"} />
              <p>
                {rule.label}
                {rule.headline ? <b className="why-not">{rule.headline.replace(/\.$/, "")}</b> : null}
                <small>{rule.reason}</small>
              </p>
              {timed ? <time>{clock(rule.seenAtSeconds)}</time> : null}
            </>
          );
          const seconds = rule.seenAtSeconds;
          if (seconds === null || !timed) {
            return (
              <div key={rule.key} className={rule.passed ? "rule" : "rule no"}>
                {inside}
              </div>
            );
          }
          const classes = ["rule", rule.passed ? "" : "no", chosen === rule.key ? "on" : ""].filter(Boolean).join(" ");
          return (
            <button key={rule.key} type="button" className={classes} aria-pressed={chosen === rule.key} onClick={() => jumpTo(rule.key, seconds)}>
              {inside}
            </button>
          );
        })}
      </div>
    </>
  );
}
