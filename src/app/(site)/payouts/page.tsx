import type { Metadata } from "next";
import Link from "next/link";
import { formatCents, getMyWork } from "@/contract";
import { Icon } from "@/ui/Icon";
import { PayoutRows } from "@/ui/PayoutRows";
import { Empty } from "@/ui/States";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payouts" };

// Every payment that reached the worker's PayPal, newest first.
export default async function PayoutsPage() {
  const viewer = await getViewer();
  const work = viewer ? await getMyWork(viewer.id) : null;

  return (
    <>
      <div className="head">
        <div>
          <h1>Payouts</h1>
          <p>{viewer ? `Money Dibs has sent to ${viewer.paypalEmail}, each with PayPal's own reference.` : "Money Dibs has sent to your PayPal, each with PayPal's own reference."}</p>
        </div>
        {work ? (
          <span className="pill paid num">
            <Icon name="wallet" />
            You&apos;ve earned {formatCents(work.earnedCents)}
          </span>
        ) : null}
      </div>

      {!viewer || !work ? (
        <Empty
          icon="user"
          title="Say who you are first"
          action={
            <Link href={`/you?next=${encodeURIComponent("/payouts")}`} className="btn main-b">
              Choose who you are
            </Link>
          }
        >
          Then your payouts show up here.
        </Empty>
      ) : work.payouts.length === 0 ? (
        <Empty
          icon="wallet"
          title="No payouts yet"
          action={
            <Link href="/" className="btn main-b">
              See the jobs
            </Link>
          }
        >
          When one of your results passes its checks, the pay is sent to your PayPal and listed here.
        </Empty>
      ) : (
        <div className="panel rows">
          <PayoutRows payouts={work.payouts} />
        </div>
      )}
    </>
  );
}
