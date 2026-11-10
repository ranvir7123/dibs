"use client";

import Link from "next/link";
import { Icon } from "./Icon";

/** What a person sees when a page could not be drawn: plain words and a way forward. */
export function ErrorPanel({ retry }: { retry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <span className="ic" style={{ color: "var(--stop)" }}>
        <Icon name="warn" />
      </span>
      <h3>This page did not load</h3>
      <p>Something went wrong on our side. Your money and your work are not affected. Try again in a moment.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>
        <button type="button" className="btn main-b" style={{ marginTop: 0 }} onClick={() => (retry ? retry() : window.location.reload())}>
          Try again
        </button>
        <Link href="/" className="btn ghost" style={{ marginTop: 0 }}>
          Back to the jobs
        </Link>
      </div>
    </div>
  );
}
