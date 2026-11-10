# Dibs: the contract

The one file all lanes build against. Written by the Start lane on Tue 10 Nov 2026.

**If something here is wrong or missing, do not change it and do not work around it. Stop and say so**, so every lane hears about the change at once. Only the Start lane (or Ranvir) edits this file and `src/contract/`.

The real code is in `src/contract/`. This file says the same things in plain words. A test (`src/contract/doc.test.ts`) fails if a name in the code is missing from this file.

## 1. Who owns what

| Lane | Owns these folders | Its functions live in |
|---|---|---|
| Start (done) | project files, `src/db/`, `src/contract/`, `src/settings.ts`, `src/app/layout.tsx`, `src/app/api/health/`, `docs/CONTRACT.md` | `src/db/read.ts`, `src/db/write.ts` |
| A. Money | `src/money/`, `src/app/api/paypal/`, `src/app/shop/` | `src/money/index.ts` |
| B. Checkers | `src/checkers/`, `src/ai/`, `src/app/r/`, `src/app/api/tick/` | `src/checkers/index.ts` |
| C. Screens | `src/app/(site)/`, `src/ui/`, `src/app/globals.css` (and may edit `src/app/layout.tsx`) | none |
| D. Demo and hand-in | `scripts/`, `docs/` (not this file), `README.md` | none |

Write only inside your own folders. To use another lane's work, import it from the contract:

```ts
import { getBoard, payWorker, formatCents, settings } from "@/contract";   // server code only
import type { Job, ResultCard } from "@/contract/types";                   // safe anywhere
import { formatCents } from "@/contract/money";                            // safe anywhere
```

`@/contract` reaches the database, so it works on the server only. A screen that runs in the browser (a file starting with `"use client"`) imports from `@/contract/types` and `@/contract/money`.

Lane A's and lane B's functions already exist with their final names, inputs and outputs. Until the lane builds one, calling it fails with the message `not built yet: lane A owns payWorker` (or the matching lane and name). **Fill in the body; keep the name, inputs and outputs.** When you build one, delete its line from `src/contract/stubs.test.ts` and add your own tests in your folder.

## 2. Rules for every shape

- **Money is whole cents**, in fields ending in `Cents`. `1240` means $12.40. Never a decimal. Show it with `formatCents(1240)` → `"$12.40"`. Check it with `isCents(value)`.
- **Paid and held money is never stored.** It is added up from the money moves, by `getJobMoney` and the other reads. Do not add a "paid so far" column.
- **Ids are text** like `job_k3m9x2pq7w4n`. Make one with `newId("job")` from `@/db/ids`. Prefixes: `per`, `job`, `clm`, `res`, `chk`, `rdg`, `mov`, `clk`, `sal`.
- **Times are `Date`**, except `JobCard.endsAt`, which is text (an ISO date-time) because AI writes the card and it is stored as JSON.
- **Who am I:** there are no passwords. The cookie `dibs_person` (exported as `PERSON_COOKIE`) holds the person's id.
- **Dark only.** There is no light mode.

## 3. The shapes

All are in `src/contract/types.ts`, each field with its own comment. Each table in the database has exactly the fields of its shape (`src/db/schema.check.ts` makes the type check fail if they drift).

### People and jobs

