import { formatCents } from "@/contract/money";
import type { MoneyMove } from "@/contract/types";
import { dayMonth, timeOfDay } from "./format";
import { Icon } from "./Icon";

/** Payouts as rows: what it was for, when, PayPal's reference, and the amount. Goes inside a ".panel.rows". */
export function PayoutRows({ payouts }: { payouts: MoneyMove[] }) {
  return (
    <>
      {payouts.map((move) => {
        const failed = move.status === "failed";
        const pending = move.status === "pending";
        return (
          <div key={move.id}>
            <span className="avatar" style={{ background: "var(--inset)", color: failed ? "var(--stop)" : pending ? "var(--mute)" : "var(--paid)" }} aria-hidden="true">
              <Icon name={failed ? "warn" : pending ? "clock" : "ok"} />
            </span>
            <span className="grow">
              <b>{move.note.replace(/^Dibs:\s*/, "")}</b>
              <span className="num">
                {dayMonth(move.createdAt)}, {timeOfDay(move.createdAt)}
                {move.paypalRef ? `. PayPal reference ${move.paypalRef}` : ""}
                {failed ? `. ${move.error ?? "PayPal could not send this."} It will be tried again.` : ""}
                {pending ? ". On its way." : ""}
              </span>
            </span>
            <span className={failed || pending ? "amt" : "amt p"}>
              {formatCents(move.amountCents)}
              <small>{failed ? "Not sent" : pending ? "Sending" : "Sent"}</small>
            </span>
          </div>
        );
      })}
    </>
  );
}
