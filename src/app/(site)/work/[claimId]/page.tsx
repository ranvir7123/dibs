import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMyWork } from "@/contract";
import { dibsOpensPages } from "@/contract/links";
import { dayMonth, daysLeftLabel, daysUntil, longDay, sentence } from "@/ui/format";
import { MAX_HAND_IN_BYTES } from "@/ui/handin";
import { CopyLink, HandInFileForm, HandInLinkForm } from "@/ui/HandInForm";
import { Icon } from "@/ui/Icon";
import { Notice } from "@/ui/States";
import { getViewer } from "@/ui/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hand in your work" };

// After calling dibs: hand in a link or a file, and see exactly what will be checked.
export default async function HandInPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  const viewer = await getViewer();
  if (!viewer) redirect(`/you?next=${encodeURIComponent(`/work/${claimId}`)}`);

  const work = await getMyWork(viewer.id);
  const item = work?.items.find((candidate) => candidate.claim.id === claimId);
  if (!item) notFound();

  const { job, poster, claim, link, card } = item;
  const spec = job.card.checker;
  const closed = claim.status === "closed" || job.status === "ended";
  const rules = job.card.payRule.kind === "per_rule" ? job.card.payRule.rules : [];

  // The worker's own link in full, built from the address this page was asked for.
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const fullLink = link && host ? `${proto}://${host}/r/${link.code}` : link ? `/r/${link.code}` : null;

  return (
    <>
      <Link href="/work" className="back">
        <Icon name="back" />
        My work
      </Link>
      <div className="head">
        <div>
          <h1>{job.title}</h1>
          <p className="num">
            {poster.name}. {job.card.payLine}. {job.card.payNote}.
          </p>
        </div>
        <span className="pill">
          <Icon name="clock" />
          {closed ? "Ended" : daysLeftLabel(daysUntil(job.endsAt))}
        </span>
      </div>

      <div className="hand">
        <div className="stack">
          {fullLink ? (
            <section className="panel pad" aria-labelledby="link-title">
              <h3 className="t" id="link-title">
                Your own link
              </h3>
              <p className="sub">
                {spec.evidence.includes("paypal_sale")
                  ? "Share this link. A sale counts for you when the buyer came through it and PayPal shows the order as paid."
                  : "Put this link where people can tap it, such as the video's description. Clicks through it are counted for you, once per visitor."}
              </p>
              <CopyLink url={fullLink} />
            </section>
          ) : null}

          <section className="panel pad" aria-labelledby="hand-title">
            <h3 className="t" id="hand-title">
              {spec.handIn === "none" ? "Nothing to hand in" : card ? "Hand in again" : "Hand in your work"}
            </h3>
            {closed ? (
              <>
                <p className="sub">This job has ended.</p>
                <Notice kind="info">Nothing more can be handed in. The money that was not earned went back to {poster.name}.</Notice>
              </>
            ) : spec.handIn === "none" ? (
              <>
                <p className="sub">This job is checked by PayPal itself, so there is nothing to send us.</p>
                <Notice kind="ok" title="You are in">
                  Share your link. Each sale shows up on <Link href="/work" className="textlink">My work</Link> by itself.
                </Notice>
              </>
            ) : dibsOpensPages(spec) ? (
              <>
                <p className="sub">
                  {card ? `You handed in on ${dayMonth(card.result.handedInAt)}. A new list of links replaces it.` : "Paste the links to the pages. The checks start straight away."}
                </p>
                <HandInLinkForm claimId={claim.id} current={card?.result.handInUrl ?? null} several />
              </>
            ) : spec.handIn === "link" ? (
              <>
                <p className="sub">
                  {card ? `You handed in on ${dayMonth(card.result.handedInAt)}. A new link replaces it.` : "Paste the link to what you posted. The checks start straight away."}
                </p>
                <HandInLinkForm claimId={claim.id} current={card?.result.handInUrl ?? null} />
              </>
            ) : (
              <>
                <p className="sub">
                  {card ? `You handed in on ${dayMonth(card.result.handedInAt)}. A new file replaces it.` : "Send your recording, photo or document. The checks start straight away."}
                </p>
                <HandInFileForm claimId={claim.id} hasFile={Boolean(card)} maxBytes={MAX_HAND_IN_BYTES} />
              </>
            )}
          </section>
        </div>

        <section className="panel pad" aria-labelledby="checked-title">
          <h3 className="t" id="checked-title">
            What gets checked
          </h3>
          <p className="sub">{sentence(job.card.finishLine)} Nobody approves you: if it passes, you are paid.</p>
          <ul className="steps">
            {job.card.howChecked.map((line) => (
              <li key={line}>
                <Icon name="eye" />
                <p>{line}</p>
              </li>
            ))}
            {spec.mustShow.map((rule) => (
              <li key={`show-${rule.id}`}>
                <Icon name="ok" />
                <p>
                  {rule.label}
                  <small>{rule.detail}</small>
                </p>
              </li>
            ))}
            {rules.map((rule) => (
              <li key={`rule-${rule.id}`}>
                <Icon name="flag" />
                <p>
                  {rule.label}
                  <small>{rule.detail}</small>
                </p>
              </li>
            ))}
            {spec.doesNotCount?.length ? (
              <li>
                <Icon name="no" />
                <p>
                  Does not count
                  <small>{spec.doesNotCount.join(". ")}. A find that matches one of these earns nothing.</small>
                </p>
              </li>
            ) : null}
            {job.card.cheatTestsLine ? (
              <li>
                <Icon name="shield" />
                <p>
                  Cheat tests
                  <small>{job.card.cheatTestsLine}</small>
                </p>
              </li>
            ) : null}
            <li>
              <Icon name="clock" />
              <p>
                Ends {longDay(job.endsAt)}
                <small>Or sooner, when the held money is used up.</small>
              </p>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
