import Link from "next/link";
import type { ReactNode } from "react";
import { formatCents } from "@/contract/money";
import type { BoardJob } from "@/contract/types";
import { Avatar } from "./Avatar";
import { categoryLabel, dayMonth, daysLeftLabel, paidShare, proofWord } from "./format";
import { Icon } from "./Icon";

/** The money bar: the green part is paid, the rest is still held. */
export function MoneyBar({ paidCents, lockedCents, big = false }: { paidCents: number; lockedCents: number; big?: boolean }) {
  const share = paidShare(paidCents, lockedCents);
  return (
    <div
      className={big ? "bar big" : "bar"}
      role="img"
      aria-label={`${formatCents(paidCents)} paid of ${formatCents(lockedCents)} locked`}
    >
      <i style={{ width: `${share}%` }} />
    </div>
  );
}

/** A job with this few days left gets the warmer "ending soon" pill. */
const SOON_DAYS = 5;

/** One job on the board. `action` is the button at the bottom, which depends on who is looking. */
export function JobTile({ item, action }: { item: BoardJob; action: ReactNode }) {
  const { job, poster, money, daysLeft } = item;
  const card = job.card;
  const open = job.status === "open";
  // A sale that PayPal itself sees is the hardest proof to fake, so those jobs are marked.
  const strongest = card.checker.evidence.includes("paypal_sale");
  // The line under the pay rule usually repeats the cap ("Up to $50.00 in total"), which has its own row.
  const extraNote = /^up to\b/i.test(card.payNote.trim()) ? null : card.payNote;

  return (
    <article className={strongest ? "job top-pick" : "job"}>
      {strongest ? (
        <span className="flag">
          <Icon name="tick" />
          Strongest proof
        </span>
      ) : null}
      <div className="job-top">
        <Avatar name={poster.name} />
        <div className="who">
          <b>{poster.name}</b>
          <small>{categoryLabel(job.category)}</small>
        </div>
        <span className={open && daysLeft <= SOON_DAYS ? "pill soon" : "pill"}>
          <Icon name="clock" />
          {job.status === "ended" ? "Ended" : job.status === "draft" ? "Not posted" : daysLeftLabel(daysLeft)}
        </span>
      </div>
      <h3 title={job.title}>
        <Link href={job.status === "draft" ? `/post/${job.id}` : `/jobs/${job.id}`}>{job.title}</Link>
      </h3>
      <div className="facts">
        <div className="fact">
          <span>Pay</span>
          <b className="num">{card.payLine}</b>
        </div>
        <div className="fact">
          <span>Up to</span>
          <b className="num">{formatCents(card.capCents)} in total</b>
        </div>
        {extraNote ? <p className="fact-note">{extraNote}</p> : null}
        {open && job.holdEndsAt ? <p className="fact-note num">PayPal holds this until {dayMonth(job.holdEndsAt)}</p> : null}
        <div className="check">
          <Icon name="shield" />
          <p>
            <b>{card.checkedByLine}</b>
            <small>Proof: {proofWord(card.proofStrength)}</small>
          </p>
        </div>
      </div>
      <div className="money">
        <div className="money-row num">
          <span className="p">{formatCents(money.paidCents)} paid</span>
          <span className="h">{job.status === "draft" ? `${formatCents(job.budgetCents)} to lock` : `${formatCents(money.heldCents)} still held`}</span>
        </div>
        <MoneyBar paidCents={money.paidCents} lockedCents={money.lockedCents} />
      </div>
      {action}
    </article>
  );
}
