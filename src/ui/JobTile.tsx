import Link from "next/link";
import type { ReactNode } from "react";
import { formatCents } from "@/contract/money";
import type { BoardJob } from "@/contract/types";
import { Avatar } from "./Avatar";
import { daysLeftLabel, paidShare, proofWord } from "./format";
import { Icon } from "./Icon";

/** The green and gold bar: green is paid, gold is still held. */
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

/** One job on the board. `action` is the button at the bottom, which depends on who is looking. */
export function JobTile({ item, action }: { item: BoardJob; action: ReactNode }) {
  const { job, poster, money, daysLeft } = item;
  const card = job.card;
  return (
    <article className="job">
      <div className="job-top">
        <Avatar name={poster.name} />
        <span className="who">{poster.name}</span>
        <span className="pill">
          <Icon name="clock" />
          {job.status === "ended" ? "Ended" : job.status === "draft" ? "Not posted" : daysLeftLabel(daysLeft)}
        </span>
      </div>
      <h3 title={job.title}>
        <Link href={job.status === "draft" ? `/post/${job.id}` : `/jobs/${job.id}`}>{job.title}</Link>
      </h3>
      <div className="facts">
        <div>
          <Icon name="wallet" />
          <p className="num">
            {card.payLine}
            <small>{card.payNote}</small>
          </p>
        </div>
        <div>
          <Icon name="shield" />
          <p>
            {card.checkedByLine}
            <small className={card.proofStrength === "strong" ? "strong" : undefined}>Proof: {proofWord(card.proofStrength)}</small>
          </p>
        </div>
      </div>
      <div className="money">
        <div className="money-row num">
          <span className="p">{formatCents(money.paidCents)} paid</span>
          <span className="h">{job.status === "draft" ? `${formatCents(job.budgetCents)} to lock` : `${formatCents(money.heldCents)} held`}</span>
        </div>
        <MoneyBar paidCents={money.paidCents} lockedCents={money.lockedCents} />
      </div>
      {action}
    </article>
  );
}
