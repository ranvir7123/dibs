"use client";

/**
 * The lower half of the Ledger page: the "ask a question" button and the AG
 * Studio dashboard. The dashboard is loaded in the browser only.
 */
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import styles from "@/app/(site)/ledger/ledger.module.css";
import type { LedgerRow } from "@/db/ledger";
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

export function LedgerBoard({ rows, licenseKey }: { rows: LedgerRow[]; licenseKey?: string }) {
  const [asking, setAsking] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const onAskTrouble = useCallback((message: string | null) => setTrouble(message), []);

  return (
    <section aria-labelledby="ledger-charts">
      <div className={styles.bar}>
        <div>
          <h2 id="ledger-charts">Charts and every line</h2>
          <p>
            {asking ? "Type your question in the ask box. The answer is built from the rows on this page." : "Built from the same rows. Ask a question and the dashboard builds the answer."}
            {asking ? <span className={styles.phoneOnly}> Close the ask box to see the charts again.</span> : null}
          </p>
        </div>
        <button type="button" className={asking ? "btn ghost" : "btn main-b"} aria-pressed={asking} onClick={() => setAsking((now) => !now)}>
          {asking ? null : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" />
              <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
            </svg>
          )}
          {asking ? "Close the ask box" : "Ask a question"}
        </button>
      </div>

      {trouble ? (
        <div className={styles.trouble}>
          <Notice kind="stop" title="The AI did not answer">
            {trouble}
          </Notice>
        </div>
      ) : null}

      <div className={asking ? `${styles.studio} ${styles.asking}` : styles.studio}>
        <LedgerStudio rows={rows} mode={asking ? "edit" : "view"} licenseKey={licenseKey} onAskTrouble={onAskTrouble} />
      </div>
    </section>
  );
}
