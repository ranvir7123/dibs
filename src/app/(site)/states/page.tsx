import type { Metadata } from "next";
import Link from "next/link";
import type { BoardJob, JobCard } from "@/contract/types";
import { Avatar } from "@/ui/Avatar";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { Icon } from "@/ui/Icon";
import { JobTile } from "@/ui/JobTile";
import { BoardSkeleton, Empty, Notice } from "@/ui/States";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Screen states" };

/**
 * A look-book, not part of the product's paths: the states that are hard to
 * reach by hand (loading, a page that failed, nothing here, very long text),
 * each drawn with the same pieces the real screens use, so they can be looked
 * at and checked on a phone. Nothing here reads the database.
 *
 * "?boom=1" fails on purpose, to show the real error screen.
 */
export default async function StatesPage({ searchParams }: { searchParams: Promise<{ boom?: string }> }) {
  if ((await searchParams).boom) throw new Error("Made to fail on purpose, to show the error screen.");

  const longTitle =
    "Get our brand-new spring launch video in front of ten thousand real people who actually watch it to the end, " +
    "Supercalifragilisticexpialidocious_and_one_very_long_unbroken_word_that_has_no_spaces_in_it_at_all_whatsoever_to_test_wrapping";
  const longName = "The Extraordinarily Long-Named Kettle, Clove, Cardamom & Cinnamon Trading Company of Lower Parel (Mumbai) Private Limited";
  const card: JobCard = {
    title: longTitle,
    category: "promotion",
    finishLine: "10,000 views",
    target: { unit: "view", count: 10000 },
    howChecked: ["Views are read from the video site's own count."],
    checkedByLine: "The video site's own view count, read every ten minutes, together with clicks on a link that Dibs owns",
    cheatTestsLine: "Sudden jumps in views.",
    payRule: { kind: "per_unit", unit: "view", unitLabel: "views", centsPerBatch: 200, batchSize: 1000 },
    payLine: "$2.00 for every 1,000 views that pass every one of the cheat tests listed on this card",
    payNote: "Up to $1,234,567.89 in total",
    capCents: 123456789,
    endsAt: "2026-11-24T12:00:00.000Z",
    proofStrength: "medium",
    proofNote: "Views can be bought.",
    proofTip: null,
    targetUrl: null,
    checker: { evidence: ["public_page"], handIn: "link", mustShow: [], cheatTests: [], machineCheckable: true },
  };
  const long: BoardJob = {
    job: {
      id: "job_example",
      posterId: "per_example",
      sentence: "",
      title: longTitle,
      category: "promotion",
      card,
      budgetCents: card.capCents,
      status: "open",
      endsAt: new Date(card.endsAt),
      paypalOrderId: null,
      paypalAuthorizationId: null,
      createdAt: new Date("2026-11-10T12:00:00.000Z"),
      endedAt: null,
    },
    poster: { id: "per_example", name: longName, paypalEmail: "long@example.com", createdAt: new Date("2026-11-10T12:00:00.000Z") },
    money: { lockedCents: 123456789, paidCents: 98765432, heldCents: 24691357, letGoCents: 0 },
    daysLeft: 9,
  };
  const full: BoardJob = { ...long, job: { ...long.job, id: "job_example_2", title: "A job that is fully paid" }, money: { lockedCents: 5000, paidCents: 5000, heldCents: 0, letGoCents: 0 } };

  return (
    <>
      <div className="head">
        <div>
          <h1>Screen states</h1>
          <p>What each screen shows while it loads, when it fails, when there is nothing to show, and when the words are very long.</p>
        </div>
      </div>

      <h2 className="section">Loading</h2>
      <BoardSkeleton />

      <h2 className="section">A page that failed</h2>
      <ErrorPanel />
      <p className="sub" style={{ marginTop: 8 }}>
        <Link href="/states?boom=1" className="textlink">
          Make this page fail for real
        </Link>
      </p>

      <h2 className="section">Nothing here yet</h2>
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

      <h2 className="section">Messages</h2>
      <div className="stack">
        <Notice kind="info">The checker has it now. This page updates by itself as the checks run.</Notice>
        <Notice kind="warn" title="PayPal isn't connected yet">
          The PayPal step is not switched on yet. Your job card is saved, and no money was locked.
        </Notice>
        <Notice kind="stop">Please give the email your PayPal uses.</Notice>
        <Notice kind="ok" title="Handed in">
          The checker has it now.
        </Notice>
      </div>

      <h2 className="section">Very long words</h2>
      <div className="jobs">
        <JobTile item={long} action={<button className="btn main-b">Call dibs</button>} />
        <JobTile item={full} action={<button className="btn ghost">See the results</button>} />
      </div>
      <div className="run-head" style={{ marginTop: 24 }}>
        <div>
          <h1>{longTitle}</h1>
          <p className="num">{longName}. $2.00 for every 1,000 views. 6,200 of 10,000 views so far.</p>
        </div>
        <span className="pill">
          <Icon name="clock" />
          9D left
        </span>
      </div>
      <article className="panel res">
        <div className="res-head">
          <Avatar name={longName} />
          <div className="name">
            <b>{longName.replaceAll(" ", ".").toLowerCase()}</b>
            <span>Posted 10 Nov</span>
          </div>
          <span className="pill paid">
            <Icon name="ok" />
            Paid
          </span>
        </div>
      </article>
    </>
  );
}
