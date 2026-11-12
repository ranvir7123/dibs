/**
 * The shapes every lane builds against. This file is plain types only, so it is
 * safe to import anywhere, including screens that run in the browser.
 *
 * Rules that hold for every shape:
 * - Money is whole cents in a field ending in "Cents" (1240 means $12.40).
 * - Ids are text. Times are Date objects, except inside JobCard, which AI
 *   writes as plain text and is stored as JSON.
 *
 * docs/CONTRACT.md explains each shape in plain words. If the two disagree,
 * stop and tell the Start lane; do not change this file from another lane.
 */

// ---------------------------------------------------------------- people

/** Someone using Dibs. The same person can post jobs and take jobs. No passwords. */
export interface Person {
  id: string;
  /** The name shown on screen, for example "aarav.clips" or "Kettle & Clove". */
  name: string;
  /** The email their PayPal uses. Payouts go here. One person per email. */
  paypalEmail: string;
  createdAt: Date;
  /** PayPal's own number for their account. Set when they joined with "Log in with PayPal", otherwise null. */
  paypalAccountId: string | null;
  /** What PayPal said about the account when they logged in: true = PayPal has checked who they are. Null when they joined by email. */
  paypalVerified: boolean | null;
}

// ---------------------------------------------------------------- the job card

/** The tab a job sits under on the board. */
export type JobCategory = "promotion" | "testing" | "sales" | "writing" | "design" | "other";

/** How hard the proof is to fake: a PayPal sale is strong, clicks and recordings are medium, views alone are weak. */
export type ProofStrength = "strong" | "medium" | "weak";

/** Where the checker reads the truth from. */
export type EvidenceKind =
  | "public_page" // a public page we can read, such as a video's view count
  | "tracked_link" // a link Dibs owns, counting clicks from different real visitors
  | "paypal_sale" // a sale seen by PayPal that carries the worker's code
  | "ai_watch" // a video, recording or photo that AI looks at
  | "ai_read" // a text file or PDF that AI reads
  | "live_site" // a public web page Dibs opens itself and reads; the worker hands in links
  | "ai_opinion"; // nothing a machine can measure: AI gives its opinion and the poster may object

/** What the worker gives Dibs when they hand in. */
export type HandInKind = "link" | "file" | "none";

/** The thing that is counted when pay is per unit. */
export type CountedUnit = "view" | "click" | "sale" | "item";

/** One yes-or-no rule the checker decides, such as "Reached level 2". */
export interface JobRule {
  /** Short, stable name used to match a Check to its rule, for example "level_2". */
  id: string;
  /** What the worker must do, as shown on screen. */
  label: string;
  /** What the checker looks for, in one plain sentence. */
  detail: string;
}

/** How pay is worked out from what was measured. */
export type PayRule =
  | {
      /** So much for every batch of units: $2.00 for every 1,000 views, or $5.00 for every 1 sale. */
      kind: "per_unit";
      unit: CountedUnit;
      /** The unit in words for the screen: "views", "sale", "bug we can repeat". */
      unitLabel: string;
      centsPerBatch: number;
      batchSize: number;
    }
  | {
      /** So much for each rule passed: $3.00 for each of 5 rules. */
      kind: "per_rule";
      centsPerRule: number;
      rules: JobRule[];
    }
  | {
      /** One fixed amount, paid once when the finish line is met. */
      kind: "once";
      cents: number;
    };

/** A cheat test the checker can run. The thresholds for each live in src/settings.ts. */
export type CheatTestKind =
  | "repeat_visitor"
  | "click_burst"
  | "view_jump"
  | "views_without_likes"
  | "clicks_against_views"
  | "recording_one_take"
  | "recording_right_subject";

