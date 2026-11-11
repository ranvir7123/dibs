"use client";

import { useActionState, useState } from "react";
import { endThisJob, type FormState } from "@/app/(site)/actions";
import { Icon } from "./Icon";
import { Notice } from "./States";

const start: FormState = { error: null };

/**
 * For the poster only: end the job now. Asks once more before doing it,
 * because it cannot be undone. Workers are paid what they have earned first;
 * the rest of the held money is let go.
 */
export function EndJob({ jobId, heldLabel }: { jobId: string; heldLabel: string }) {
  const [state, action, pending] = useActionState(endThisJob, start);
  const [asking, setAsking] = useState(false);

  return (
    <div className="panel todo" style={{ borderTop: "1px solid var(--line)", marginBottom: 20 }}>
      <p>
        <b>{asking ? "End this job now?" : "Finished with this job?"}</b>
        {asking
          ? `Results get one last check and are paid what they earned. The rest of the ${heldLabel} still held is let go by PayPal and never leaves you. This cannot be undone.`
          : `End it whenever you like. Whatever has not been earned is let go by PayPal and never leaves you.`}
      </p>
      {asking ? (
        <form action={action} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="hidden" name="jobId" value={jobId} />
          <button type="button" className="btn ghost" disabled={pending} onClick={() => setAsking(false)}>
            Keep it open
          </button>
          <button className="btn main-b" disabled={pending}>
            <Icon name="ok" />
            {pending ? "Ending. Paying what was earned…" : "Yes, end it"}
          </button>
        </form>
      ) : (
        <button type="button" className="btn ghost" onClick={() => setAsking(true)}>
          End this job
        </button>
      )}
      {state.error ? (
        <div style={{ flex: "1 1 100%" }}>
          <Notice kind={state.notReady ? "warn" : "stop"}>{state.error}</Notice>
        </div>
      ) : null}
    </div>
  );
}
