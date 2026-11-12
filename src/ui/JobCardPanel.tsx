import type { ReactNode } from "react";
import { formatCents } from "@/contract/money";
import type { JobCard } from "@/contract/types";
import { settings } from "@/settings";
import { longDay, proofWord } from "./format";
import { Icon, type IconName } from "./Icon";

/** Sentences other posters have typed, shown as ideas under the box. */
export const TRIES = [
  "Get a streamer with 100 viewers to play my game",
  "Find 3 bugs in my app and show me each one",
  "Bring me 10 paying customers this month",
];

const PROOF_COLOUR = { strong: "var(--paid)", medium: "var(--text)", weak: "var(--stop-text)" } as const;

function Row({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="jc-row">
      <span className="ic">
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        {children}
      </div>
    </div>
  );
}

/**
 * The job card AI wrote, as the poster reads it before locking any money.
 * `children` is the foot of the card: the buttons and the line under them.
 */
export function JobCardPanel({ card, children }: { card: JobCard; children: ReactNode }) {
  const [firstCheck, ...moreChecks] = card.howChecked;
  return (
    <div className="panel">
      <div className="jc-head">
        <h3>{card.title}</h3>
        <span className="pill wait">
          <Icon name="spark" />
          Written for you
        </span>
      </div>
      <Row icon="flag" label="Finish line">
        <p className="num">{card.finishLine}</p>
      </Row>
      <Row icon="eye" label="How it's checked">
        <p>{firstCheck ?? card.checkedByLine}</p>
        {moreChecks.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </Row>
      {card.checker.doesNotCount?.length ? (
        <Row icon="no" label="Does not count">
          <p>A find that matches one of these earns nothing. Each new find is paid once.</p>
          {card.checker.doesNotCount.map((line, i) => (
            <p key={line}>
              {i + 1}. {line.charAt(0).toUpperCase() + line.slice(1)}
            </p>
          ))}
        </Row>
      ) : null}
      {card.cheatTestsLine ? (
        <Row icon="shield" label="Cheat tests">
          <p>{card.cheatTestsLine}</p>
        </Row>
      ) : null}
      <Row icon="wallet" label="Pay">
        <p className="num">
          {card.payLine}
          {card.payRule.kind === "per_unit" ? ", to whoever earned them" : ""}
        </p>
        <p className="num">
          {card.payNote}. Money that isn&apos;t earned is never taken from you.
          {Number(settings.feeTakenFromPayouts) === 1 ? ` Dibs keeps ${settings.feePercent}% of what is paid out.` : ""}
        </p>
      </Row>
      <Row icon="clock" label="Ends">
        <p className="num">
          {longDay(new Date(card.endsAt))}, or when the {formatCents(card.capCents)} is used
        </p>
        <p className="num">A job can stay open for {settings.maxJobDays} days at most.</p>
      </Row>
      <Row icon="warn" label="How strong the proof is">
        <p>
          <span className="warn" style={{ color: PROOF_COLOUR[card.proofStrength] }}>
            {proofWord(card.proofStrength, true)}.
          </span>{" "}
          {card.proofNote}
        </p>
        {card.proofTip ? <p>{card.proofTip}</p> : null}
      </Row>
      <div className="jc-foot">{children}</div>
    </div>
  );
}