/** The machine-readable half of a job card: what the checker actually does. */
export interface CheckerSpec {
  /** Where the truth is read, most important first. */
  evidence: EvidenceKind[];
  /** What the worker hands in. */
  handIn: HandInKind;
  /** Rules that must all pass before any pay, such as "names the brand" for a promo video. */
  mustShow: JobRule[];
  /** The cheat tests to run. */
  cheatTests: CheatTestKind[];
  /** False when no machine can measure the result: AI gives an opinion and the poster has a few days to object. */
  machineCheckable: boolean;
  /**
   * Things the business already knows or does not want, in its own words. A find that matches one earns nothing.
   * Missing on cards saved before this list existed; treat missing as an empty list.
   */
  doesNotCount?: string[];
}

/** What AI writes from the poster's one sentence. The poster reads it before locking any money. */
export interface JobCard {
  title: string;
  category: JobCategory;
  /** The result wanted, in plain words: "10,000 views on your launch video". */
  finishLine: string;
  /** The number to reach, when the finish line is a count. Used for "6,200 of 10,000 so far". */
  target: { unit: CountedUnit; count: number } | null;
  /** How the result is checked, one plain sentence each, for the job card. */
  howChecked: string[];
  /** The same in a few words, for the board: "The video site's own view count". */
  checkedByLine: string;
  /** The cheat tests in plain words. */
  cheatTestsLine: string;
  payRule: PayRule;
  /** The pay rule in words: "$2.00 for every 1,000 views". */
  payLine: string;
  /** The small line under it: "Up to $50.00 in total". */
  payNote: string;
  /** The most this job can ever pay, and the amount held in PayPal. */
  capCents: number;
  /** When the job ends, as an ISO date-time. Never more than settings.maxJobDays after posting. */
  endsAt: string;
  proofStrength: ProofStrength;
  /** Why the proof is that strong: "Views can be bought." */
  proofNote: string;
  /** How the poster could make it stronger, or null. */
  proofTip: string | null;
  /** The poster's own page that tracked links send visitors to, or null when the job uses no link. */
  targetUrl: string | null;
  checker: CheckerSpec;
}

// ---------------------------------------------------------------- jobs, claims, results

/** draft: card written, no money locked. open: money is held, workers can take it. ended: the rest of the hold was let go. */
export type JobStatus = "draft" | "open" | "ended";

/** A result a poster wants, with its pay locked in PayPal once it is open. */
export interface Job {
  id: string;
  posterId: string;
  /** What the poster typed. */
  sentence: string;
  title: string;
  category: JobCategory;
  card: JobCard;
  /** The amount held in PayPal for this job. Same as card.capCents. */
  budgetCents: number;
  status: JobStatus;
  endsAt: Date;
  /** PayPal's number for the order the poster approved. Lane A fills it. */
  paypalOrderId: string | null;
  /** PayPal's number for the hold itself. Lane A fills it, and updates it if the hold is renewed. */
  paypalAuthorizationId: string | null;
  createdAt: Date;
  endedAt: Date | null;
  /** The date PayPal's hold ends, read from PayPal's own answer when the hold was made. Null for a draft. */
  holdEndsAt: Date | null;
}

/** open: the worker called dibs. handed_in: they gave a link or file. closed: the job ended or they dropped it. */
export type ClaimStatus = "open" | "handed_in" | "closed";

/** A worker calling dibs on a job. One per worker per job. */
export interface Claim {
  id: string;
  jobId: string;
  workerId: string;
  status: ClaimStatus;
  createdAt: Date;
}

/**
 * checking: being measured, nothing paid yet.
 * paid: passed its checks and has been paid at least once (it can keep earning).
 * blocked: a check failed; nothing more is paid.
 * waiting: unclear, or an AI opinion the poster can still object to. A person decides.
 */
export type ResultStatus = "checking" | "paid" | "blocked" | "waiting";

/** The numbers the checker last read for a result. Only the ones that apply to the job are present. */
export interface Measured {
  views?: number;
  likes?: number;
  comments?: number;
  /** Every click on the worker's tracked link, cheats included. */
  clicksTotal?: number;
  /** Clicks left after the cheat tests. */
  clicksReal?: number;
  /** Different visitors who clicked. */
  visitors?: number;
  /** Sales PayPal saw with the worker's code. */
  sales?: number;
  /** Counted items for any other per-unit job, such as bugs that could be repeated. */
  items?: number;
  rulesPassed?: number;
  rulesTotal?: number;
  /** Length of the video or recording, in seconds. */
  mediaSeconds?: number;
}

