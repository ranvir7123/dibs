/**
 * The front door every lane uses to reach another lane's work:
 *
 *   import { getBoard, payWorker, formatCents } from "@/contract";
 *   import type { Job, ResultCard } from "@/contract/types";
 *
 * This file reaches the database, so it runs on the server only. Screens that
 * run in the browser import shapes from "@/contract/types" and helpers from
 * "@/contract/money" instead.
 *
 * docs/CONTRACT.md lists the same names in plain words. Only the Start lane
 * changes this file.
 */

export type * from "./types";
export { formatCents, isCents } from "./money";
export { settings, type Settings } from "../settings";

// Lane A: money. Stubs until lane A builds them.
export { confirmHold, letGo, payWorker, recordSale, startHold } from "../money";

// Lane B: checkers. Stubs until lane B builds them.
export { runChecks, storeHandInFile, tick, writeJobCard } from "../checkers";

// Start lane: reads and plain writes. Built and tested.
export { getBoard, getJobMoney, getJobPage, getMyJobs, getMyWork, getPerson } from "../db/read";
export { callDibs, createJob, handIn, joinDibs, objectToOpinion } from "../db/write";
export { getDb, type Db } from "../db/client";

/** The cookie that remembers who is using this browser. Its value is a person's id. No passwords. */
export const PERSON_COOKIE = "dibs_person";
