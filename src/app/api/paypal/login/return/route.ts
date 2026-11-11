// GET /api/paypal/login/return: PayPal sends the browser back here after the
// person signed in. Checks the one-time word, asks PayPal who they are, stores
// their PayPal account on the person, remembers them in the dibs_person
// cookie, and goes back to where they were with ?paypal=confirmed (or
// ?paypal=failed, and then only the email way is left). Lane A.
import { joinWithPayPal } from "@/money";
import { loginOn, readLogin } from "@/money/login";
import { siteBase } from "@/money/site";

export const dynamic = "force-dynamic";

function loginCookie(request: Request): { state: string; next: string } | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === "dibs_paypal_login") {
      const value = part.slice(at + 1).trim();
      const dot = value.indexOf(".");
      if (dot > 0) return { state: value.slice(0, dot), next: decodeURIComponent(value.slice(dot + 1)) };
    }
  }
  return null;
}

export async function GET(request: Request) {
  const base = siteBase(request);
  const url = new URL(request.url);
  const kept = loginCookie(request);
  const next = kept && /^\/(?!\/)/.test(kept.next) ? kept.next : "/";
  const back = (outcome: "confirmed" | "failed", personId?: string) => {
    const headers = new Headers({ Location: `${base}${next}${next.includes("?") ? "&" : "?"}paypal=${outcome}`, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", "dibs_paypal_login=; Path=/api/paypal/login; Max-Age=0; HttpOnly; SameSite=Lax");
    if (personId) headers.append("Set-Cookie", `dibs_person=${encodeURIComponent(personId)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax`);
    return new Response(null, { status: 303, headers });
  };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // The one-time word must match the one we sent, or this answer is not for us.
  if (!loginOn() || !code || !kept || !state || state !== kept.state) return back("failed");
  try {
    const who = await readLogin(code);
    const person = await joinWithPayPal({ paypalAccountId: who.paypalAccountId, email: who.email ?? "", name: who.name, verified: who.verified });
    return back("confirmed", person.id);
  } catch (error) {
    console.error("PayPal login not finished:", error instanceof Error ? error.message : error);
    return back("failed");
  }
}