// GET /api/paypal/hold/cancel?job=<jobId>: the poster backed out on PayPal's
// page. No money was locked; they go back to the job card. Lane A.
import { siteBase } from "@/money/site";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = siteBase(request);
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  return Response.redirect(jobId ? `${base}/post/${encodeURIComponent(jobId)}?hold=cancelled` : `${base}/`, 303);
}
