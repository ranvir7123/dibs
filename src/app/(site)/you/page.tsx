import type { Metadata } from "next";
import Link from "next/link";
import { chooseWho } from "../actions";
import { Avatar } from "@/ui/Avatar";
import { Icon } from "@/ui/Icon";
import { JoinForm } from "@/ui/JoinForm";
import { listChoices } from "@/ui/people";
import { getViewer, safeNext } from "@/ui/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Who you are" };

// Choosing who you are. There are no passwords: pick a person, or join with a
// name and the email your PayPal uses.
export default async function YouPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const viewer = await getViewer();
  const choices = await listChoices(viewer);

  return (
    <>
      <div className="head">
        <div>
          <h1>Who are you?</h1>
          <p>
            {viewer
              ? `You are using Dibs as ${viewer.name}. Pay goes to ${viewer.paypalEmail}.`
              : "Dibs has no passwords. Pick who you are, or join with a name and the email your PayPal uses."}
          </p>
        </div>
      </div>

      {viewer ? (
        <nav className="shortcuts" aria-label="Your pages">
          <Link href="/work" className="btn ghost small">
            <Icon name="list" />
            My work
          </Link>
          <Link href="/payouts" className="btn ghost small">
            <Icon name="wallet" />
            Payouts
          </Link>
          <Link href="/people" className="btn ghost small">
            <Icon name="people" />
            Jobs I posted
          </Link>
        </nav>
      ) : null}

      <div className="who-grid">
        <section className="panel pad" aria-labelledby="pick-title">
          <h3 className="t" id="pick-title">
            Carry on as someone already here
          </h3>
          <p className="sub">One tap switches you. Use it to see Dibs as a business and as a worker.</p>
          {choices.length > 0 ? (
            <form action={chooseWho} className="picks">
              <input type="hidden" name="next" value={next} />
              {choices.map(({ person, does }) => {
                const on = viewer?.id === person.id;
                return (
                  <button key={person.id} name="personId" value={person.id} className={on ? "pick on" : "pick"} aria-pressed={on}>
                    <Avatar name={person.name} />
                    <span>
                      <b>{person.name}</b>
                      <small>{on ? "This is you" : does}</small>
                    </span>
                    {on ? <Icon name="ok" /> : null}
                  </button>
                );
              })}
            </form>
          ) : (
            <p className="sub">Nobody has joined yet. Be the first, using the form on this page.</p>
          )}
        </section>

        <section className="panel pad" aria-labelledby="join-title">
          <h3 className="t" id="join-title">
            Join as someone new
          </h3>
          <p className="sub">No password. The email is only used to send your pay.</p>
          <JoinForm next={next} />
        </section>
      </div>
    </>
  );
}
