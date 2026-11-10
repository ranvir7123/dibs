import Link from "next/link";
import { formatCents, getBoard, getMyWork } from "@/contract";
import type { BoardJob, MyWorkItem, Person } from "@/contract/types";
import { CallDibs } from "@/ui/CallDibs";
import { CATEGORIES, categoryLabel, isCategory } from "@/ui/format";
import { Icon } from "@/ui/Icon";
import { JobTile } from "@/ui/JobTile";
import { Empty } from "@/ui/States";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";

// The board: every job with its money already locked.
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const category = isCategory(kind) ? kind : null;

  const viewer = await getViewer();
  const [board, mine] = await Promise.all([getBoard(viewer?.id), viewer ? getMyWork(viewer.id) : null]);
  const taken = new Map((mine?.items ?? []).map((item) => [item.job.id, item]));
  const jobs = category ? board.jobs.filter((item) => item.job.category === category) : board.jobs;

  return (
    <>
      <div className="hello">
        <h1>The money is already waiting.</h1>
        <p>Each job has its pay locked in PayPal. Do the job, and you&apos;re paid when the result is real. No one has to approve you.</p>
      </div>

      <div className="board-top">
        <nav className="tabs" aria-label="Kinds of job">
          <Link href="/" className={category ? undefined : "on"} aria-current={category ? undefined : "page"}>
            All <b>{board.categoryCounts.all}</b>
          </Link>
          {CATEGORIES.map((c) => (
            <Link key={c} href={`/?kind=${c}`} className={category === c ? "on" : undefined} aria-current={category === c ? "page" : undefined}>
              {categoryLabel(c)} <b>{board.categoryCounts[c]}</b>
            </Link>
          ))}
        </nav>
        {viewer ? (
          <Link href="/payouts" className="pill paid num">
            <Icon name="wallet" />
            You&apos;ve earned {formatCents(board.viewerEarnedCents)}
          </Link>
        ) : (
          <Link href="/you" className="pill wait">
            <Icon name="user" />
            Say who you are to start earning
          </Link>
        )}
      </div>

      {jobs.length > 0 ? (
        <div className="jobs">
          {jobs.map((item) => (
            <JobTile key={item.job.id} item={item} action={<TileAction item={item} viewer={viewer} mine={taken.get(item.job.id)} />} />
          ))}
        </div>
      ) : category ? (
        <Empty
          icon="jobs"
          title={`No ${categoryLabel(category).toLowerCase()} jobs right now`}
          action={
            <Link href="/" className="btn ghost">
              See all jobs
            </Link>
          }
        >
          New jobs appear here the moment their pay is locked in PayPal.
        </Empty>
      ) : (
        <Empty
          icon="jobs"
          title="No jobs yet"
          action={
            <Link href="/post" className="btn main-b">
              <Icon name="plus" />
              Post a job
            </Link>
          }
        >
          A job shows up here once a business has locked its pay in PayPal. Be the first to post one.
        </Empty>
      )}
    </>
  );
}

/** The button at the bottom of a job card. It depends on who is looking. */
function TileAction({ item, viewer, mine }: { item: BoardJob; viewer: Person | null; mine: MyWorkItem | undefined }) {
  const { job } = item;
  if (viewer && job.posterId === viewer.id && !mine) {
    return (
      <Link href={`/jobs/${job.id}`} className="btn ghost">
        See the results
      </Link>
    );
  }
  if (mine) {
    const needsHandIn = !mine.card && job.card.checker.handIn !== "none";
    return needsHandIn ? (
      <Link href={`/work/${mine.claim.id}`} className="btn main-b">
        <Icon name="upload" />
        Hand in your work
      </Link>
    ) : (
      <Link href="/work" className="btn ghost">
        <Icon name="ok" />
        You called dibs. See your result
      </Link>
    );
  }
  return <CallDibs jobId={job.id} />;
}
