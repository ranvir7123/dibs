import type { Metadata } from "next";
import Link from "next/link";
import { formatCents } from "@/contract/money";
import { getLedger } from "@/db/ledger";
import { plural } from "@/ui/format";
import { LedgerBoard } from "@/ui/LedgerBoard";
import { Empty } from "@/ui/States";
import { getViewer } from "@/ui/viewer";
import styles from "./ledger.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ledger" };

// The ledger of the business using this browser: where its money went.
// Only that business's own rows are read, so nobody else's money reaches the page.
export default async function LedgerPage() {
  const viewer = await getViewer();
  const ledger = viewer ? await getLedger(viewer.id) : null;

  const head = (
    <div className="head">
      <div>
        <h1>Ledger</h1>
        <p>Where your money went: every lock, payment and release on the jobs you posted, each with PayPal&apos;s own reference.</p>
      </div>
    </div>
  );

  if (!viewer || !ledger) {
    return (
      <>
        {head}
        <Empty
          icon="user"
          title="Say who you are first"
          action={
            <Link href={`/you?next=${encodeURIComponent("/ledger")}`} className="btn main-b">
              Choose who you are
            </Link>
          }
        >
          Then the money on your jobs shows up here.
        </Empty>
      </>
    );
  }

  if (ledger.rows.length === 0) {
    return (
      <>
        {head}
        <Empty
          icon="wallet"
          title={ledger.jobCount === 0 ? "No money has moved yet" : "No money is locked yet"}
          action={
            <Link href="/post" className="btn main-b">
              Post a job
            </Link>
          }
        >
          {ledger.jobCount === 0
            ? "Post a job and lock its pay in PayPal. Every lock, payment and release then shows up here, with PayPal's own reference."
            : `You have ${plural(ledger.jobCount, "job")} still being written. Lock the pay on one in PayPal and its money shows up here.`}
        </Empty>
      </>
    );
  }

  const { totals, rows } = ledger;
  const jobsHolding = rows.filter((row) => row.stillLockedCents > 0).length;
  const payments = rows.filter((row) => row.kind === "paid" && row.status === "done");
  const paidWorkers = new Set(payments.map((row) => row.worker)).size;
  const releases = rows.filter((row) => row.kind === "released" && row.status === "done").length;

  return (
    <>
      {head}
      <section className={styles.totals} aria-label="Totals">
        <div className="numbox">
          <span>Locked in PayPal now</span>
          <b className="num">{formatCents(totals.lockedNowCents)}</b>
          <small>{jobsHolding === 0 ? "Nothing is held right now" : `Held for ${plural(jobsHolding, "job")}`}</small>
        </div>
        <div className="numbox mine">
          <span>Paid for results</span>
          <b className="num">{formatCents(totals.paidCents)}</b>
          <small>{payments.length === 0 ? "No result has earned pay yet" : `${plural(payments.length, "payment")} to ${plural(paidWorkers, "worker")}`}</small>
        </div>
        <div className="numbox">
          <span>Released back to you</span>
          <b className="num">{formatCents(totals.releasedCents)}</b>
          <small>{releases === 0 ? "No job has ended yet" : `When ${plural(releases, "job")} ended`}</small>
        </div>
        <div className={totals.blockedCount > 0 ? `numbox ${styles.stopped}` : "numbox"}>
          <span>Stopped by cheat checks</span>
          <b className="num">{formatCents(totals.blockedCents)}</b>
          <small>{totals.blockedCount === 0 ? "No result was blocked" : `${plural(totals.blockedCount, "result")} blocked, not paid`}</small>
        </div>
      </section>

      <LedgerBoard rows={rows} licenseKey={process.env.AG_STUDIO_LICENSE_KEY?.trim() || undefined} />
    </>
  );
}
