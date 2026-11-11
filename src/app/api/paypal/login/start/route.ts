// GET /api/paypal/login/start?next=<path>: sends the browser to PayPal's test
// sign-in. Only when PAYPAL_LOGIN_ON=1. A one-time word ("state") is kept in a
// cookie and checked when the browser comes back. Lane A.
import { randomBytes } from "node:crypto";
import { loginOn, loginUrl } from "@/money/login";
import { siteBase } from "@/money/site";

export const dynamic = "force-dynamic";

/** Only a path on this site may be the place to come back to. */
function safeNext(value: string | null): string {
  return value && /^\/(?!\/)[\w\-./?=&%~]*$/.test(value) ? value : "/";
}

export async function GET(request: Request) {
  if (!loginOn()) return new Response("Log in with PayPal is switched off.", { status: 404 });
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const state = randomBytes(16).toString("hex");
  const cookie = `dibs_paypal_login=${state}.${encodeURIComponent(next)}; Path=/api/paypal/login; Max-Age=600; HttpOnly; SameSite=Lax`;
  return new Response(null, { status: 303, headers: { Location: loginUrl({ base: siteBase(request), state }), "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}