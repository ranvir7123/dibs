import Link from "next/link";
import type { ReactNode } from "react";
import { formatCents } from "@/contract/money";
import type { Check, Job, Person, ResultCard } from "@/contract/types";
import { Avatar } from "./Avatar";
import { Chart } from "./ChartView";
import type { ChartPoint } from "./chart";
import { ago, clock, count, dayMonth, firstName, plural, tone } from "./format";
import { Icon, type IconName } from "./Icon";
import { handInAddress } from "./handin";
import { ObjectForm } from "./ObjectForm";
import { RecordingRules } from "./RecordingRules";

/**
 * One result card: who, the thing they handed in, the numbers read from the
 * source, the checks, and what was paid. The card keeps its shape for every
 * kind of job; only the middle changes:
 *  - a job that counts things (views, clicks, sales) shows the numbers and a chart;
 *  - a job with yes-or-no rules shows each rule with the moment it was met.
 */
export function ResultCardView({
  card,
  job,
  poster,
  heading,
  viewerIsPoster,
  now,
}: {
  card: ResultCard;
  job: Job;
  poster: Person;
  /** "worker" on the job's own page; "job" on My work, where every card is the same worker's. */
  heading: "worker" | "job";
  viewerIsPoster: boolean;
  now: Date;
}) {
  const { result, worker, checks } = card;
  const ruleChecks = checks.filter((check) => check.group === "rule");
  const otherChecks = checks.filter((check) => check.group !== "rule");
  const handedWord = result.handInKind === "link" ? "Posted" : result.handInKind === "file" ? "Handed in" : "Called dibs";
  // On My work, a result that is waiting because it could not be read can be handed in again.
  const againHref = heading === "job" && result.handInKind !== "none" && job.status === "open" ? `/work/${result.claimId}` : null;
  const when = `${handedWord} ${dayMonth(result.handedInAt)}`;

  return (
    <article className="panel res">
      <div className="res-head">
        <Avatar name={heading === "job" ? poster.name : worker.name} />
        {heading === "job" ? (
          <Link href={`/jobs/${job.id}`} className="name">
            <b>{job.title}</b>
            <span>
              {poster.name}. {when}
            </span>
          </Link>
        ) : (
          <div className="name">
            <b>{worker.name}</b>
            <span>{when}</span>
          </div>
        )}
        <StatusPill status={result.status} />
      </div>

      {ruleChecks.length > 0 ? (
        <div className="res-body wide">
          <RecordingRules
            title={job.title}
            mediaSeconds={result.measured.mediaSeconds ?? null}
            fileUrl={result.handInKind === "file" ? handInAddress(result.handInFile) : null}
            rules={ruleChecks.map((check) => ({
              key: check.key,
              label: check.label,
              reason: check.reason,
              passed: check.passed,
              seenAtSeconds: check.seenAtSeconds,
            }))}
          />
          <div className="checks">
            <PayBreakdown card={card} job={job} ruleChecks={ruleChecks} />
            {otherChecks.filter((check) => !check.passed).map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
            <Outcome card={card} viewerIsPoster={viewerIsPoster} now={now} againHref={againHref} />
          </div>
        </div>
      ) : (
        <div className={result.handInKind === "none" ? "res-body plain" : "res-body"}>
          {result.handInKind === "none" ? null : <Clip card={card} />}
          <Stats card={card} now={now} />
          <div className="checks">
            <div className="checks-top">
              <h3>Checks</h3>
              <span>{card.checksTotal > 0 ? `${card.checksPassed} of ${card.checksTotal} passed` : "None run yet"}</span>
            </div>
            {result.summary && result.status !== "blocked" && !(result.status === "waiting" && result.objectionEndsAt === null) ? <p>{result.summary}</p> : null}
            {otherChecks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
            <Outcome card={card} viewerIsPoster={viewerIsPoster} now={now} againHref={againHref} />
          </div>
        </div>
      )}

      {result.watchLabel ? (
        <div className={result.watchOk === false ? "res-foot no" : "res-foot"}>
          <Icon name="shield" />
          <b>{result.watchLabel}</b>
          {result.watchNote ? <span>{result.watchNote}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

// ------------------------------------------------------------ pieces

export function StatusPill({ status }: { status: ResultCard["result"]["status"] }) {
  switch (status) {
    case "paid":
      return (
        <span className="pill paid">
          <Icon name="ok" />
          Paid
        </span>
      );
    case "blocked":
      return (
        <span className="pill stop">
          <Icon name="no" />
          Blocked
        </span>
      );
    case "waiting":
      return (
        <span className="pill held">
          <Icon name="clock" />
          Waiting
        </span>
      );
    default:
      return (
        <span className="pill checking">
          <Icon name="clock" />
          Checking
        </span>
      );
  }
}

/** The posted video, as the drawing shows it: a dark frame with a button that opens the real thing. */
function Clip({ card }: { card: ResultCard }) {
  const { result, worker } = card;
  const length = result.measured.mediaSeconds;
  const href = handInAddress(result.handInUrl ?? result.handInFile);
  const isFile = result.handInKind === "file";
  const alt = tone(worker.name) === "a2" || tone(worker.name) === "a4";
  return (
    <div className={alt ? "clip alt" : "clip"}>
      <div className="row" aria-hidden="true">
        <span className="chip-d round">
          <Icon name="play" fill />
        </span>
        {length ? <span className="chip-d num">00:00 / {clock(length)}</span> : null}
      </div>
      {href ? (
        <a className="mid" href={href} target="_blank" rel="noopener noreferrer">
          {isFile ? "Open the file" : "Open the video"}
          <span className="hide"> handed in by {worker.name} (opens in a new tab)</span>
        </a>
      ) : (
        <span className="mid">{isFile ? "File handed in" : "Nothing to open"}</span>
      )}
      <div aria-hidden="true">
        <div className="scrub">
          <i />
        </div>
        <div className="row">
          <span className="chip-d round">
            <Icon name="play" fill />
          </span>
          <span className="chip-d num">1.0x</span>
        </div>
      </div>
    </div>
  );
}

function Stats({ card, now }: { card: ResultCard; now: Date }) {
  const { result, readings, checks } = card;
  const m = result.measured;
  const clickCheat = checks.some((check) => check.group === "cheat" && !check.passed && check.key.includes("click"));

  // Which line the chart draws: the cheat itself when clicks were faked, else views, else real clicks.
  const hasViews = readings.some((reading) => reading.views !== null) && m.views !== undefined;
  const series: "clicksTotal" | "views" | "clicksReal" = clickCheat ? "clicksTotal" : hasViews ? "views" : "clicksReal";
  const points: ChartPoint[] = readings
    .filter((reading) => reading[series] !== null)
    .map((reading) => ({ at: reading.at, value: reading[series] as number }));
  const seriesWord = series === "views" ? "Views" : "Clicks";
  const latest = points.length > 0 ? points[points.length - 1].value : 0;
  const chartLabel = clickCheat ? `Clicks over time, jumping to ${count(latest)}` : `${seriesWord} over time, now ${count(latest)}`;

  const pills: ReactNode[] = [];
  if (m.views !== undefined) pills.push(<CountPill key="v" kind="v" icon="eye" value={m.views} label="views" />);
  if (m.likes !== undefined) pills.push(<CountPill key="l" kind="l" icon="heart" fill value={m.likes} label="likes" />);
  if (m.comments !== undefined) pills.push(<CountPill key="c" kind="c" icon="chat" fill value={m.comments} label="comments" />);
  if (m.sales !== undefined) pills.push(<CountPill key="s" kind="v" icon="wallet" value={m.sales} label="sales" />);
  if (m.items !== undefined) pills.push(<CountPill key="i" kind="v" icon="flag" value={m.items} label="counted" />);
  const clicksShown = clickCheat ? m.clicksTotal : (m.clicksReal ?? m.clicksTotal);
  if (clicksShown !== undefined) pills.push(<CountPill key="k" kind="k" icon="tap" value={clicksShown} label={clickCheat ? "clicks in total" : "real clicks"} />);

  const facts: { label: string; value: string }[] = [];
  if (m.clicksReal !== undefined && m.clicksTotal !== undefined) {
    facts.push({ label: "Real clicks", value: `${count(m.clicksReal)} of ${count(m.clicksTotal)}` });
  }
  if (!clickCheat && m.views && m.likes !== undefined) {
    facts.push({ label: "Likes per 100 views", value: String(Math.round((m.likes / m.views) * 1000) / 10) });
  } else if (m.visitors !== undefined) {
    facts.push({ label: "Different visitors", value: count(m.visitors) });
  }

  return (
    <div className="stats">
      {pills.length > 0 ? <div className="counts">{pills}</div> : null}
      <Chart
        id={result.id}
        points={points}
        bad={clickCheat}
        label={chartLabel}
        now={now}
        emptyText={result.lastCheckedAt ? "The chart starts once the numbers have been read twice." : "Numbers appear here after the first check."}
      />
      {facts.length > 0 ? (
        <div className="pair" style={facts.length === 1 ? { gridTemplateColumns: "1fr" } : undefined}>
          {facts.map((fact) => (
            <div className="kv" key={fact.label}>
              <span>{fact.label}</span>
              <b>{fact.value}</b>
            </div>
          ))}
        </div>
      ) : null}
      <div className="kv">
        <span>Earned so far</span>
        <b>{formatCents(result.earnedCents)}</b>
      </div>
    </div>
  );
}

function CountPill({ kind, icon, fill = false, value, label }: { kind: "v" | "l" | "c" | "k"; icon: IconName; fill?: boolean; value: number; label: string }) {
  return (
    <span className={`count ${kind}`}>
      <Icon name={icon} fill={fill} />
      {count(value)}
      <span className="hide"> {label}</span>
    </span>
  );
}

const CHECK_ICONS: Record<Check["group"], IconName> = { must_show: "eye", cheat: "shield", rule: "flag", opinion: "spark" };

/** One check, with its score. It opens to show the reason; a failed check starts open. */
function CheckRow({ check }: { check: Check }) {
  const icon: IconName = check.key.includes("click") ? "tap" : CHECK_ICONS[check.group];
  return (
    <details className="chk" open={!check.passed}>
      <summary className="chk-row">
        <Icon name={icon} />
        <span className="lab">{check.label}</span>
        <span className={check.passed ? "score" : "score no"}>
          {check.passedCount}/{check.totalCount}
          <span className="hide">{check.passed ? " passed" : " failed"}</span>
        </span>
        <span className="turn" style={{ display: "flex" }}>
          <Icon name="down" />
        </span>
      </summary>
      <div className="chk-more">
        {check.headline ? (
          <b className={check.passed ? "fine" : undefined}>
            {check.passed ? null : <Icon name="warn" />}
            {check.headline}
          </b>
        ) : null}
        {check.reason}
      </div>
    </details>
  );
}

/** The pay sums for a job with yes-or-no rules: what passed, what did not, what stays held. */
function PayBreakdown({ card, job, ruleChecks }: { card: ResultCard; job: Job; ruleChecks: Check[] }) {
  const rule = job.card.payRule;
  const passed = ruleChecks.filter((check) => check.passed).length;
  const missed = ruleChecks.length - passed;
  const each = rule.kind === "per_rule" ? rule.centsPerRule : rule.kind === "per_unit" ? rule.centsPerBatch : null;
  const isRules = rule.kind === "per_rule";
  const nextPerson = job.category === "testing" ? "tester" : "person";

  return (
    <>
      <div className="checks-top">
        <h3>Pay</h3>
        <span>{isRules ? `${passed} of ${ruleChecks.length} rules` : `${passed} of ${ruleChecks.length} counted`}</span>
      </div>
      <div>
        {each !== null ? (
          <>
            <div className="sumline">
              <span>{isRules ? `${plural(passed, "rule")} passed at ${formatCents(each)}` : `${passed} counted at ${formatCents(each)}`}</span>
              <b>{formatCents(passed * each)}</b>
            </div>
            {missed > 0 ? (
              <div className="sumline">
                <span>{isRules ? `${plural(missed, "rule")} not met` : `${missed} not counted`}</span>
                <b>{formatCents(0)}</b>
              </div>
            ) : null}
            {missed > 0 && isRules ? (
              <div className="sumline">
                <span>Stays held for the next {nextPerson}</span>
                <b>{formatCents(missed * each)}</b>
              </div>
            ) : null}
          </>
        ) : (
          <div className="sumline">
            <span>Earned so far</span>
            <b>{formatCents(card.result.earnedCents)}</b>
          </div>
        )}
      </div>
    </>
  );
}

/** The big line at the bottom of the card: what happened to the money, and PayPal's reference. */
function Outcome({ card, viewerIsPoster, now, againHref }: { card: ResultCard; viewerIsPoster: boolean; now: Date; againHref: string | null }) {
  const { result, worker, paidCents, lastPayout } = card;

  if (result.status === "paid") {
    const owed = result.earnedCents - paidCents;
    return (
      <>
        <div className="outcome ok">
          <Icon name="ok" />
          {formatCents(paidCents)} sent to {firstName(worker.name)}
        </div>
        {lastPayout?.paypalRef ? <p className="ref">PayPal reference {lastPayout.paypalRef}</p> : null}
        {owed > 0 ? <p className="ref">{formatCents(owed)} more goes out with the next payout.</p> : null}
      </>
    );
  }

  if (result.status === "blocked") {
    return (
      <>
        <div className="outcome no">
          <Icon name="no" />
          Blocked. {formatCents(paidCents)} paid
        </div>
        <p className="ref">{paidCents > 0 ? "Nothing more will be paid for this result." : "The held money was not touched."}</p>
      </>
    );
  }

  if (result.status === "waiting") {
    const canObject = viewerIsPoster && result.objectedAt === null && result.objectionEndsAt !== null && result.objectionEndsAt > now;
    return (
      <>
        <div className="outcome hold">
          <Icon name="clock" />
          {result.objectedAt ? "The owner objected. A person will decide" : "Waiting. Nothing paid yet"}
        </div>
        {result.objectedAt === null && result.objectionEndsAt ? (
          <p className="ref">
            This is AI&apos;s opinion. It stands on {dayMonth(result.objectionEndsAt)} unless the owner objects.
          </p>
        ) : null}
        {result.objectionEndsAt === null && result.summary ? <p className="ref">{result.summary}</p> : null}
        {result.objectionEndsAt === null && againHref ? (
          <Link href={againHref} className="btn ghost">
            Hand in again
          </Link>
        ) : null}
        {canObject ? <ObjectForm resultId={result.id} /> : null}
      </>
    );
  }

  return (
    <>
      <div className="outcome wait">
        <Icon name="clock" />
        Checking. Nothing paid yet
      </div>
      <p className="ref">
        {result.lastCheckedAt ? `Last checked ${ago(result.lastCheckedAt, now)}.` : "The first check has not run yet."}
      </p>
    </>
  );
}
