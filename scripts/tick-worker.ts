/**
 * The background tasks for Render Workflows: the slow checks, where AI
 * watches a video or a recording, or reads a handed-in file.
 *
 *   npm run checks:worker
 *
 * Render starts this program in its "workflow" service (render.yaml,
 * "dibs-checks"). Registering the task below is all it takes: Render's kit
 * sees that it is running on Render and starts serving tasks by itself.
 * Started anywhere else, it registers the task, says so, and ends.
 *
 * The tick starts a run of "runCheck" for each slow check that is due
 * (src/checkers/hand-over.ts). Each run does one claim's check and saves the
 * result; the next tick pays what was earned.
 */
import "../src/db/cli/env";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { CHECK_TASK, runHandedOverCheck } from "../src/checkers/hand-over";

export const runCheck = task(
  {
    name: CHECK_TASK,
    // A long recording takes a few minutes. Ten is the cut-off; one more try if it fails.
    timeoutSeconds: 600,
    retry: { maxRetries: 1, waitDurationMs: 30_000 },
  },
  async function runCheck(_ctx: TaskContext, claimId: string) {
    return runHandedOverCheck(claimId);
  },
);

if (!process.env.RENDER_SDK_SOCKET_PATH) {
  console.log(`Registered the task "${CHECK_TASK}". Not running on Render, so there is nothing to serve; ending.`);
}
