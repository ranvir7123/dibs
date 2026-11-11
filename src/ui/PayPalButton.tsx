"use client";

/**
 * PayPal's own button. Pressing it opens PayPal's window over this page; the
 * page stays where it is. Two uses:
 *
 *   <PayPalButton kind="hold" jobId={job.id} />        a business locks a job's money
 *   <PayPalButton kind="shop" refCode={code} />        a buyer pays the shop
 *
 * doneHref: where to go when it worked (default: the job page, or the shop's
 * thank-you page). children: what to show instead when PayPal's button cannot
 * be loaded at all (the older way that leaves the page for PayPal).
 *
 * The money is never decided here. This page only tells our server "the payer
 * approved order X"; the server reads everything again from PayPal.
 * Test mode only: the button is loaded from PayPal's test site.
 */
import { createElement, useCallback, useEffect, useState, type ReactNode } from "react";

type Props = ({ kind: "hold"; jobId: string } | { kind: "shop"; refCode?: string | null }) & { doneHref?: string; children?: ReactNode };

type Phase = "loading" | "ready" | "working" | "closed" | "error" | "done" | "unavailable";

interface Session {
  start(options: { presentationMode: string }, order: Promise<{ orderId: string }>): Promise<void>;
}
interface PayPalKit {
  createInstance(options: { clientId: string; components: string[]; pageType: string }): Promise<{
    createPayPalOneTimePaymentSession(handlers: { onApprove: (data: { orderId: string }) => Promise<void> | void; onCancel: () => void; onError: (error: unknown) => void }): Session | Promise<Session>;
  }>;
}

const KIT_ADDRESS = "https://www.sandbox.paypal.com/web-sdk/v6/core";
let kitLoading: Promise<PayPalKit> | null = null;

/** Loads PayPal's button code once for the whole page. */
function loadKit(): Promise<PayPalKit> {
  const have = () => (window as unknown as { paypal?: PayPalKit }).paypal;
  kitLoading ??= new Promise<PayPalKit>((resolve, reject) => {
    const ready = have();
    if (ready?.createInstance) return resolve(ready);
    const script = document.createElement("script");
    script.src = KIT_ADDRESS;
    script.async = true;
    script.onload = () => {
      const kit = have();
      if (kit?.createInstance) resolve(kit);
      else reject(new Error("PayPal's button did not load."));
    };
    script.onerror = () => reject(new Error("PayPal's button did not load."));
    document.head.append(script);
  }).catch((error) => {
    kitLoading = null; // let the next try load it again
    throw error;
  });
  return kitLoading;
}

async function post(address: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(address, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("We could not reach Dibs. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || data.ok !== true) throw new Error(typeof data.message === "string" ? data.message : "That did not work. Nothing was changed. Please try again.");
  return data;
}

const say = (error: unknown) => (error instanceof Error && error.message ? error.message : "PayPal had a problem. Nothing was changed. Please try again.");

export default function PayPalButton(props: Props) {
  const hold = props.kind === "hold";
  const jobId = props.kind === "hold" ? props.jobId : "";
  const refCode = props.kind === "shop" ? (props.refCode ?? null) : null;
  const { doneHref } = props;

  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  // "Nothing was locked" for a hold, "Nothing was taken" for a sale: true in both cases until our server finishes.
  const nothing = hold ? "Nothing was locked." : "Nothing was taken.";

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const setup = (await (await fetch("/api/paypal/setup")).json()) as { clientId?: string };
        if (!setup.clientId) throw new Error("PayPal is not set up on this site yet.");
        const kit = await loadKit();
        const instance = await kit.createInstance({ clientId: setup.clientId, components: ["paypal-payments"], pageType: "checkout" });
        const made = await instance.createPayPalOneTimePaymentSession({
          onApprove: async (data) => {
            if (!live) return;
            setPhase("working");
            setMessage("");
            try {
              if (hold) {
                await post("/api/paypal/hold/finish", { jobId, orderId: data.orderId });
                setPhase("done");
                window.location.assign(doneHref ?? `/jobs/${encodeURIComponent(jobId)}?hold=locked`);
              } else {
                const done = await post("/api/paypal/shop/finish", { orderId: data.orderId });
                if (done.paid !== true) throw new Error("PayPal did not take the payment, so nothing was taken. Please try again.");
                setPhase("done");
                window.location.assign(doneHref ?? String(done.thanksUrl));
              }
            } catch (error) {
              setPhase("error");
              setMessage(say(error));
            }
          },
          onCancel: () => {
            if (!live) return;
            setPhase("closed");
            setMessage(`You closed PayPal's window. ${nothing}`);
          },
          onError: (error) => {
            if (!live) return;
            setPhase("error");
            setMessage(`${say(error)} ${nothing}`);
          },
        });
        if (!live) return;
        setSession(made);
        setPhase("ready");
      } catch (error) {
        if (!live) return;
        setPhase("unavailable");
        setMessage(say(error));
      }
    })();
    return () => {
      live = false;
    };
  }, [hold, jobId, doneHref, nothing]);

  const press = useCallback(() => {
    if (!session) return;
    setMessage("");
    // The order is asked for and handed to PayPal in the same breath, without
    // waiting for it first: a browser only lets a window open straight after a click.
    const order = (hold ? post("/api/paypal/hold/order", { jobId }) : post("/api/paypal/shop/order", { ref: refCode })).then((data) => ({ orderId: String(data.orderId) }));
    session.start({ presentationMode: "auto" }, order).catch((error: unknown) => {
      setPhase("error");
      setMessage(`${say(error)} ${nothing}`);
    });
  }, [session, hold, jobId, refCode, nothing]);

  if (phase === "unavailable") {
    // PayPal's button cannot be used here: show the older way if the page gave one.
    return props.children ? <>{props.children}</> : <p className="notice stop" role="alert">{message} {nothing}</p>;
  }

  const canPress = phase === "ready" || phase === "closed" || phase === "error";
  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {phase === "loading" ? (
        <p className="sub" role="status" style={{ minHeight: 48, display: "flex", alignItems: "center" }}>
          Loading PayPal&rsquo;s button&hellip;
        </p>
      ) : null}
      {canPress ? createElement("paypal-button", { type: "pay", onClick: press, style: { display: "block", width: "100%", maxWidth: 360 } }) : null}
      {phase === "working" ? (
        <p className="notice" role="status" style={{ background: "var(--wash)" }}>
          {hold ? "PayPal approved. Locking the money now…" : "PayPal approved. Taking the payment now…"}
        </p>
      ) : null}
      {phase === "done" ? (
        <p className="notice ok" role="status">
          {hold ? "Locked. PayPal is holding the money." : "Paid. Thank you."}
        </p>
      ) : null}
      {phase === "closed" ? (
        <p className="notice" role="status" style={{ background: "var(--wash)" }}>
          {message} Press the button to try again.
        </p>
      ) : null}
      {phase === "error" ? (
        <p className="notice stop" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
