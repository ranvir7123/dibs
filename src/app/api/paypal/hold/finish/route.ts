// POST /api/paypal/hold/finish { jobId, orderId? }: called by the page when
// PayPal's button says the poster approved. Locks the money and opens the
// job. Only the job's poster may ask. Everything else is read from PayPal's
// own answer: confirmHold checks that the order carries this job's label and
// this job's amount, and that its payer approved it, before anything is
// locked. Answers { ok, jobId, holdEndsAt }. Lane A.
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { confirmHold } from "@/money";
import { bodyOf, callerId, failed, no, yes } from "@/money/answer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await bodyOf(request);
  const jobId = String(body.jobId ?? "");
  const orderId = typeof body.orderId === "string" && /^[A-Z0-9]{6,40}$/.test(body.orderId) ? body.orderId : undefined;
  if (!jobId) return no("Which job is this for?");
  try {
    const db = await getDb();
    const before = (await db.select({ posterId: jobs.posterId }).from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!before) return no("No such job.", 404);
    if (before.posterId !== callerId(request)) return no("Only the person who posted this job can lock its money.", 403);
    await confirmHold(jobId, orderId);
    const job = (await db.select({ holdEndsAt: jobs.holdEndsAt }).from(jobs).where(eq(jobs.id, jobId)))[0];
    return yes({ jobId, holdEndsAt: job?.holdEndsAt?.toISOString() ?? null });
  } catch (error) {
    return failed(error, "Hold not finished");
  }
}