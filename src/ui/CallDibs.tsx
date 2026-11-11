"use client";

import { useActionState } from "react";
import { callDibsOn, type FormState } from "@/app/(site)/actions";

const start: FormState = { error: null };

/** The "Call dibs" button on a job card. Says why in plain words if the job could not be taken. */
export function CallDibs({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(callDibsOn, start);
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="jobId" value={jobId} />
      <button className="btn main-b" disabled={pending}>
        {pending ? "Calling dibs…" : "Call dibs"}
      </button>
      {state.error ? (
        <p role="alert" style={{ fontSize: 14, lineHeight: "20px", color: "var(--stop-text)" }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