/** What a worker handed in for a claim, and what the checker measured. One per claim. */
export interface Result {
  id: string;
  claimId: string;
  jobId: string;
  workerId: string;
  handInKind: HandInKind;
  /** The link the worker pasted, when they handed in a link. */
  handInUrl: string | null;
  /** Where the uploaded file is kept, as returned by lane B's storeHandInFile. */
  handInFile: string | null;
  handedInAt: Date;
  status: ResultStatus;
  measured: Measured;
  /** Everything this result has earned so far, as worked out by the checker. Lane A pays the part not yet paid. */
  earnedCents: number;
  /** One plain sentence on the outcome: "Everything passed, so this was paid without anyone approving it." */
  summary: string | null;
  /** The footer of the card. Label: "Live cheat check" or "Recording check". */
  watchLabel: string | null;
  /** The footer's sentence: "In the normal range". */
  watchNote: string | null;
  /** True when the footer is good news, false when it reports a cheat. */
  watchOk: boolean | null;
  lastCheckedAt: Date | null;
  /** When the tick should check this result again. Null means never again. */
  nextCheckAt: Date | null;
  /** When the poster's time to object runs out. Only set while status is "waiting" on an AI opinion. */
  objectionEndsAt: Date | null;
  /** When the poster objected to the AI's opinion. Null when they have not. Once set, a person decides and nothing is paid by itself. */
  objectedAt: Date | null;
}

/** must_show: something the hand-in must contain. cheat: a cheat test. rule: one pay rule. opinion: AI's view when nothing can be measured. */
export type CheckGroup = "must_show" | "cheat" | "rule" | "opinion";

/**
 * One check the checker ran on a result, with pass or fail and a plain reason.
 * Only the latest run is kept: one row per result and key.
 */
export interface Check {
  id: string;
  resultId: string;
  /** Stable name of this check within its result: "in_video", "clicks_real", "rule:level_2". */
  key: string;
  group: CheckGroup;
  /** The name on screen: "In the video", "Clicks look real", "Reached level 2". */
  label: string;
  passed: boolean;
  /** The score shown as "3/3": how many parts passed, out of how many. */
  passedCount: number;
  totalCount: number;
  /** Why it passed or failed, in one plain sentence. */
  reason: string;
  /** A short title for a failure: "One visitor, 5,000 clicks". Null when there is none. */
  headline: string | null;
  /** The moment in the recording where this was seen, in seconds. Null when not seen or not a recording. */
  seenAtSeconds: number | null;
  /** The order to show checks in, smallest first. */
  position: number;
  ranAt: Date;
}

/** The numbers for a result at one moment. A new one is added at each check, and the chart is drawn from them. */
export interface Reading {
  id: string;
  resultId: string;
  at: Date;
  views: number | null;
  likes: number | null;
  comments: number | null;
  clicksTotal: number | null;
  clicksReal: number | null;
}

// ---------------------------------------------------------------- money

/**
 * hold: the full budget is locked when the poster approves.
 * take: part of the hold is taken because a result earned it.
 * payout: that money is sent to the worker's PayPal email.
 * let_go: the rest of the hold is released back to the poster.
 */
export type MoneyMoveKind = "hold" | "take" | "payout" | "let_go";

export type MoneyMoveStatus = "pending" | "done" | "failed";

/** One movement of money, with PayPal's own reference. Paid and held totals are always added up from these rows. */
export interface MoneyMove {
  id: string;
  jobId: string;
  /** The result this was for. Null for hold and let_go. */
  resultId: string | null;
  /** The poster for hold and let_go, the worker for take and payout. */
  personId: string | null;
  kind: MoneyMoveKind;
  amountCents: number;
  /** The part Dibs keeps. 0 while the fee is switched off. */
  feeCents: number;
  currency: string;
  status: MoneyMoveStatus;
  /** PayPal's reference for this move. Null until PayPal answers. */
  paypalRef: string | null;
  /** What it was for, in plain words. Sent to the worker with a payout. */
  note: string;
  /** PayPal's error in plain words when status is "failed". */
  error: string | null;
  createdAt: Date;
}

