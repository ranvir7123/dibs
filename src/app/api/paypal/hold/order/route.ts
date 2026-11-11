// POST /api/paypal/hold/order { jobId }: makes the PayPal order for a job's
// hold, for PayPal's button (its window opens over the page). Only the job's
// poster may ask. Answers { ok, orderId }. Lane A.
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { startHoldOrder } from "@/money";
import { bodyOf, callerId, failed, no, yes } from "@/money/answer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const jobId = String((await bodyOf(request)).jobId ?? "");
  if (!jobId) return no("Which job is this for?");
  try {
    const db = await getDb();
    const job = (await db.select({ posterId: jobs.posterId }).from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!job) return no("No such job.", 404);
    if (job.posterId !== callerId(request)) return no("Only the person who posted this job can lock its money.", 403);
    const order = await startHoldOrder(jobId);
    return yes({ orderId: order.paypalOrderId });
  } catch (error) {
    return failed(error, "Hold order not made");
  }
}