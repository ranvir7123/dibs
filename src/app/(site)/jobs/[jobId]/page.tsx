import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents, getJobPage, getMyWork } from "@/contract";
import type { ResultStatus } from "@/contract/types";
import { AutoRefresh } from "@/ui/AutoRefresh";
import { CallDibs } from "@/ui/CallDibs";
import { EndJob } from "@/ui/EndJob";
import { ago, count, daysLeftLabel, longDay, plural, sentence } from "@/ui/format";
import { Icon } from "@/ui/Icon";
import { MoneyBar } from "@/ui/JobTile";
import { ResultCardView } from "@/ui/ResultCardView";
import { Empty, Notice } from "@/ui/States";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ jobId: string }>; searchParams: Promise<{ show?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getJobPage((await params).jobId);
  return { title: page ? page.job.title : "Job not found" };
}

const TABS: { key: ResultStatus; label: string }[] = [
  { key: "paid", label: "Paid" },
  { key: "checking", label: "Checking" },
  { key: "blocked", label: "Blocked" },
  { key: "waiting", label: "Waiting" },
];

// A job while it runs: the money, and one card for each person's result.
export default async function JobRunPage({ params, searchParams }: Props) {
  const { jobId } = await params;
  const { show } = await searchParams;
  const [page, viewer] = await Promise.all([getJobPage(jobId), getViewer()]);
  if (!page) notFound();

  const { job, poster, money, progress, counts } = page;
  const now = new Date();
  const tab = TABS.find((t) => t.key === show)?.key ?? null;
  const results = tab ? page.results.filter((card) => card.result.status === tab) : page.results;
  const viewerIsPoster = viewer?.id === job.posterId;
  const mine = viewer && !viewerIsPoster ? await getMyWork(viewer.id) : null;
  const myClaim = mine?.items.find((item) => item.job.id === job.id) ?? null;

  const headLine = [
    `${poster.name}.`,
    sentence(job.card.payLine),
    progress ? `${count(progress.count)} of ${count(progress.target)} so far.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {job.status === "open" ? <AutoRefresh seconds={30} /> : null}

      <div className="run-head">
        <div>
          <h1>{job.title}</h1>
          <p className="num">{headLine}</p>
        </div>
        <span className="pill">
          <Icon name="clock" />
          {job.status === "ended" ? "Ended" : job.status === "draft" ? "Not posted yet" : daysLeftLabel(page.daysLeft)}
        </span>
      </div>

      <div className="panel vault">
        <div className="sums">
          <div>
            <small>Locked in PayPal</small>
            <b>{formatCents(money.lockedCents)}</b>
          </div>
          <div className="p">
            <small>Paid for results</small>
            <b>{formatCents(money.paidCents)}</b>
          </div>
          <div className="h">
            <small>{job.status === "ended" ? "Went back to the poster" : "Still held"}</small>
            <b>{formatCents(job.status === "ended" ? money.letGoCents : money.heldCents)}</b>
          </div>
        </div>
        <MoneyBar paidCents={money.paidCents} lockedCents={money.lockedCents} big />
        {job.status === "open" && job.holdEndsAt ? (
          <p className="sub num" style={{ marginTop: 12 }}>
            PayPal holds this until {longDay(job.holdEndsAt)}.
          </p>
        ) : null}
      </div>

      {job.status === "draft" ? (
        <div style={{ marginBottom: 20 }}>
          <Notice kind="warn" title="No money is locked yet">
            This job is not on the board. {viewerIsPoster ? <Link href={`/post/${job.id}`} className="textlink">Finish posting it</Link> : `${poster.name} still has to lock the pay in PayPal.`}
          </Notice>
        </div>
      ) : null}

      {job.status === "open" && viewerIsPoster ? (
        job.endsAt.getTime() > now.getTime() ? (
          <EndJob jobId={job.id} heldLabel={formatCents(money.heldCents)} />
        ) : (
          <div style={{ marginBottom: 20 }}>
            <Notice kind="warn" title="This job is ending">
              It is closed to new work. The last checks and payments are finishing; the rest of the held money is let go as soon as they are done.
            </Notice>
          </div>
        )
      ) : null}

      {job.status === "open" && job.endsAt.getTime() > now.getTime() && viewer && !viewerIsPoster && !myClaim ? (
        <div className="panel todo" style={{ borderTop: "1px solid var(--line)", marginBottom: 20 }}>
          <p>
            <b>Want this job?</b>
            {sentence(job.card.finishLine)} {sentence(job.card.payLine)}
          </p>
          <CallDibs jobId={job.id} />
        </div>
      ) : null}
      {myClaim && !myClaim.card && job.card.checker.handIn !== "none" ? (
        <div className="panel todo" style={{ borderTop: "1px solid var(--line)", marginBottom: 20 }}>
          <p>
            <b>You called dibs on this job</b>
            Hand in your {job.card.checker.handIn === "link" ? "link" : "file"} to start the checks.
          </p>
          <Link href={`/work/${myClaim.claim.id}`} className="btn main-b">
            <Icon name="upload" />
            Hand in your work
          </Link>
        </div>
      ) : null}

      <div className="list-top">
        <nav className="tabs" aria-label="Results">
          <Link href={`/jobs/${job.id}`} className={tab ? undefined : "on"} aria-current={tab ? undefined : "page"}>
            All <b>{counts.all}</b>
          </Link>
          {TABS.filter((t) => t.key !== "waiting" || counts.waiting > 0).map((t) => (
            <Link key={t.key} href={`/jobs/${job.id}?show=${t.key}`} className={tab === t.key ? "on" : undefined} aria-current={tab === t.key ? "page" : undefined}>
              {t.label} <b>{counts[t.key]}</b>
            </Link>
          ))}
        </nav>
        <p>{page.lastReadAt ? `Numbers last read ${ago(page.lastReadAt, now)}` : "No numbers have been read yet"}</p>
      </div>

      {results.length > 0 ? (
        results.map((card) => (
          <ResultCardView key={card.result.id} card={card} job={job} poster={poster} heading="worker" viewerIsPoster={viewerIsPoster} now={now} />
        ))
      ) : tab ? (
        <Empty
          icon="list"
          title={`No ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} results`}
          action={
            <Link href={`/jobs/${job.id}`} className="btn ghost">
              See all results
            </Link>
          }
        >
          Nothing on this job is in that group right now.
        </Empty>
      ) : (
        <Empty icon="people" title="Nobody has handed anything in yet">
          {page.notHandedIn > 0
            ? `${plural(page.notHandedIn, "person has", "people have")} called dibs and ${page.notHandedIn === 1 ? "is" : "are"} working on it. Each result shows up here as its own card, checked and paid without anyone approving it.`
            : "When someone calls dibs and hands in their work, it shows up here as its own card, checked and paid without anyone approving it."}
        </Empty>
      )}

      {results.length > 0 && !tab && page.notHandedIn > 0 ? (
        <p className="sub" style={{ marginTop: 16, textAlign: "center" }}>
          {plural(page.notHandedIn, "more person has", "more people have")} called dibs and not handed anything in yet.
        </p>
      ) : null}
    </>
  );
}
