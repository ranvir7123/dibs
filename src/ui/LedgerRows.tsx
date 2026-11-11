import { formatCents } from "@/contract/money";
import type { LedgerRow } from "@/db/ledger";
import { dayMonth, timeOfDay } from "./format";
import { Icon, type IconName } from "./Icon";

const WORD: Record<LedgerRow["kind"], string> = { locked: "Locked", paid: "Paid", released: "Released back", blocked: "Blocked", refunded: "Refunded" };
const ICON: Record<LedgerRow["kind"], IconName> = { locked: "lock", paid: "ok", released: "back", blocked: "shield", refunded: "back" };

/**
 * The ledger as plain rows, with no charts. Shown when the dashboard cannot
 * be drawn, so the money is never hidden behind a broken chart. Goes inside a ".panel.rows".
 */
export function LedgerRows({ rows }: { rows: LedgerRow[] }) {
  return (
    <>
      {rows.map((row) => {
        const when = new Date(row.when);
        const colour = row.kind === "blocked" || row.status === "failed" ? "var(--stop)" : row.kind === "paid" ? "var(--paid)" : "var(--mute)";
        return (
          <div key={row.id}>
            <span className="avatar" style={{ background: "var(--inset)", color: colour }} aria-hidden="true">
              <Icon name={row.status === "failed" ? "warn" : ICON[row.kind]} />
            </span>
            <span className="grow">
              <b>
                {WORD[row.kind]}
                {row.worker ? `: ${row.worker}` : ""}
                {row.measured ? `, ${row.measured}` : ""}
              </b>
              <span className="num">
                {row.job}. {dayMonth(when)}, {timeOfDay(when)}
                {row.paypalRef ? `. PayPal reference ${row.paypalRef}` : ""}
              </span>
            </span>
            <span className={row.kind === "paid" && row.status === "done" ? "amt p" : "amt"}>
              {formatCents(row.amountCents)}
              <small>{row.status === "failed" ? "Failed" : row.status === "pending" ? "On its way" : row.kind === "blocked" ? "Not paid" : "Done"}</small>
            </span>
          </div>
        );
      })}
    </>
  );
}
