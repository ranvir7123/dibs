// GET /api/health: says whether the app can reach its database.
// Made by the Start lane. Shows no keys, addresses or emails.
import { getBoard } from "@/db/read";
import { describeDb } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const board = await getBoard();
    return Response.json({ ok: true, database: await describeDb(), openJobs: board.jobs.length });
  } catch (error) {
    return Response.json({ ok: false, problem: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
