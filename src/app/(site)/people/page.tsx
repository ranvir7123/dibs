import type { Metadata } from "next";
import Link from "next/link";
import { getMyJobs } from "@/contract";
import { Icon } from "@/ui/Icon";
import { JobTile } from "@/ui/JobTile";
import { Empty } from "@/ui/States";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "People working for you" };

// The poster's side: every job they posted. Each one opens to the people working on it.
export default async function PeoplePage() {
  const viewer = await getViewer();
  const jobs = viewer ? await getMyJobs(viewer.id) : [];

  return (
    <>
      <div className="head">
        <div>
          <h1>People working for you</h1>
          <p>Every job you posted. Open one to see each person&apos;s result, the checks, and what was paid.</p>
        </div>
        <Link href="/post" className="btn main-b">
          <Icon name="plus" />
          Post a job
        </Link>
      </div>

      {!viewer ? (
        <Empty
          icon="user"
          title="Say who you are first"
          action={
            <Link href={`/you?next=${encodeURIComponent("/people")}`} className="btn main-b">
              Choose who you are
            </Link>
          }
        >
          Then the jobs you posted show up here.
        </Empty>
      ) : jobs.length === 0 ? (
        <Empty
          icon="people"
          title="You have not posted a job yet"
          action={
            <Link href="/post" className="btn main-b">
              <Icon name="plus" />
              Post a job
            </Link>
          }
        >
          Type the result you want in one sentence. You only pay when the result is real.
        </Empty>
      ) : (
        <div className="jobs">
          {jobs.map((item) => (
            <JobTile
              key={item.job.id}
              item={item}
              action={
                item.job.status === "draft" ? (
                  <Link href={`/post/${item.job.id}`} className="btn main-b">
                    <Icon name="lock" />
                    Finish posting
                  </Link>
                ) : (
                  <Link href={`/jobs/${item.job.id}`} className="btn ghost">
                    See the results
                  </Link>
                )
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
