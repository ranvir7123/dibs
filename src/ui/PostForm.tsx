"use client";

import { useActionState, useRef, useState } from "react";
import { writeCard, type FormState } from "@/app/(site)/actions";
import { Icon } from "./Icon";
import { Notice } from "./States";

const start: FormState = { error: null };

/**
 * Posting a job, step one: the poster types what they want in one sentence.
 * The right-hand side shows where the job card will appear, that it is being
 * written, or why it could not be written.
 */
export function PostForm({ firstSentence, tries }: { firstSentence: string; tries: string[] }) {
  const [state, action, pending] = useActionState(writeCard, start);
  const [sentence, setSentence] = useState(firstSentence);
  const box = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="post">
      <form action={action} className="panel ask">
        <h1>
          <label htmlFor="sentence">What result do you want?</label>
        </h1>
        <textarea
          id="sentence"
          name="sentence"
          ref={box}
          className="typed"
          rows={4}
          maxLength={600}
          required
          autoFocus
          placeholder="I want 10,000 real views on our launch video in two weeks. I'll pay up to $50."
          value={sentence}
          onChange={(event) => setSentence(event.target.value)}
          aria-describedby="sentence-help"
        />
        <button className="btn main-b" disabled={pending || sentence.trim().length === 0}>
          <Icon name="spark" />
          {pending ? "Writing your job card…" : "Write the job card"}
        </button>
        <p id="sentence-help">Any kind of job works. If a result can&apos;t be checked by a machine, the card says so before you lock any money. Say the most you will pay, and include the link to your page if clicks or sales should count.</p>
        <h4>Other things people have asked for</h4>
        <div className="tries">
          {tries.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => {
                setSentence(idea);
                box.current?.focus();
              }}
            >
              <Icon name="spark" />
              {idea}
            </button>
          ))}
        </div>
      </form>

      <div className="panel" aria-live="polite">
        <div className="jc-wait">
          <span className="ic" style={state.error && !pending ? { color: state.notReady ? "var(--held)" : "var(--stop)" } : undefined}>
            <Icon name={state.error && !pending ? "warn" : "spark"} />
          </span>
          {pending ? (
            <>
              <h3>Writing your job card</h3>
              <p>AI is working out the finish line, how the result will be checked, and the pay. This takes a few seconds.</p>
            </>
          ) : state.error ? (
            <>
              <h3>{state.notReady ? "Job cards can't be written yet" : "That didn't work"}</h3>
              <p>{state.error}</p>
            </>
          ) : (
            <>
              <h3>Your job card appears here</h3>
              <p>You&apos;ll see the finish line, how it&apos;s checked, the cheat tests and the pay. You approve it before any money is locked.</p>
            </>
          )}
        </div>
        {state.error && !pending && !state.notReady ? (
          <div className="jc-foot" style={{ paddingTop: 0 }}>
            <Notice kind="info">Your sentence is still in the box. Change it and try again.</Notice>
          </div>
        ) : null}
      </div>
    </div>
  );
}
