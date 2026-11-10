// GET /api/paypal/hold/return?job=<jobId>: PayPal sends the poster back here
// after they approved the hold. Locks the money, opens the job, and shows the
// job page. Lane A.
import { confirmHold } from "@/money";
import { siteBase } from "@/money/site";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = siteBase(request);
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  if (!jobId) return Response.redirect(`${base}/`, 303);
  try {
    await confirmHold(jobId);
    return Response.redirect(`${base}/jobs/${encodeURIComponent(jobId)}?hold=locked`, 303);
  } catch (error) {
    console.error("Hold not confirmed:", error instanceof Error ? error.message : error);
    return Response.redirect(`${base}/post/${encodeURIComponent(jobId)}?hold=failed`, 303);
  }
}
