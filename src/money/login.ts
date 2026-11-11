/**
 * "Log in with PayPal", behind a switch (PAYPAL_LOGIN_ON=1), and the public
 * values a page needs to draw PayPal's button.
 *
 * How the login goes: our start address sends the browser to PayPal's test
 * sign-in; PayPal sends it back with a one-time code; we swap the code for a
 * pass and ask PayPal who the person is. Their PayPal account number and
 * whether PayPal has checked them are stored on the person.
 */
import { eq } from "drizzle-orm";
import type { PayPalSetup, Person } from "../contract/types";
import { getDb } from "../db/client";
import { newId } from "../db/ids";
import { people } from "../db/schema";
import { settings } from "../settings";
import { appSignIn, PayPalProblem } from "./paypal";
import { MoneyRefusal } from "./refusal";

const SIGN_IN_PAGE = "https://www.sandbox.paypal.com/connect";
const ASKED_FOR = "openid email https://uri.paypal.com/services/paypalattributes";

/** True when "Log in with PayPal" is switched on. */
export function loginOn(): boolean {
  return process.env.PAYPAL_LOGIN_ON?.trim() === "1";
}

/** The public values a page needs for PayPal's button and login. PayPal's client id is not a secret: it is in every page that shows the button. */
export function getPayPalSetup(): PayPalSetup {
  return { clientId: process.env.PAYPAL_CLIENT_ID?.trim() ?? "", currency: settings.currency, loginOn: loginOn() };
}

/** The address PayPal sends the browser back to. This exact text must be registered on the PayPal app. */
export function loginReturnUrl(base: string): string {
  return `${base}/api/paypal/login/return`;
}

/** PayPal's sign-in page for our app. state is a one-time word we check when the browser comes back. */
export function loginUrl(input: { base: string; state: string }): string {
  const to = new URL(SIGN_IN_PAGE);
  to.searchParams.set("flowEntry", "static");
  to.searchParams.set("client_id", process.env.PAYPAL_CLIENT_ID?.trim() ?? "");
  to.searchParams.set("response_type", "code");
  to.searchParams.set("scope", ASKED_FOR);
  to.searchParams.set("redirect_uri", loginReturnUrl(input.base));
  to.searchParams.set("state", input.state);
  return to.toString();
}

export interface PayPalIdentity {
  paypalAccountId: string;
  email: string | null;
  name: string | null;
  verified: boolean | null;
}

/** Swaps PayPal's one-time code for a pass and asks PayPal who the person is. */
export async function readLogin(code: string): Promise<PayPalIdentity> {
  const { base, header } = appSignIn();
  let who: Record<string, unknown>;
  try {
    const swap = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: header, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code)}`,
      signal: AbortSignal.timeout(30_000),
    });
    const pass = (await swap.json().catch(() => ({}))) as Record<string, unknown>;
    if (!swap.ok || typeof pass.access_token !== "string") throw new PayPalProblem(`PayPal did not accept the login code (status ${swap.status}).`, swap.status, ["LOGIN_CODE_REFUSED"]);
    const asked = await fetch(`${base}/v1/identity/openidconnect/userinfo?schema=openid`, {
      headers: { Authorization: `Bearer ${pass.access_token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    who = (await asked.json().catch(() => ({}))) as Record<string, unknown>;
    if (!asked.ok) throw new PayPalProblem(`PayPal did not say who logged in (status ${asked.status}).`, asked.status, ["LOGIN_WHO_REFUSED"]);
  } catch (error) {
    if (error instanceof PayPalProblem) throw error;
    throw new PayPalProblem("Could not reach PayPal test mode for the login.", 0, ["UNREACHABLE"]);
  }
  return identityFrom(who);
}

/** Picks the account number, email, name and checked mark out of what PayPal told us. */
export function identityFrom(who: Record<string, unknown>): PayPalIdentity {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  // PayPal gives the account either as payer_id or as the last part of user_id (an address ending in the number).
  const paypalAccountId = text(who.payer_id) ?? text(who.user_id)?.split("/").pop() ?? null;
  if (!paypalAccountId) throw new MoneyRefusal("PayPal did not say which account logged in.");
  const emails = Array.isArray(who.emails) ? (who.emails as Record<string, unknown>[]) : [];
  const email = text(who.email) ?? text(emails.find((e) => e.primary === true)?.value) ?? text(emails[0]?.value);
  const mark = who.verified_account ?? who.verified;
  const verified = mark === true || mark === "true" ? true : mark === false || mark === "false" ? false : null;
  return { paypalAccountId, email: email ? email.toLowerCase() : null, name: text(who.name), verified };
}

/**
 * Finds the person with this PayPal account (or, failing that, this email) or
 * makes one, and stores the account number and whether PayPal has checked
 * them. Payouts go to the email PayPal gave.
 */
export async function joinWithPayPal(input: { paypalAccountId: string; email: string; name?: string | null; verified: boolean | null }): Promise<Person> {
  const paypalAccountId = input.paypalAccountId.trim();
  const email = input.email.trim().toLowerCase();
  if (!paypalAccountId) throw new MoneyRefusal("PayPal did not say which account logged in.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MoneyRefusal("PayPal did not share an email for this account, so it cannot be paid. Join with the email your PayPal uses instead.");
  const mark = { paypalAccountId, paypalVerified: input.verified };

  const db = await getDb();
  const byAccount = (await db.select().from(people).where(eq(people.paypalAccountId, paypalAccountId)))[0];
  if (byAccount) return (await db.update(people).set({ paypalVerified: input.verified }).where(eq(people.id, byAccount.id)).returning())[0];

  // Joined by email before: the same person, now with their account confirmed.
  const byEmail = (await db.select().from(people).where(eq(people.paypalEmail, email)))[0];
  if (byEmail) return (await db.update(people).set(mark).where(eq(people.id, byEmail.id)).returning())[0];

  const name = input.name?.trim() || email.split("@")[0];
  await db.insert(people).values({ id: newId("per"), name, paypalEmail: email, ...mark }).onConflictDoNothing();
  // Two logins at the same moment: whichever row was made is the person.
  return (await db.select().from(people).where(eq(people.paypalAccountId, paypalAccountId)))[0] ?? (await db.select().from(people).where(eq(people.paypalEmail, email)))[0];
}
