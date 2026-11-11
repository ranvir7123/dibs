"use client";

/**
 * The lower half of the Ledger page: the "ask a question" button and the AG
 * Studio dashboard. The dashboard is loaded in the browser only. If it cannot
 * be loaded or drawn, the same rows are shown as a plain list instead.
 */
import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import styles from "@/app/(site)/ledger/ledger.module.css";
import type { LedgerRow } from "@/db/ledger";
import { Icon } from "./Icon";
import { LedgerRows } from "./LedgerRows";
import { Notice } from "./States";

function Waiting() {
  return (
    <div className={styles.wait} aria-busy="true">
      <p className="hide" role="status">
        Loading the charts
      </p>
      <span className="sk" aria-hidden="true" />
      <span className="sk" aria-hidden="true" />
      <span className="sk" aria-hidden="true" />
    </div>
  );
}

// AG Studio draws in the browser only, so it is loaded after the page arrives.
const LedgerStudio = dynamic(() => import("./LedgerStudio"), { ssr: false, loading: Waiting });

/** Catches a dashboard that failed to load or draw, so the page can show the plain list instead. */
class DashboardGuard extends Component<{ fallback: ReactNode; onBroken: () => void; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() {
    return { broken: true };
  }
  componentDidCatch(error: unknown) {
    console.error("The ledger dashboard could not be drawn:", error);
    this.props.onBroken();
  }
  render() {
    return this.state.broken ? this.props.fallback : this.props.children;
  }
}

export function LedgerBoard({ rows, licenseKey }: { rows: LedgerRow[]; licenseKey?: string }) {
  const [asking, setAsking] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const onBroken = useCallback(() => setBroken(true), []);
  const onAskTrouble = useCallback((message: string | null) => setTrouble(message), []);

  // The table sizes its columns by measuring the text, so it is drawn only once the site's font has arrived
  // (or after a short wait, if the font never does). Otherwise a time like "05:09" can be cut off.
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const go = () => live && setFontReady(true);
    const giveUp = setTimeout(go, 1500);
    document.fonts?.ready.then(go, go);
    return () => {
      live = false;
      clearTimeout(giveUp);
    };
  }, []);

  const plainList = (
    <div className="stack">
      <Notice kind="warn" title="The charts could not be loaded">
        Your money moves are listed below. Reload the page to try the charts again.
      </Notice>
      <div className="panel rows">
        <LedgerRows rows={rows} />
      </div>
    </div>
  );

  return (
    <section aria-labelledby="ledger-charts">
      <div className={styles.bar}>
        <div>
          <h2 id="ledger-charts">Charts and every line</h2>
          <p>
            {broken ? "Every line, newest first." : asking ? "Type your question in the ask box. The answer is built from the rows on this page." : "Built from the same rows. Ask a question and the dashboard builds the answer."}
            {asking && !broken ? <span className={styles.phoneOnly}> Close the ask box to see the charts again.</span> : null}
          </p>
        </div>
        {broken ? null : (
          <button type="button" className={asking ? "btn ghost" : "btn main-b"} aria-pressed={asking} onClick={() => setAsking((now) => !now)}>
            {asking ? null : <Icon name="spark" />}
            {asking ? "Close the ask box" : "Ask a question"}
          </button>
        )}
      </div>

      {trouble && !broken ? (
        <div className={styles.trouble}>
          <Notice kind="stop" title="The AI did not answer">
            {trouble}
          </Notice>
        </div>
      ) : null}

      <DashboardGuard fallback={plainList} onBroken={onBroken}>
        <div className={asking ? `${styles.studio} ${styles.asking}` : styles.studio}>
          {fontReady ? <LedgerStudio rows={rows} mode={asking ? "edit" : "view"} licenseKey={licenseKey} onAskTrouble={onAskTrouble} /> : <Waiting />}
        </div>
      </DashboardGuard>
    </section>
  );
}
