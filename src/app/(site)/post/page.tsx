import type { Metadata } from "next";
import { getJobPage } from "@/contract";
import { TRIES } from "@/ui/JobCardPanel";
import { PostForm } from "@/ui/PostForm";
import { Notice } from "@/ui/States";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post a job" };

// Posting a job, step one: type what you want in one sentence.
// "?from=<job id>" comes from "Change the card" and puts that job's sentence back in the box.
export default async function PostPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const viewer = await getViewer();

  let firstSentence = "";
  if (from && viewer) {
    const earlier = await getJobPage(from);
    // Only the person who wrote a sentence gets it back.
    if (earlier && earlier.job.posterId === viewer.id) firstSentence = earlier.job.sentence;
  }

  return (
    <div className="stack">
      {viewer ? null : (
        <Notice kind="info" title="You have not said who you are yet">
          You can type your sentence now. Before the card is written we will ask for a name and the email your PayPal uses.
        </Notice>
      )}
      <PostForm firstSentence={firstSentence} tries={TRIES} />
    </div>
  );
}
