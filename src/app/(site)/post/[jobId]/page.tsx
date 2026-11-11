import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents, getJobPage } from "@/contract";
import { HoldForm } from "@/ui/HoldForm";
import { Icon } from "@/ui/Icon";
import { JobCardPanel, TRIES } from "@/ui/JobCardPanel";
import PayPalButton from "@/ui/PayPalButton";
import { Notice } from "@/ui/States";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your job card" };

// Posting a job, step two: read the card AI wrote, then lock the money with PayPal.
export default async function JobCardPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ hold?: string }> }) {
  const { jobId } = await params;
  // Lane A sends the poster back here with ?hold=failed or ?hold=cancelled when PayPal did not lock the money.
  const { hold } = await searchParams;
  const [page, viewer] = await Promise.all([getJobPage(jobId), getViewer()]);
  if (!page) notFound();
  const { job, poster } = page;
  const isPoster = viewer?.id === job.posterId;

  return (
    <div className="post">
      <div className="panel ask">
        <h1>What result do you want?</h1>
        <div className="typed">{job.sentence}</div>
        <p>Any kind of job works. If a result can&apos;t be checked by a machine, the card says so before you lock any money.</p>
        <h4>Other things people have asked for</h4>
        <div className="tries">
          {TRIES.map((idea) => (
            <span key={idea}>
              <Icon name="spark" />
              {idea}
            </span>
          ))}
        </div>
      </div>

      <JobCardPanel card={job.card}>
        {job.card.checker.machineCheckable ? null : (
          <Notice kind="warn" title="A machine can't measure this result">
            AI will give its opinion on the work instead. You get a few days to object before anything is paid.
          </Notice>
        )}
        {job.status !== "draft" ? (
          <>
            <Notice kind="ok" title={job.status === "open" ? `${formatCents(job.budgetCents)} is held in PayPal` : "This job has ended"}>
              {job.status === "open" ? "The job is on the board and people can call dibs." : "The money that was not earned went back to the poster."}
            </Notice>
            <div className="btns">
              <Link href={`/jobs/${job.id}`} className="btn main-b">
                See the job
              </Link>
            </div>
          </>
        ) : isPoster ? (
          <>
            {hold === "failed" ? (
              <Notice kind="stop" title="PayPal could not lock the money">
                Nothing was charged. Please try again.
              </Notice>
            ) : hold === "cancelled" ? (
              <Notice kind="info" title="You left PayPal before approving">
                No money was locked. You can try again when you are ready.
              </Notice>
            ) : null}
            <div className="hold">
              <PayPalButton kind="hold" jobId={job.id}>
                <HoldForm jobId={job.id} amount={formatCents(job.budgetCents)} bare />
              </PayPalButton>
              <Link href={`/post?from=${job.id}`} className="btn ghost">
                Change the card
              </Link>
            </div>
            <p className="num">Pressing the PayPal button holds {formatCents(job.budgetCents)}. You&apos;re charged only for results.</p>
          </>
        ) : (
          <>
            <Notice kind="info" title={`This card belongs to ${poster.name}`}>
              Only they can lock the money for it.
            </Notice>
            <div className="btns">
              <Link href={`/you?next=${encodeURIComponent(`/post/${job.id}`)}`} className="btn ghost">
                Switch person
              </Link>
            </div>
          </>
        )}
      </JobCardPanel>
    </div>
  );
}
