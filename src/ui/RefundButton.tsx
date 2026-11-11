"use client";

/**
 * The shop owner's Refund button for one order. It asks first, because a
 * refund cannot be undone, then gives the buyer their money back through
 * PayPal. A sale refunded in full is no longer counted and earns no commission.
 *
 *   <RefundButton paypalOrderId={order.sale.paypalOrderId} keptCents={order.keptCents} />
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCents } from "@/contract/money";

type Phase = "idle" | "asking" | "working" | "done" | "error";

export default function RefundButton({ paypalOrderId, keptCents }: { paypalOrderId: string; keptCents: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const amount = formatCents(keptCents);

  async function refund() {
    setPhase("working");
    try {
      const response = await fetch("/api/paypal/refund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: paypalOrderId }) });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || data.ok !== true) throw new Error(data.message || "PayPal could not refund this just now. Nothing was changed.");
      setPhase("done");
      router.refresh();
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error && error.message ? error.message : "We could not reach Dibs. Nothing was changed.");
    }
  }

  if (keptCents <= 0 || phase === "done") {
    return <span className="pill stop">Refunded, not counted</span>;
  }
  if (phase === "asking" || phase === "working") {
    return (
      <span style={{ display: "grid", gap: 8, justifyItems: "end", minWidth: 0 }}>
        <span className="sub" style={{ textAlign: "right" }}>
          Give {amount} back to the buyer? This cannot be undone.
        </span>
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="btn main-b small" onClick={refund} disabled={phase === "working"}>
            {phase === "working" ? "Refunding…" : `Yes, refund ${amount}`}
          </button>
          <button type="button" className="btn ghost small" onClick={() => setPhase("idle")} disabled={phase === "working"}>
            Keep the sale
          </button>
        </span>
      </span>
    );
  }
  return (
    <span style={{ display: "grid", gap: 8, justifyItems: "end", minWidth: 0 }}>
      {phase === "error" ? (
        <span className="sub" role="alert" style={{ color: "var(--stop-text, var(--stop))", textAlign: "right" }}>
          {message}
        </span>
      ) : null}
      <button type="button" className="btn ghost small" onClick={() => setPhase("asking")}>
        {phase === "error" ? "Try the refund again" : "Refund"}
      </button>
    </span>
  );
}