| Shape | What it is |
|---|---|
| `Person` | Someone using Dibs: `id`, `name`, `paypalEmail` (payouts go here; one person per email), `createdAt`. The same person can post and work. |
| `Job` | A result a poster wants. `id`, `posterId`, `sentence` (what they typed), `title`, `category`, `card` (the JobCard), `budgetCents` (the amount held; equals `card.capCents`), `status`, `endsAt`, `paypalOrderId` and `paypalAuthorizationId` (PayPal's numbers for the hold, filled by lane A), `createdAt`, `endedAt`. |
| `JobStatus` | `draft` (card written, no money locked, not on the board) → `open` (money held, workers can take it) → `ended` (the rest of the hold was let go). |
| `JobCategory` | The board tab: `promotion`, `testing`, `sales`, `writing`, `design`, `other`. |

### The job card (what AI writes)

| Shape | What it is |
|---|---|
| `JobCard` | Everything the poster reads before locking money. Fields below. |
| `PayRule` | How pay is worked out. One of three kinds, below. |
| `CheckerSpec` | The part of the card the checker's code reads: `evidence`, `handIn`, `mustShow`, `cheatTests`, `machineCheckable`. |
| `JobRule` | One yes-or-no rule: `id` (short stable name), `label` (shown on screen), `detail` (what the checker looks for). |
| `EvidenceKind` | Where the truth is read: `public_page`, `tracked_link`, `paypal_sale`, `ai_watch`, `ai_read`, `live_site` (not in the first build), `ai_opinion` (nothing can be measured). |
| `HandInKind` | What the worker gives: `link`, `file` or `none`. |
| `CountedUnit` | What is counted for per-unit pay: `view`, `click`, `sale`, `item`. |
| `CheatTestKind` | `repeat_visitor`, `click_burst`, `view_jump`, `views_without_likes`, `clicks_against_views`, `recording_one_take`, `recording_right_subject`. Thresholds are in `src/settings.ts`. |
| `ProofStrength` | `strong` (a PayPal sale), `medium` (clicks, recordings), `weak` (views alone). |

`JobCard` fields, with the example from the drawing:

| Field | Example |
|---|---|
| `title` | "Get our launch video 10,000 views" |
| `category` | `promotion` |
| `finishLine` | "10,000 views on your launch video" |
| `target` | `{ unit: "view", count: 10000 }`, or `null` when the finish line is not a count |
| `howChecked` | A list of plain sentences: "Views are read from the video site's own count every 10 minutes." |
| `checkedByLine` | The short version for the board: "The video site's own view count" |
| `cheatTestsLine` | "Sudden jumps in views. Views with no likes or clicks. One visitor clicking many times." |
| `payRule` | See below |
| `payLine` | "$2.00 for every 1,000 views" |
| `payNote` | "Up to $50.00 in total" |
| `capCents` | `5000`: the most the job can pay, and the amount held |
| `endsAt` | ISO date-time text. At most `settings.maxJobDays` (21) days after posting. |
| `proofStrength`, `proofNote`, `proofTip` | `medium`, "Views can be bought.", "Paying for clicks on your link as well would make this stronger." (`proofTip` may be `null`) |
| `targetUrl` | The poster's page that tracked links send visitors to, or `null` |
| `checker` | The `CheckerSpec` |

`PayRule` kinds:

| `kind` | Fields | Means |
|---|---|---|
| `per_unit` | `unit`, `unitLabel`, `centsPerBatch`, `batchSize` | $2.00 for every 1,000 views is `centsPerBatch: 200, batchSize: 1000`. $5.00 a sale is `500` and `1`. |
| `per_rule` | `centsPerRule`, `rules` (a list of `JobRule`) | $3.00 for each of 5 rules passed. |
| `once` | `cents` | One fixed amount when the finish line is met. |

### Claims, results, checks

| Shape | What it is |
|---|---|
| `Claim` | A worker calling dibs on a job. One per worker per job. `id`, `jobId`, `workerId`, `status`, `createdAt`. |
| `ClaimStatus` | `open` (called dibs) → `handed_in` (gave a link or file) → `closed` (job ended or dropped). |
| `Result` | What the worker handed in and what the checker measured. One per claim. `id`, `claimId`, `jobId`, `workerId`, `handInKind`, `handInUrl`, `handInFile`, `handedInAt`, `status`, `measured`, `earnedCents`, `summary`, `watchLabel`, `watchNote`, `watchOk`, `lastCheckedAt`, `nextCheckAt`, `objectionEndsAt`, `objectedAt`. |
| `ResultStatus` | `checking` (being measured, nothing paid yet), `paid` (passed and paid at least once; it can keep earning), `blocked` (a check failed, nothing more is paid), `waiting` (unclear, or an AI opinion the poster can still object to). |
| `Measured` | The numbers last read. Only those that apply are present: `views`, `likes`, `comments`, `clicksTotal` (cheats included), `clicksReal` (after cheat tests), `visitors`, `sales`, `items`, `rulesPassed`, `rulesTotal`, `mediaSeconds`. |
| `Check` | One check the checker ran, with pass or fail and a plain reason. `id`, `resultId`, `key`, `group`, `label`, `passed`, `passedCount`, `totalCount`, `reason`, `headline`, `seenAtSeconds`, `position`, `ranAt`. |
| `CheckGroup` | `must_show` (the hand-in must contain it), `cheat` (a cheat test), `rule` (one pay rule), `opinion` (AI's view when nothing can be measured). |
| `Reading` | The numbers for a result at one moment, for the chart: `id`, `resultId`, `at`, `views`, `likes`, `comments`, `clicksTotal`, `clicksReal`. |

Things to know:

- **`Result.earnedCents` is the checker's running total** of everything the result has earned. Lane B sets it. Lane A pays the part not yet paid.
- **Checks keep the latest run only**: one row per result and `key` (for example `in_video`, `clicks_real`, `rule:level_2`). On each run lane B replaces them. The history of the numbers is in `Reading`: add one row per run.
- **The score on screen** ("3/3") is `passedCount`/`totalCount`. "5 of 5 passed" is the sum over a result's checks.
- **`seenAtSeconds`** is the moment in a recording (48 → "00:48"); `null` shows as "Not seen".
- **The card's footer** ("Live cheat check: In the normal range") is `watchLabel`, `watchNote`, `watchOk`.
- **`nextCheckAt`** tells the tick when to check again. `null` means never again.
- **`earnedCents` never goes down.** If a later check blocks a result that was already paid, the status becomes `blocked` and nothing more is paid; nothing is taken back.
- **Who writes `status`:** lane B writes `checking`, `blocked` and `waiting`. Lane A writes `paid` when money goes out. Once a result is `paid`, lane B leaves it `paid` on later runs, unless a check now fails and it becomes `blocked`.
- **AI opinions (`machineCheckable: false`):** lane B's first run sets status `waiting`, `objectionEndsAt` to now plus `settings.objectionWindowDays`, writes an `opinion` check with AI's view, and leaves `earnedCents` at 0. The poster may call `objectToOpinion` inside the window; that sets `objectedAt`, and from then on a person decides and the tick leaves the result alone. If the window ends with `objectedAt` still `null`, the tick sets `earnedCents` and the result is paid like any other.

### Money

| Shape | What it is |
|---|---|
| `MoneyMove` | One movement of money with PayPal's reference. `id`, `jobId`, `resultId`, `personId`, `kind`, `amountCents`, `feeCents`, `currency`, `status`, `paypalRef`, `note`, `error`, `createdAt`. |
| `MoneyMoveKind` | `hold` (budget locked), `take` (part of the hold taken for a result), `payout` (sent to the worker's PayPal email), `let_go` (the rest released to the poster). |
| `MoneyMoveStatus` | `pending`, `done`, `failed`. Only `done` moves count in any total. |
| `JobMoney` | A job's money at a glance: `lockedCents`, `paidCents` (taken from the hold), `heldCents`, `letGoCents`. Always: locked = paid + held + let go. |
| `HoldStart` | What `startHold` returns: `paypalOrderId`, `approveUrl`. |
| `PayOutcome` | What `payWorker` returns: `paidCents`, `take`, `payout` (0 and two `null`s when nothing was owed). |

One payment to a worker is **two rows**: a `take` (money leaves the poster's hold) and a `payout` (money reaches the worker), both with `resultId` and the worker as `personId`. A job's "paid" is the sum of `take` rows; a worker's "earned" is the sum of `payout` rows.

### Links, clicks, sales

| Shape | What it is |
|---|---|
| `TrackedLink` | A link Dibs owns, for one worker on one job: `code` (the address is `/r/<code>`), `claimId`, `jobId`, `targetUrl`, `createdAt`. The code is also the worker's code on sales. |
| `Click` | One click: `id`, `linkCode`, `at`, `visitorKey` (a scrambled mark for the visitor, never their raw address), `counted`, `leftOutReason`. |
| `Sale` | A sale PayPal saw with a worker's code: `id`, `jobId`, `claimId`, `linkCode`, `paypalOrderId` (one sale per order), `amountCents`, `at`. |

### What the screens get

| Shape | What it is |
|---|---|
| `Board` | `jobs` (a list of `BoardJob`), `categoryCounts` (open jobs per tab, plus `all`), `viewer`, `viewerEarnedCents`. |
| `BoardJob` | `job`, `poster`, `money` (`JobMoney`), `daysLeft`. |
| `JobPage` | `job`, `poster`, `money`, `daysLeft`, `progress` (`unit`, `count`, `target`, or `null`), `results` (a list of `ResultCard`), `counts` (`all`, `paid`, `checking`, `blocked`, `waiting`), `notHandedIn` (workers who called dibs and have not handed in), `lastReadAt`. |
| `ResultCard` | Everything for one result card: `result`, `worker`, `checks` (in order), `readings` (oldest first), `checksPassed`, `checksTotal`, `paidCents`, `lastPayout` (for "PayPal reference ..."), `link`. |
| `MyWork` | A worker's own page: `person`, `earnedCents`, `items` (a list of `MyWorkItem`), `payouts`. |
| `MyWorkItem` | `claim`, `job`, `poster`, `link`, `card` (`null` until they hand in). |
| `CheckReport` | What `runChecks` returns: `claimId`, `resultId`, `status`, `measured`, `checks`, `earnedCents`, `summary`. |
| `TickSummary` | What `tick` returns: `ranAt`, `checksRun`, `payoutsSent`, `paidCents`, `jobsEnded`, `problems`. |

## 4. The functions

### Lane A owns (stubs now, in `src/money/index.ts`)

```ts
startHold(jobId: string): Promise<HoldStart>
confirmHold(jobId: string): Promise<MoneyMove>
payWorker(resultId: string): Promise<PayOutcome>
letGo(jobId: string): Promise<MoneyMove>
recordSale(input: { paypalOrderId: string; linkCode: string; amountCents: number }): Promise<Sale>
```

| Function | What it must do |
|---|---|
| `startHold` | For a `draft` job: ask PayPal to hold `job.budgetCents`, save `paypalOrderId` on the job, return PayPal's approval page for the poster. |
| `confirmHold` | After the poster approved: lock the money, save `paypalAuthorizationId`, add a `hold` money move, set the job `open`. Safe to call twice. |
| `payWorker` | Pay what is owed. **Owed = `result.earnedCents` minus this result's `take` moves that are `done` or `pending`** (never below 0, never more than is still held). Take that from the hold (a `take` move), then send it to the worker's `paypalEmail` (a `payout` move, with a note saying what it was for). If an earlier `take` is `done` but its `payout` is not, **send that payout again; do not take again.** Two calls at once must not both pay: in one short database transaction, lock the result's row (`select ... for update`), work out what is owed and write the `take` row as `pending`; end the transaction; only then call PayPal, and afterwards mark the row `done` or `failed`. A `failed` take no longer counts, so the next call tries again. A second call finds nothing owed and returns `paidCents: 0`. Sets the result's status to `paid` when money went out. Fee: the `take` is the full owed amount; when `settings.feeTakenFromPayouts` is 1 the `payout` is the take minus the fee, and both rows carry the fee in `feeCents`. |
| `letGo` | Release the rest of the hold, add a `let_go` move, set the job `ended` and `endedAt`, and set every claim on the job to `closed`. Safe to call twice. |
| `recordSale` | Store a sale against the claim that `linkCode` belongs to. A repeat of the same `paypalOrderId` returns the sale already stored. Called from lane A's own shop page or PayPal's message to our server. |

AI never calls PayPal. Only this folder does.

### Lane B owns (stubs now, in `src/checkers/index.ts`)

```ts
writeJobCard(input: { sentence: string; posterName: string }): Promise<JobCard>
runChecks(claimId: string): Promise<CheckReport>
tick(now?: Date): Promise<TickSummary>
storeHandInFile(input: { claimId: string; fileName: string; bytes: Uint8Array }): Promise<string>
```

| Function | What it must do |
|---|---|
| `writeJobCard` | AI turns one sentence into a `JobCard`. Saves nothing. If no machine can measure the result, set `checker.machineCheckable` to `false` and say so in `howChecked`, before any money is locked. Keep `endsAt` within `settings.maxJobDays`. |
| `runChecks` | For one claim's result: read the numbers from the source, run the cheat tests, work out `earnedCents`, then save the checks (replacing the last run), one `Reading`, and the result (`measured`, `status`, `earnedCents`, `summary`, the footer, `lastCheckedAt`, `nextCheckAt`). **Moves no money.** Never set status `paid` yourself: lane A does that when money goes out. |
| `tick` | Called every minute by an outside timer through `src/app/api/tick/`. Runs `runChecks` for every result whose `nextCheckAt` has passed; calls `payWorker` for results that are owed at least `settings.minPayoutCents`, no more often per job than `settings.payBatchMinutes`; for open jobs past `endsAt`, runs one last `runChecks` and `payWorker` for each result (ignoring the batch wait), then calls `letGo`. "Last paid" for a job is not stored: it is the newest `createdAt` among the job's `take` moves. One failure must not stop the rest: put it in `problems`. |
| `storeHandInFile` | Keep an uploaded file and return where it is kept. The screen passes that text to `handIn` as `file`. |

Lane B also owns the tracked link address `src/app/r/[code]/`, which adds a `Click` row and sends the visitor on to `TrackedLink.targetUrl`.

### Start lane built these (working and tested, in `src/db/`)

```ts
getBoard(viewerId?: string | null): Promise<Board>
getJobPage(jobId: string): Promise<JobPage | null>
getMyWork(personId: string): Promise<MyWork | null>
getPerson(personId: string): Promise<Person | null>
getJobMoney(jobId: string): Promise<JobMoney>
getMyJobs(posterId: string): Promise<BoardJob[]>

joinDibs(input: { name: string; paypalEmail: string }): Promise<Person>
createJob(input: { posterId: string; sentence: string; card: JobCard }): Promise<Job>
callDibs(input: { jobId: string; workerId: string }): Promise<{ claim: Claim; link: TrackedLink | null; result: Result | null }>
handIn(input: { claimId: string; url?: string; file?: string }): Promise<Result>
objectToOpinion(input: { resultId: string; posterId: string }): Promise<Result>

getDb(): Promise<Db>
```

| Function | What it does |
|---|---|
| `getBoard` | Every `open` job, newest first, with its money and days left. Pass the viewer's id to get what they have earned. |
| `getJobPage` | One job with its money, progress and every result card. `null` for an unknown id. Works for drafts. |
| `getMyWork` | A worker's claims, result cards and payouts. `null` for an unknown person. |
| `getPerson` | One person, or `null`. |
| `getJobMoney` | Locked, paid, held, let go, added up from the money moves. All zero for an unknown or draft job. |
| `getMyJobs` | Every job a person has posted, newest first, with its money: drafts, open and ended. For the poster's side of the site. |
| `joinDibs` | Makes a person, or returns the one who already joined with that email. |
| `createJob` | Stores an approved card as a `draft` job. Refuses a budget that is not whole cents, an end date in the past or more than 21 days away, a pay rule that is not whole cents or could never pay, and a card that counts clicks or sales but has no `targetUrl`. |
| `callDibs` | Makes the claim (or returns the one that exists). Makes the worker's tracked link when the job's evidence includes `tracked_link` or `paypal_sale` and the card has a `targetUrl`. When the job's `handIn` is `none` (a sales job), it also makes the result so measuring starts at once. Refuses a job that is not `open`. |
| `handIn` | Makes the result for a claim (status `checking`, `nextCheckAt` now) from a link or a file, whichever the job asks for. Handing in again replaces the link or file. Refuses once the job has ended. |
| `objectToOpinion` | The poster objects to an AI opinion on a `waiting` result before `objectionEndsAt`. Sets `objectedAt` and stops the tick touching the result. Only the job's poster may call it. |
| `getDb` | The database handle, for lanes that need their own queries: `const db = await getDb()`, with the tables from `@/db/schema`. |

These throw an `Error` with a plain sentence when the input is wrong ("Please give the email your PayPal uses."). Screens can show `error.message` as it is.

### How the pieces meet

| Moment | Calls, in order |
|---|---|
| Posting a job | `writeJobCard` (B) → poster reads the card → `createJob` (Start) → `startHold` (A) → poster approves on PayPal → `confirmHold` (A) |
| Taking a job | `joinDibs` (Start) → `callDibs` (Start) → for a file: `storeHandInFile` (B) → `handIn` (Start) |
| Every minute | `tick` (B) → `runChecks` (B) → `payWorker` (A) → `letGo` (A) for jobs past their end |
| A sale | lane A's shop page or PayPal's message → `recordSale` (A) → the next `runChecks` counts it |
| Drawing | `getBoard`, `getJobPage`, `getMyWork` (Start) |

## 5. Settings

`src/settings.ts` holds the starting numbers, exported as `settings`. They are starting values, not decisions: change them there, never copy a number into your own code.

| Name | Start value | Means |
|---|---|---|
| `currency` | USD | The money Dibs works in |
| `payBatchMinutes` | 60 | Wait between payouts on one job |
| `minPayoutCents` | 100 | Smallest payout worth sending |
| `feePercent` | 10 | Dibs's share of each payout, shown on the job card |
| `feeTakenFromPayouts` | 0 | 1 = really take the fee, 0 = only show it |
| `checkEveryMinutes` | 10 | How often a result's numbers are read again |
| `objectionWindowDays` | 3 | Time a poster has to object to an AI opinion |
| `maxJobDays` | 21 | Longest a job may run |
| `holdPromisedDays` | 3 | How long PayPal promises held money is there |
| `holdMaxDays` | 29 | How long a PayPal hold lasts |
| `cheatTests.repeatVisitor.countedClicksPerVisitor` | 1 | Clicks counted per visitor |
| `cheatTests.clickBurst.windowSeconds`, `.maxClicksInWindow` | 60, 30 | More clicks than this in one window is a burst |
| `cheatTests.viewJump.minViewsBeforeTesting`, `.maxGrowthBetweenReadings` | 200, 5 | Views growing more than 5 times between readings is a jump |
| `cheatTests.viewsWithoutLikes.minViewsBeforeTesting`, `.minLikesPer100Views` | 500, 0.5 | Fewer likes than this fails |
| `cheatTests.clicksAgainstViews.maxClicksPer100Views` | 50 | More real clicks than this for the views fails |

## 6. Names for keys and settings

Listed in `.env.example` with no values. Put real values in `.env.local`, which git ignores. Never print a value, and never paste one in chat.

| Name | Used by | For |
|---|---|---|
| `DATABASE_URL` | Start | Empty = embedded database on the laptop. Set = hosted Postgres. |
| `DIBS_DATA_DIR` | every lane | Folder for the embedded database. Each lane uses its own. |
| `DIBS_DIST_DIR` | every lane | Folder for Next.js build files. Each lane uses its own. |
| `DIBS_BASE_URL` | A, B, D | The site's own address, for tracked links and PayPal's return |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | A | PayPal test keys |
| `PAYPAL_API_BASE` | A | PayPal's test address |
| `PAYPAL_WEBHOOK_ID` | A | For PayPal telling our server about sales |
| `PAYPAL_TEST_BUYER_EMAIL` | A, D | The pretend buyer who approves the hold |
| `PAYPAL_TEST_WORKER_EMAIL`, `PAYPAL_TEST_WORKER2_EMAIL` | A, D | The pretend workers who get paid |
| `GOOGLE_AI_API_KEY` | B | AI that watches video |
| `YOUTUBE_API_KEY` | B | Reading view counts |
| `ANTHROPIC_API_KEY` | B | AI that writes and judges text |
| `TICK_SECRET` | B, D | Password the outside timer sends with each call |

## 7. Commands

| Command | Does |
|---|---|
| `npm run dev` | Runs the app (add `-- --port 3001` for your own port) |
| `npm run typecheck` | Checks the types of everything in `src/` and `scripts/` |
| `npm test` | Runs every `*.test.ts` under `src/` |
| `npm run lint` | Checks code style |
| `npm run build` | Builds the app for putting online |
| `npm run db:seed` | Empties the database and loads the sample data. Refuses on a hosted database unless `DIBS_ALLOW_SEED=1` is set for that one command. |
| `npm run db:titles` | Prints the jobs on the board with their money |
| `npm run db:migrate` | Creates or updates the tables (needed for a hosted database; the embedded one does it by itself) |
| `npm run db:generate` | After a change to `src/db/schema.ts`: writes the SQL for it into `drizzle/` (Start lane only) |
| `GET /api/health` | Says whether the running app can reach its database |

## 8. Working side by side in one folder

Four lanes share this folder with no separate copies, so:

1. **Use your own folders for the database and the build.** Before running anything, in your terminal:

   | Lane | PowerShell |
   |---|---|
   | A | `$env:DIBS_DATA_DIR=".data/lane-a"; $env:DIBS_DIST_DIR=".next-a"` then `npm run dev -- --port 3001` |
   | B | `$env:DIBS_DATA_DIR=".data/lane-b"; $env:DIBS_DIST_DIR=".next-b"` then `npm run dev -- --port 3002` |
   | C | `$env:DIBS_DATA_DIR=".data/lane-c"; $env:DIBS_DIST_DIR=".next-c"` then `npm run dev -- --port 3003` |
   | D | `$env:DIBS_DATA_DIR=".data/lane-d"; $env:DIBS_DIST_DIR=".next-d"` then `npm run dev -- --port 3004` |

   Then `npm run db:seed` once (with the app stopped) to fill your own database.
2. **One program per database folder.** The embedded database can be open in only one running program. While your `npm run dev` is running, `npm run db:seed` on the same folder is refused with a message saying so. Stop the app, seed, start it again.
3. **Tests never touch your database.** Each test file gets its own empty database in memory. Call `seed(db)` from `@/db/seed` in a test if you want the sample data.
4. **`npm run typecheck` checks every lane's files.** If it fails in a folder that is not yours, that lane is mid-change: look only at errors in your own folders.
5. **Adding a package changes shared files** (`package.json`, `package-lock.json`). Already installed for you: `zod`, `@google/genai`, `@anthropic-ai/sdk`, `pg`. If you need another: only one lane installs at a time (two installs at once can break the shared `node_modules` folder), so say so in the shared notes first, install, then note that it is done.
6. **Pages that read the database** must not be built ahead of time: put `export const dynamic = "force-dynamic";` in the page file, as `src/app/api/health/route.ts` does.
7. **Do not edit** `tsconfig.json`, `next.config.ts`, `src/contract/`, `src/db/` or this file. Ask the Start lane.

## 9. The sample data

`npm run db:seed` loads what the approved drawing shows. It is all pretend: emails end in `example.com`, and PayPal references start with `SAMPLE`, except the two printed on the drawing.

| Job (id) | Poster | Locked / paid / held | Results |
|---|---|---|---|
| Get our launch video 10,000 views (`job_kettle_views`) | Kettle & Clove | $50.00 / $12.40 / $37.60 | aarav.clips paid $12.40 (5 of 5 checks); meera.reels blocked (5,000 clicks counted as 1); kabir.cuts and isha.edits checking |
| Bring us paying customers (`job_loom_sales`) | Loom & Thread | $200.00 / $35.00 / $165.00 | dev.finds 4 sales, tara.styles 3 sales |
| Test levels 1 to 3 and record your screen (`job_tinycomet_test`) | Tiny Comet Games | $60.00 / $24.00 / $36.00 | zoya.plays paid $12.00 (4 of 5 rules); rohan.tests paid $12.00 |
| Play our game on stream for 30 minutes (`job_tinycomet_stream`) | Tiny Comet Games | $40.00 / $0.00 / $40.00 | zoya.plays has called dibs, nothing handed in |
| Find real bugs on our checkout page (`job_northside_bugs`) | Northside Bakes | $80.00 / $16.00 / $64.00 | ishaan.breaks paid $16.00 (2 of 3 bugs) |
| Translate our menu into Hindi (`job_kettle_translate`) | Kettle & Clove | $18.00 / $0.00 / $18.00 | none |

People ids: `per_kettle`, `per_loom`, `per_tinycomet`, `per_northside`, `per_aarav`, `per_meera`, `per_zoya`, `per_kabir`, `per_isha`, `per_dev`, `per_tara`, `per_rohan`, `per_ishaan`.

Where the sample differs from the drawing:

- The drawing's tabs say 42 jobs; the sample has the 6 jobs that are drawn, so the tabs show real counts (6).
- The drawing's "You've earned $48.20" has no person behind it. Use `getBoard("per_aarav")` to see $12.40.
- kabir.cuts, isha.edits, dev.finds, tara.styles, rohan.tests and ishaan.breaks are invented so each job's paid total has someone behind it.
- "9D left" and the other times are counted from the moment you seed. Seed again to reset them.
