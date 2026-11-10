// GET /r/<code>: a worker's tracked link. Stores the click (with a scrambled
// mark for the visitor, never their raw address) and sends the visitor on to
// the poster's page. Built by lane B.
import { recordClick, visitorKeyFromHeaders } from "@/checkers/clicks";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const outcome = /^[a-z0-9]{4,32}$/.test(code) ? await recordClick(code, visitorKeyFromHeaders(request.headers)) : null;
    if (!outcome) return new Response("This Dibs link does not exist.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response(null, { status: 307, headers: { Location: outcome.targetUrl, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Tracked link problem:", error instanceof Error ? error.message : error);
    return new Response("This Dibs link is not working right now. Please try again.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
