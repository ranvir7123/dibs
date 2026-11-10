// /api/tick: the address the outside timer calls every minute. It runs the
// due checks and asks lane A to pay. Built by lane B.
//
// The caller must send the password from TICK_SECRET in a header, either
//   Authorization: Bearer <password>      or      x-tick-secret: <password>
// The password is never accepted in the address itself, where it would end up in logs.
import { timingSafeEqual } from "node:crypto";
import { tick } from "@/checkers";

export const dynamic = "force-dynamic";
/** Watching a recording can take minutes. 300 seconds is the most the web host allows. */
export const maxDuration = 300;

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function run(request: Request): Promise<Response> {
  const secret = process.env.TICK_SECRET?.trim();
  if (!secret) return Response.json({ ok: false, problem: "TICK_SECRET is not set, so the tick is switched off." }, { status: 503 });

  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  const given = bearer ?? request.headers.get("x-tick-secret")?.trim() ?? "";
  if (!sameText(given, secret)) return Response.json({ ok: false, problem: "Wrong or missing password." }, { status: 401 });

  const summary = await tick();
  return Response.json({ ok: true, ...summary });
}

export const GET = run;
export const POST = run;
