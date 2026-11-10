"use client";

import { useRef, useState } from "react";
import { clock } from "./format";
import { Icon } from "./Icon";

export interface SeenRule {
  key: string;
  label: string;
  reason: string;
  passed: boolean;
  /** The moment in the recording, in seconds. Null when the checker never saw it. */
  seenAtSeconds: number | null;
}

/**
 * The recording and the rules the checker saw in it, side by side.
 * Tapping a rule moves the recording to the moment that rule was met.
 * `fileUrl` is only set when the file can be played in the browser.
 */
export function RecordingRules({ rules, mediaSeconds, fileUrl, title }: { rules: SeenRule[]; mediaSeconds: number | null; fileUrl: string | null; title: string }) {
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
      <div className="clip game">
        {fileUrl ? (
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

      <div className="rules">
        <h3>What the checker saw</h3>
        {rules.map((rule) => {
          const inside = (
            <>
              <Icon name={rule.passed ? "ok" : "no"} />
              <p>
                {rule.label}
                <small>{rule.reason}</small>
              </p>
              <time>{clock(rule.seenAtSeconds)}</time>
            </>
          );
          const seconds = rule.seenAtSeconds;
          if (seconds === null) {
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
