import type { Metadata } from "next";
import Link from "next/link";
import { formatCents, getMyWork } from "@/contract";
import type { MyWorkItem } from "@/contract/types";
import { AutoRefresh } from "@/ui/AutoRefresh";
import { Avatar } from "@/ui/Avatar";
import { dayMonth } from "@/ui/format";
import { Icon } from "@/ui/Icon";
import { PayoutRows } from "@/ui/PayoutRows";
import { ResultCardView } from "@/ui/ResultCardView";
import { Empty, Notice } from "@/ui/States";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My work" };

// A worker's own page: every job they called dibs on, what each earned and why.
export default async function MyWorkPage({ searchParams }: { searchParams: Promise<{ handed?: string }> }) {
  const { handed } = await searchParams;
  const viewer = await getViewer();
  const work = viewer ? await getMyWork(viewer.id) : null;
  const now = new Date();

  if (!viewer || !work) {
    return (
      <>
        <div className="head">
          <div>
            <h1>My work</h1>
            <p>The jobs you called dibs on, what each one earned, and why.</p>
          </div>
        </div>
        <Empty
          icon="user"
          title="Say who you are first"
          action={
            <Link href={`/you?next=${encodeURIComponent("/work")}`} className="btn main-b">
              Choose who you are
            </Link>
          }
        >
          Then your jobs and your pay show up here.
        </Empty>
      </>
    );
  }

  return (
    <>
      <AutoRefresh seconds={30} />
      <div className="head">
        <div>
          <h1>My work</h1>
          <p>The jobs you called dibs on, what each one earned, and why. Nobody approves you: a result that passes its checks is paid.</p>
        </div>
        <Link href="/payouts" className="pill paid num">
          <Icon name="wallet" />
          You&apos;ve earned {formatCents(work.earnedCents)}
        </Link>
      </div>

      {handed && work.items.some((item) => item.claim.id === handed) ? (
        <div style={{ marginBottom: 4 }}>
          <Notice kind="ok" title="Handed in">
            The checker has it now. This page updates by itself as the checks run.
          </Notice>
        </div>
      ) : null}

      {work.items.length === 0 ? (
        <Empty
          icon="list"
          title="You have not called dibs on anything yet"
          action={
            <Link href="/" className="btn main-b">
              See the jobs
            </Link>
          }
        >
          Every job on the board already has its pay locked in PayPal. Pick one and call dibs.
        </Empty>
      ) : (
        work.items.map((item) =>
          item.card ? (
            <ResultCardView key={item.claim.id} card={item.card} job={item.job} poster={item.poster} heading="job" viewerIsPoster={false} now={now} />
          ) : (
            <NotHandedIn key={item.claim.id} item={item} />
          ),
        )
      )}

      {work.payouts.length > 0 ? (
        <>
          <h2 className="section">Money that reached your PayPal</h2>
          <div className="panel rows">
            <PayoutRows payouts={work.payouts.slice(0, 3)} />
            {work.payouts.length > 3 ? (
              <Link href="/payouts">
                <span className="grow">
                  <b>See all {work.payouts.length} payouts</b>
                </span>
                <Icon name="right" />
              </Link>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}

/** A job the worker called dibs on and has not handed anything in for yet. */
function NotHandedIn({ item }: { item: MyWorkItem }) {
  const { job, poster, claim } = item;
  const closed = claim.status === "closed" || job.status === "ended";
  const kind = job.card.checker.handIn;
  return (
    <article className="panel res">
      <div className="res-head">
        <Avatar name={poster.name} id={poster.id} />
        <Link href={`/jobs/${job.id}`} className="name">
          <b>{job.title}</b>
          <span>
            {poster.name}. Called dibs {dayMonth(claim.createdAt)}
          </span>
        </Link>
        {closed ? (
          <span className="pill wait">Ended</span>
        ) : (
          <span className="pill held">
            <Icon name="clock" />
            To hand in
          </span>
        )}
      </div>
      <div className="todo">
        {closed ? (
          <p>
            <b>This job ended before you handed anything in</b>
            Nothing was paid. The held money went back to {poster.name}.
          </p>
        ) : (
          <>
            <p>
              <b>{kind === "file" ? "Hand in your file to start the checks" : "Hand in your link to start the checks"}</b>
              {job.card.payLine}. {job.card.payNote}.
            </p>
            <Link href={`/work/${claim.id}`} className="btn main-b">
              <Icon name="upload" />
              Hand in your work
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
