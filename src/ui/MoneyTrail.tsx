"use client";

/**
 * A job's money trail: locked, each payment, released, oldest first, each line
 * with PayPal's own reference. Above it, the date PayPal's hold ends.
 *
 *   <MoneyTrail trail={await getMoneyTrail(job.id)} />
 */
import { formatCents } from "@/contract/money";
import type { MoneyTrail as Trail, MoneyTrailStep } from "@/contract/types";
import { dayMonth, longDay, timeOfDay } from "./format";

const TITLE: Record<MoneyTrailStep["kind"], string> = { locked: "Locked", payment: "Paid", released: "Released" };

function Line({ step }: { step: MoneyTrailStep }) {
  const pending = step.status === "pending";
  const title = step.kind === "payment" && pending ? "Paying" : step.kind === "released" && pending ? "Releasing" : TITLE[step.kind];
  return (
    <div style={{ flexWrap: "wrap" }}>
      <span className={`pill ${step.kind === "payment" && !pending ? "paid" : pending ? "wait" : "held"}`} style={{ flex: "none", minWidth: 92, justifyContent: "center" }}>
        {title}
      </span>
      {/* On a phone the words drop under the label instead of being squeezed beside it. */}
      <span className="grow" style={{ flex: "1 1 220px" }}>
        <b style={{ overflowWrap: "anywhere" }}>{step.what}</b>
        <span className="num" style={{ overflowWrap: "anywhere" }}>
          {dayMonth(step.when)}, {timeOfDay(step.when)}
          {step.paypalRef ? `. PayPal reference ${step.paypalRef}` : ". PayPal has not given a reference yet"}
          {step.takeRef ? `. Taken from the hold: ${step.takeRef}` : ""}
        </span>
      </span>
      <span className={step.kind === "payment" && !pending ? "amt p" : "amt"} style={{ marginLeft: "auto" }}>
        {formatCents(step.amountCents)}
        <small>{pending ? "On its way" : step.kind === "locked" ? "Held" : step.kind === "payment" ? "Sent" : "Let go"}</small>
      </span>
    </div>
  );
}

export default function MoneyTrail({ trail }: { trail: Trail }) {
  if (!trail.steps.length) {
    return (
      <p className="notice" role="status">
        No money has been locked for this job yet, so there is nothing to show.
      </p>
    );
  }
  const released = trail.steps.some((step) => step.kind === "released" && step.status === "done");
  return (
    <div className="stack">
      {trail.holdEndsAt && !released ? (
        <p className="kv">
          <span>PayPal&rsquo;s hold ends</span>
          <b>{longDay(trail.holdEndsAt)}</b>
        </p>
      ) : null}
      <div className="panel rows">
        {trail.steps.map((step) => (
          <Line key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}