/** A job's money at a glance. locked = paid + held + letGo, always. */
export interface JobMoney {
  /** Held when the poster approved. 0 while the job is a draft. */
  lockedCents: number;
  /** Taken from the hold for results. */
  paidCents: number;
  /** Still held in PayPal. */
  heldCents: number;
  /** Released back to the poster when the job ended. */
  letGoCents: number;
}

// ---------------------------------------------------------------- links, clicks, sales

/** A link Dibs owns, given to one worker for one job. Its code is also the worker's code on sales. */
export interface TrackedLink {
  /** The short code in the address: /r/<code>. */
  code: string;
  claimId: string;
  jobId: string;
  /** Where the visitor is sent on. */
  targetUrl: string;
  createdAt: Date;
}

/** One click on a tracked link. */
export interface Click {
  id: string;
  linkCode: string;
  at: Date;
  /** A scrambled mark for the visitor (never their raw address), the same each time the same visitor clicks. */
  visitorKey: string;
  /** True when this click counts as real. */
  counted: boolean;
  /** Why it was left out, in plain words. Null when it counts. */
  leftOutReason: string | null;
}

/** A sale PayPal saw that carried a worker's code. */
export interface Sale {
  id: string;
  jobId: string;
  claimId: string;
  linkCode: string;
  /** PayPal's number for the buyer's order. One sale per order. */
  paypalOrderId: string;
  /** What the buyer paid. */
  amountCents: number;
  at: Date;
  /** PayPal's number for the payment itself (needed to refund it, and to read its state again). Null on old rows. */
  paypalCaptureId: string | null;
  /** How much of it has been refunded to the buyer, as PayPal last told us. 0 when none. */
  refundedCents: number;
  /** When we last learned of a refund. Null when none. */
  refundedAt: Date | null;
}

/**
 * Where a sale stands for commission.
 * waiting: too new, the refund wait (settings.saleRefundWaitMinutes) is not over.
 * counted: kept in full and past the wait.
 * part_refunded: part was refunded; it still counts as a sale, and keptCents is what was kept.
 * refunded: all of it was refunded; it is not counted and earns nothing.
 */
export type SaleState = "waiting" | "counted" | "part_refunded" | "refunded";

/** One order on the shop owner's orders page. */
export interface ShopOrder {
  sale: Sale;
  /** The worker whose code was on the order. */
  workerName: string;
  jobTitle: string;
  /** What the shop kept: amountCents minus refundedCents. */
  keptCents: number;
  state: SaleState;
  /** When the refund wait ends for this sale. */
  countsAt: Date;
}

// ---------------------------------------------------------------- the money trail

/** locked: the hold was made. payment: money taken from the hold and sent to a worker. released: the rest was let go. */
export type MoneyTrailStepKind = "locked" | "payment" | "released";

/** One line of a job's money trail. */
export interface MoneyTrailStep {
  /** The id of the money move behind this line (for a payment, the payout's; the take's when no payout exists yet). */
  id: string;
  kind: MoneyTrailStepKind;
  when: Date;
  amountCents: number;
  /** pending = still on its way, done, or failed. */
  status: MoneyMoveStatus;
  /** PayPal's reference: the hold's number for locked and released, the payout's number for a payment. Null until PayPal answers. */
  paypalRef: string | null;
  /** For a payment: PayPal's reference for taking it from the hold. Null otherwise. */
  takeRef: string | null;
  /** For a payment: the worker's name. Null otherwise. */
  who: string | null;
  /** What it was for, in plain words. */
  what: string;
}

/** A job's money from start to end, oldest first. */
export interface MoneyTrail {
  jobId: string;
  holdEndsAt: Date | null;
  steps: MoneyTrailStep[];
}

