"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { handInLink, type FormState } from "@/app/(site)/actions";
import { HAND_IN_ENDINGS, MAX_PHOTO_OR_PDF_BYTES, maxBytesFor } from "./handin";
import { Icon } from "./Icon";
import { Notice } from "./States";

const start: FormState = { error: null };

/**
 * Handing in a link, for jobs checked from a public page such as a posted video.
 * `several` is for jobs where Dibs opens each page itself: the box then takes up to 10 links, one per line.
 */
export function HandInLinkForm({ claimId, current, several = false }: { claimId: string; current: string | null; several?: boolean }) {
  const [state, action, pending] = useActionState(handInLink, start);
  return (
    <form action={action} className="form">
      <input type="hidden" name="claimId" value={claimId} />
      {several ? (
        <div className="field">
          <label htmlFor="hand-url">The links to the pages</label>
          <textarea
            id="hand-url"
            name="url"
            inputMode="url"
            className="input"
            // The same box as a single link, made tall enough for a list.
            style={{ height: "auto", minHeight: 144, padding: "12px 16px", lineHeight: "24px", resize: "vertical" }}
            rows={5}
            required
            placeholder="https://"
            defaultValue={state.typed ?? current ?? ""}
            key={state.typed ?? "first"}
            autoComplete="off"
            spellCheck={false}
          />
          <small>Paste the links, one per line. Dibs opens each page itself.</small>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="hand-url">The link to what you posted</label>
          <input
            id="hand-url"
            name="url"
            type="url"
            inputMode="url"
            className="input"
            required
            placeholder="https://"
            defaultValue={state.typed ?? current ?? ""}
            key={state.typed ?? "first"}
            autoComplete="off"
          />
          <small>It has to be public, so the checker can open it.</small>
        </div>
      )}
      {state.error ? <Notice kind={state.notReady ? "warn" : "stop"}>{state.error}</Notice> : null}
      <button className="btn main-b" disabled={pending}>
        <Icon name="link" />
        {pending ? "Handing in…" : several ? (current ? "Replace the links" : "Hand in the links") : current ? "Replace the link" : "Hand in the link"}
      </button>
    </form>
  );
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;

/** Handing in a file, for jobs where AI looks at a recording or a photo, or reads a document. */
export function HandInFileForm({ claimId, hasFile, maxBytes }: { claimId: string; hasFile: boolean; maxBytes: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState<number | null>(null); // percent while sending, null when idle
  const [problem, setProblem] = useState<{ text: string; notReady: boolean } | null>(null);

  function choose(chosen: File | null) {
    setProblem(null);
    // A photo or a PDF has a smaller limit than a recording.
    const limit = chosen ? Math.min(maxBytes, maxBytesFor(chosen.name)) : maxBytes;
    if (chosen && chosen.size > limit) {
      setFile(null);
      setProblem({
        text: `That file is ${megabytes(chosen.size)}. The most Dibs can take ${limit < maxBytes ? "for a photo or a PDF " : ""}is ${megabytes(limit)}.`,
        notReady: false,
      });
      return;
    }
    setFile(chosen);
  }

  function send() {
    if (!file || sent !== null) return;
    setProblem(null);
    setSent(0);
    // A plain request with the file as its body, so the browser can report how much has gone.
    const request = new XMLHttpRequest();
    request.open("POST", `/work/${claimId}/upload`);
    request.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    request.setRequestHeader("content-type", "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setSent(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => {
      setSent(null);
      setProblem({ text: "The file did not get through. Check your connection and try again.", notReady: false });
    };
    request.onload = () => {
      setSent(null);
      let answer: { error?: string; notReady?: boolean } = {};
      try {
        answer = JSON.parse(request.responseText) as typeof answer;
      } catch {
        // Not our own answer (for example the file was too big for the server): fall through to the plain message.
      }
      if (request.status >= 200 && request.status < 300) {
        router.push(`/work?handed=${encodeURIComponent(claimId)}`);
        return;
      }
      setProblem({ text: answer.error ?? "The file did not get through. Please try again.", notReady: answer.notReady === true });
    };
    request.send(file);
  }

  return (
    <div className="form">
      <label
        className="drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          choose(event.dataTransfer.files[0] ?? null);
        }}
      >
        <Icon name={file ? "file" : "upload"} />
        <b>{file ? file.name : "Choose your file, or drop it here"}</b>
        <small>{file ? megabytes(file.size) : `A recording up to ${megabytes(maxBytes)}, or a photo, PDF or text file up to ${megabytes(MAX_PHOTO_OR_PDF_BYTES)}`}</small>
        <input ref={input} type="file" className="hide" accept={HAND_IN_ENDINGS} onChange={(event) => choose(event.target.files?.[0] ?? null)} />
      </label>
      {problem ? <Notice kind={problem.notReady ? "warn" : "stop"}>{problem.text}</Notice> : null}
      <button type="button" className="btn main-b" disabled={!file || sent !== null} onClick={send}>
        <Icon name="upload" />
        {sent !== null ? `Sending… ${sent}%` : hasFile ? "Replace the file" : "Hand in the file"}
      </button>
    </div>
  );
}

/** A link the worker shares, with a button that copies it. */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLElement>(null);
  return (
    <div className="linkbox">
      <Icon name="link" />
      <code ref={box}>{url}</code>
      <button
        type="button"
        className="btn ghost small"
        onClick={() => {
          // Some browsers refuse (a page not on https, or permission denied). Then the link is selected instead, ready to copy by hand.
          const selectIt = () => {
            const code = box.current;
            if (!code) return;
            const range = document.createRange();
            range.selectNodeContents(code);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          };
          if (!navigator.clipboard) return selectIt();
          navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }, selectIt);
        }}
      >
        <Icon name={copied ? "ok" : "copy"} />
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
