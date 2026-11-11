// POST /api/paypal/hold/finish { jobId, orderId? }: called by the page when
// PayPal's button says the poster approved. Locks the money and opens the
// job. Everything is read from PayPal's own answer; nothing here trusts the
// page. Answers { ok, jobId, holdEndsAt }. Lane A.
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { confirmHold } from "@/money";
import { bodyOf, failed, no, yes } from "@/money/answer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await bodyOf(request);
  const jobId = String(body.jobId ?? "");
  const orderId = typeof body.orderId === "string" && /^[A-Z0-9]{6,40}$/.test(body.orderId) ? body.orderId : undefined;
  if (!jobId) return no("Which job is this for?");
  try {
    await confirmHold(jobId, orderId);
    const db = await getDb();
    const job = (await db.select({ holdEndsAt: jobs.holdEndsAt }).from(jobs).where(eq(jobs.id, jobId)))[0];
    return yes({ jobId, holdEndsAt: job?.holdEndsAt?.toISOString() ?? null });
  } catch (error) {
    return failed(error, "Hold not finished");
  }
}