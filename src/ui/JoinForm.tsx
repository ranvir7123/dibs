"use client";

import { useActionState } from "react";
import { joinUp, type FormState } from "@/app/(site)/actions";
import { Notice } from "./States";

const start: FormState = { error: null };

/** Join with a name and the email your PayPal uses. No password. */
export function JoinForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(joinUp, start);
  return (
    <form action={action} className="form" key={`${state.typedName ?? ""}|${state.typedEmail ?? ""}`}>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="join-name">Your name or your business&apos;s name</label>
        <input id="join-name" name="name" className="input" maxLength={60} required autoComplete="name" placeholder="Like Kettle & Clove" defaultValue={state.typedName ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="join-email">The email your PayPal uses</label>
        <input id="join-email" name="paypalEmail" type="email" className="input" required autoComplete="email" placeholder="you@example.com" defaultValue={state.typedEmail ?? ""} />
        <small>Pay is sent to this email. If you have joined before, the same email brings you back.</small>
      </div>
      {state.error ? <Notice kind="stop">{state.error}</Notice> : null}
      <button className="btn main-b" disabled={pending}>
        {pending ? "Joining…" : "Join Dibs"}
      </button>
    </form>
  );
}
