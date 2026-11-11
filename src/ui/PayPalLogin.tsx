"use client";

/**
 * "Log in with PayPal": the second way to join, beside typing an email.
 *
 *   <PayPalLogin next="/work" />                 the link
 *   <PayPalLogin confirmed />                    after coming back with ?paypal=confirmed
 *   <PayPalLogin next="/work" failed />          after coming back with ?paypal=failed
 *
 * It draws nothing while the switch (PAYPAL_LOGIN_ON) is off, so only the
 * email way shows. next is the path on this site to come back to.
 */
import { useEffect, useState } from "react";

export default function PayPalLogin({ next = "/", confirmed = false, failed = false }: { next?: string; confirmed?: boolean; failed?: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/paypal/setup")
      .then((response) => response.json())
      .then((setup: { loginOn?: boolean }) => live && setOn(setup.loginOn === true))
      .catch(() => live && setOn(false));
    return () => {
      live = false;
    };
  }, []);

  if (confirmed) {
    return (
      <p className="notice ok" role="status">
        <span>
          <b>PayPal account confirmed</b>
          You logged in with PayPal, so your pay goes to that account.
        </span>
      </p>
    );
  }
  // Off, or not known yet: nothing, so the email way is the only one shown.
  if (!on) return null;
  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {failed ? (
        <p className="notice stop" role="alert">
          PayPal could not confirm your account this time. You can try again, or join with your email instead.
        </p>
      ) : null}
      <a className="btn ghost" href={`/api/paypal/login/start?next=${encodeURIComponent(next)}`}>
        Log in with PayPal
      </a>
      <p className="sub">You sign in on PayPal&rsquo;s own page. Dibs never sees your password. This is PayPal&rsquo;s test site.</p>
    </div>
  );
}
