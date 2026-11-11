"use client";

import Link from "next/link";
import { useActionState } from "react";
import { holdMoney, type FormState } from "@/app/(site)/actions";
import { Icon } from "./Icon";
import { Notice } from "./States";

const start: FormState = { error: null };

/**
 * The foot of a draft job card: lock the money with PayPal, or go back and change the card.
 * `bare` leaves out the "Change the card" link and the line under it, for when the page draws those itself.
 */
export function HoldForm({ jobId, amount, bare = false }: { jobId: string; amount: string; bare?: boolean }) {
  const [state, action, pending] = useActionState(holdMoney, start);
  return (
    <>
      {state.error ? (
        <Notice kind={state.notReady ? "warn" : "stop"} title={state.notReady ? "PayPal isn't connected yet" : undefined}>
          {state.error}
        </Notice>
      ) : null}
      <form action={action} className="btns">
        <input type="hidden" name="jobId" value={jobId} />
        <button className="btn main-b" disabled={pending}>
          <Icon name="lock" />
          {pending ? "Opening PayPal…" : `Hold ${amount} with PayPal`}
        </button>
        {bare ? null : (
          <Link href={`/post?from=${jobId}`} className="btn ghost">
            Change the card
          </Link>
        )}
      </form>
      {bare ? null : <p>PayPal holds the money. You&apos;re charged only for results.</p>}
    </>
  );
}
