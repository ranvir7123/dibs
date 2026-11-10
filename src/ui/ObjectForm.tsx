"use client";

import { useActionState } from "react";
import { objectTo, type FormState } from "@/app/(site)/actions";

const start: FormState = { error: null };

/** For the poster only: object to AI's opinion before it is paid. */
export function ObjectForm({ resultId }: { resultId: string }) {
  const [state, action, pending] = useActionState(objectTo, start);
  return (
    <form action={action}>
      <input type="hidden" name="resultId" value={resultId} />
      <button className="btn ghost" disabled={pending}>
        {pending ? "Sending…" : "I object to this"}
      </button>
      {state.error ? (
        <p role="alert" className="ref" style={{ color: "var(--stop)", marginTop: 8 }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