// ---------------------------------------------------------------- PayPal on the page

/** What a page needs to draw PayPal's button. Nothing secret: PayPal's client id is public. */
export interface PayPalSetup {
  clientId: string;
  currency: string;
  /** True when "Log in with PayPal" is switched on (PAYPAL_LOGIN_ON). */
  loginOn: boolean;
}

// ---------------------------------------------------------------- what lane A returns

/** The first half of a hold: PayPal's order, and the page the poster must approve it on. */
export interface HoldStart {
  paypalOrderId: string;
  approveUrl: string;
}

/** What happened when a worker was paid. paidCents is 0 and both moves are null when nothing was owed. */
export interface PayOutcome {
  paidCents: number;
  take: MoneyMove | null;
  payout: MoneyMove | null;
}

// ---------------------------------------------------------------- what lane B returns

/** The checker's answer for one claim. */
export interface CheckReport {
  claimId: string;
  resultId: string;
  status: ResultStatus;
  measured: Measured;
  checks: Check[];
  /** Everything earned so far. Already saved on the result. */
  earnedCents: number;
  summary: string;
}

/** What one run of the tick did. */
export interface TickSummary {
  ranAt: Date;
  checksRun: number;
  payoutsSent: number;
  paidCents: number;
  /** Jobs past their end date whose remaining hold was let go. */
  jobsEnded: number;
  /** Anything that went wrong, in plain words. Empty when all went well. */
  problems: string[];
}

// ---------------------------------------------------------------- what the screens read

/** Everything needed to draw one result card. */
export interface ResultCard {
  result: Result;
  worker: Person;
  /** In the order to show them. */
  checks: Check[];
  /** Oldest first, for the chart. */
  readings: Reading[];
  /** Sum of passedCount over the checks: the "5" in "5 of 5 passed". */
  checksPassed: number;
  checksTotal: number;
  /** Money that has reached this worker for this result. */
  paidCents: number;
  /** The latest payout that went through, for "PayPal reference ...". */
  lastPayout: MoneyMove | null;
  /** The worker's tracked link for this job, if the job uses one. */
  link: TrackedLink | null;
}

/** One job on the board. */
export interface BoardJob {
  job: Job;
  poster: Person;
  money: JobMoney;
  /** Whole days until the job ends, never below 0. */
  daysLeft: number;
}

/** The board: every open job. */
export interface Board {
  jobs: BoardJob[];
  /** How many open jobs are in each tab. "all" is the total. */
  categoryCounts: Record<JobCategory | "all", number>;
  /** The person looking, or null when nobody has joined yet. */
  viewer: Person | null;
  /** What the viewer has been paid across all jobs. */
  viewerEarnedCents: number;
}

/** A job's own page. */
export interface JobPage {
  job: Job;
  poster: Person;
  money: JobMoney;
  daysLeft: number;
  /** Progress to the finish line, when the card has a target: 6,200 of 10,000 views. */
  progress: { unit: CountedUnit; count: number; target: number } | null;
  /** Newest hand-in last. */
  results: ResultCard[];
  /** How many results are in each tab. */
  counts: { all: number; paid: number; checking: number; blocked: number; waiting: number };
  /** Workers who have called dibs but not handed anything in yet. */
  notHandedIn: number;
  /** When numbers were last read for any result on this job. */
  lastReadAt: Date | null;
}

/** One job a worker has called dibs on. */
export interface MyWorkItem {
  claim: Claim;
  job: Job;
  poster: Person;
  link: TrackedLink | null;
  /** Null until the worker hands something in. */
  card: ResultCard | null;
}

/** A worker's own page: their jobs, what each earned and why, and money that arrived. */
export interface MyWork {
  person: Person;
  /** Everything that has reached their PayPal. */
  earnedCents: number;
  /** Newest claim first. */
  items: MyWorkItem[];
  /** Their payouts, newest first. */
  payouts: MoneyMove[];
}
