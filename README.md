# Dibs

**Post a result. Pay only when it is real.**

Dibs is a job board where a business posts a result it wants and locks the pay in PayPal. Anyone can take the job ("call dibs"). A checker built for that job measures what really happened, and PayPal pays exactly what was earned. Money that was not earned is let go and never leaves the business. Nobody presses "approve".

Built by Ranvir for the PayPal AI Hackathon, November 2026.

> ## PayPal test mode. No real money.
> Everything in this project runs against PayPal's test system (its "sandbox"). The buyers and workers are pretend accounts from PayPal's developer page. No real money moves anywhere. Do not point it at real PayPal keys.

**Try it:** https://dibs-eqcw.onrender.com (PayPal test mode)

## Sponsor tools used

| Tool | What it does in Dibs | Where in the code |
|---|---|---|
| **Render** | Runs everything: the always-on site, the Postgres database, a disk that keeps uploaded recordings, and a timer that runs the checks and payments once a minute | `render.yaml`, `scripts/tick-call.mjs`, `docs/GOING-ONLINE.md` |
| **AG Grid: AG Studio** | The Ledger page (`/ledger`): two charts, a table of every money move with PayPal's reference, and an "Ask a question" box | `src/ui/LedgerStudio.tsx`, `src/ui/LedgerAdapter.ts`, `src/app/(site)/ledger/`, `src/app/api/ledger/ask/` |

## Who uses it

| Person | Does | Sees |
|---|---|---|
| The poster (a shop, a game maker, anyone hiring) | Types the job in one sentence, reads the job card AI wrote, approves it on PayPal | Money locked, paid and still held; one card for each person's result |
| The worker (anyone) | Picks a job, calls dibs, does it, hands in a link or a file | What each result earned and why; money arriving in PayPal |
| The checker (the product itself) | Reads the result from its source, runs the cheat tests, works out the pay, pays | Shows its reasons on every result card |

Any kind of job can be posted. AI builds a checker for it out of these kinds of proof:

| Proof | Example | How strong |
|---|---|---|
| A public page Dibs can read | The view count on a video | Weak (views can be bought) |
| A link Dibs owns | Clicks from different real visitors | Medium |
| A file or recording, watched or read by AI | A screen recording of a game test | Medium |
| PayPal itself | A sale that carries the worker's code | Strong |

If nothing can be measured (a translation, say), the job card says so before any money is locked. AI then gives its opinion and the poster has 3 days to object.

## Run it on your laptop, from zero

You need [Node.js](https://nodejs.org) 24 or newer and [Git](https://git-scm.com). Nothing else to install: the database is built in. The commands are written for PowerShell on Windows.

1. Get the code and its packages:

```powershell
git clone https://github.com/ranvir7123/dibs.git
```

```powershell
cd dibs
```

```powershell
npm install
```

2. Make your own keys file. It is never uploaded to GitHub:

```powershell
Copy-Item .env.example .env.local
```

3. Load the sample jobs, so there is something to look at:

```powershell
npm run db:seed
```

4. Start it, then open http://localhost:3000

```powershell
npm run dev
```

That is enough to look around: the board, the job pages and the result cards work on the sample data with no keys at all.

5. To post a job, lock money and get paid, stop the app (Ctrl+C), fill in `.env.local`, and start it again:

| Name in `.env.local` | Where it comes from | Needed for |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [PayPal's developer page](https://developer.paypal.com/dashboard/applications/sandbox), "Apps & Credentials", in Sandbox mode | Locking, taking, paying, letting go |
| `PAYPAL_TEST_BUYER_EMAIL`, `PAYPAL_TEST_WORKER_EMAIL`, `PAYPAL_TEST_WORKER2_EMAIL` | The same page, "Sandbox accounts": one pretend buyer and two pretend people to be paid | Approving a hold and receiving payouts |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Claude: writing the job card, looking at recordings, photos and files |
| `GOOGLE_AI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) | Gemini: watching public videos, the Ledger's ask box, backup for job cards |
| `YOUTUBE_API_KEY` | [Google Cloud console](https://console.cloud.google.com/apis/library/youtube.googleapis.com) | Reading view counts the official way |
| `DIBS_BASE_URL` | `http://localhost:3000` on a laptop | Tracked links, and PayPal sending people back |
| `TICK_SECRET` | Make up a long password | Protecting the "run the checks" address |

6. Checks and payouts run when something calls the "run the checks" address. Online, a timer does it every minute. On a laptop, call it yourself (this reads your password from `.env.local` without showing it):

```powershell
$s = (Select-String -Path .env.local -Pattern '^TICK_SECRET=(.*)$').Matches[0].Groups[1].Value; Invoke-RestMethod -Headers @{ Authorization = "Bearer $s" } http://localhost:3000/api/tick
```

To put it online, see [docs/GOING-ONLINE.md](docs/GOING-ONLINE.md).

### Other commands

| Command | Does |
|---|---|
| `npm test` | Runs the tests for the app |
| `npx vitest run --config scripts/vitest.config.mts` | Runs the tests for the scripts in `scripts/` |
| `npm run typecheck` | Checks the types of every file |
| `npm run db:titles` | Prints the jobs on the board with their money |
| `npx tsx scripts/demo-reset.ts --practice` | Wipes the database and loads the sample board plus the people in the demo video |
| `npx tsx scripts/join-hold.ts <job id>` | For practice runs with nobody to sign in to PayPal: locks a draft job's money with PayPal's published test card (a real test-mode hold), then opens the job. Run it with the app stopped |
| `npx tsx scripts/join-look.ts <job id>` | Prints what the database holds for a job: money moves with PayPal's references, results, checks, readings, clicks. Changes nothing. Run it with the app stopped |
| `npx tsx scripts/attack.ts --stand-in` | Fires 5,000 clicks at one tracked link from your machine and prints how many Dibs counted. Run it with the app stopped; it uses a small stand-in link server and the laptop's own database |

## How PayPal is used, and where in the code

PayPal is not only the pay button here. It holds the budget, pays in exact parts, and for sales jobs it is the checker itself.

| What Dibs does | PayPal feature | PayPal address called | Where in the code |
|---|---|---|---|
| Lock the poster's whole budget when they approve the job | Orders, with intent "authorize" (a hold) | `POST /v2/checkout/orders`, then `POST /v2/checkout/orders/{id}/authorize` | `startHold` and `confirmHold` in `src/money/index.ts` |
| Take only the part a result earned, again and again from the same hold | Capture part of an authorization | `POST /v2/payments/authorizations/{id}/capture` | `payWorker` in `src/money/index.ts` |
| Pay the worker by email, with a note saying what it was for | Payouts | `POST /v1/payments/payouts` | `payWorker` in `src/money/index.ts` |
| Give back what was not earned when the job ends | Void an authorization | `POST /v2/payments/authorizations/{id}/void` | `letGo` in `src/money/index.ts` |
| Prove a sale happened, and whose it was | An order that carries the worker's code in its `custom_id` | `POST /v2/checkout/orders`, then `.../capture` | `startShopOrder` and `finishShopOrder` in `src/money/shop.ts` (the sale is then stored by `recordSale` in `src/money/index.ts`); the shop page is in `src/app/shop/` |
| Hear about sales and refunds from PayPal directly | Webhooks (PayPal calling our server), with PayPal's signature checked | `POST /v1/notifications/verify-webhook-signature` | `src/app/api/paypal/` |
| Approve the hold, or pay the shop, without leaving the page | PayPal JavaScript SDK v6 (PayPal's button and window) | `https://www.sandbox.paypal.com/web-sdk/v6/core` | `src/ui/PayPalButton.tsx`, `src/app/api/paypal/hold/`, `src/app/api/paypal/shop/` |
| Show the date the hold ends on every job | Show authorization details | `GET /v2/payments/authorizations/{id}` | `confirmHold` in `src/money/index.ts` |
| Refund a shop sale, all or part. A refunded sale earns no commission | Refund a captured payment | `POST /v2/payments/captures/{id}/refund` | `refundSale` and `refreshSale` in `src/money/sales.ts`; the orders page is `src/app/shop/orders/` |
| Show a job's money from start to end, with PayPal's reference on each line | (built from the rows above) | none | `getMoneyTrail` in `src/money/trail.ts`, `src/ui/MoneyTrail.tsx` |
| Confirm a person's PayPal account. Built, switched off on the live site | Log in with PayPal | PayPal's sign-in page, then `GET /v1/identity/openidconnect/userinfo` | `src/money/login.ts`, `src/app/api/paypal/login/` |

Every call to PayPal is in `src/money/paypal.ts`. Every money movement is stored as a row with PayPal's own reference number, and "paid" and "held" on screen are added up from those rows, never stored as a running total.

AI never calls PayPal. Only `src/money/` does.

## How AI is used

| Job | Done by | Where in the code |
|---|---|---|
| Turn one sentence into a job card with its own checker | Claude (`claude-opus-5-5`, Anthropic API). Gemini is the backup | `src/checkers/job-card.ts`, `src/ai/claude.ts` |
| Look at an uploaded recording: it is cut into one picture per second, with no sound | Claude | `src/ai/frames.ts`, `src/checkers/watch.ts` |
| Look at a handed-in photo or PDF, read a text file, read a web page Dibs opened itself, or give an opinion when nothing can be measured | Claude | `src/checkers/watch.ts`, `src/checkers/pages.ts` |
| Watch a public promo video: does it name the brand, show the link, say it is paid? | Gemini (`gemini-3.8-flash`, Google AI API) | `src/checkers/watch.ts`, `src/ai/gemini.ts` |
| Answer a question in the Ledger | Gemini | `src/app/api/ledger/ask/` |
| Read view counts, count clicks, spot repeats and bursts, work out pay | Plain code, no AI | `src/checkers/video-site.ts`, `clicks.ts`, `cheat-tests.ts`, `pay.ts` |
| Move money | PayPal, called by plain code | `src/money/` |

Numbers are never an AI's opinion: they are read by ordinary code so they are exact and repeatable. AI does the parts that need understanding or watching. The models are named in one file, `src/ai/models.ts`, so they can be swapped.

## What is tested, and what is not

Run by us against PayPal test mode, with the output kept:

| Tested | Result | Date |
|---|---|---|
| Hold $50, take $4.00, take $8.40 from the same hold, let the rest go | Each take completed; the hold showed "partially captured" after each; the rest was voided | 10 Nov 2026 |
| Pay a person by email with a note | Arrived in about 17 seconds; the note came back exactly as sent | 9 Nov 2026 |
| Our own label on an order | It came back on the order | 10 Nov 2026 |
| 5,000 clicks from one machine at one tracked link, fired at the real link code and at the stand-in link server in `scripts/` (both on a laptop, not yet at the online site) | 5,000 sent, all 5,000 answered and stored, 1 counted | 10 Nov 2026 |

Automatic tests: `npm test` covers the database reads and writes, the money rules, the checkers and the screen helpers. `npx vitest run --config scripts/vitest.config.mts` covers the attack and the demo reset.

Not tested, or not built. Please read these before trusting it:

- **Test mode only.** Never run with real PayPal keys.
- **No passwords.** People pick a name and give the email their PayPal uses. Anyone who knows a person's id could act as them. Fine for a demo, not for real use.
- **The sale path is proven.** A pretend buyer paid the shop $32.00 through PayPal's button on the live site on 12 Nov 2026. Refunds, the hold's end date and the money trail passed 14 of 14 checks against PayPal test mode (`src/money/proof/additions-results.txt`). A real message from PayPal arriving at our server (a webhook) has not been seen.
- **Views can be bought.** Dibs flags patterns (sudden jumps, views with no likes) but cannot be certain. That is why view jobs are marked "weak proof" on the card.
- **AI can miss a moment** in a recording. Recording jobs are marked "medium proof".
- **One visitor is one address plus one browser.** Two people on the same Wi-Fi with the same browser can look like one visitor.
- **A PayPal hold lasts 29 days at most**, and PayPal only promises the money for the first 3 days. So a job runs 3 weeks at most.
- **How many times one hold can be taken from** is untested beyond two. Pay is sent in batches, at most once an hour per job.
- **Recordings are saved on the server's own disk.** Online, that is a Render disk that is kept across new versions. A recording being read on the live site has not been run from start to finish.
- **The 10% fee** is shown on the job card but not taken.
- **Not built:** AI visiting a live website to repeat a bug (bug jobs are checked from the worker's recording), streamer jobs, real stores connecting their own PayPal (the sale demo uses a small shop page Dibs hosts).
- **A hosted database and the online site** were set up last. See `docs/GOING-ONLINE.md` for what was and was not checked there.

## Where things are

| Folder | Holds |
|---|---|
| `src/contract/`, `docs/CONTRACT.md` | The shapes and function names every part agrees on |
| `src/db/` | The database tables, reads, writes and sample data |
| `src/money/`, `src/app/api/paypal/`, `src/app/shop/` | Everything that touches PayPal |
| `src/checkers/`, `src/ai/`, `src/app/r/`, `src/app/api/tick/` | Checkers, AI, tracked links, the "run the checks" address |
| `src/app/(site)/`, `src/ui/` | The screens |
| `scripts/` | The click attack, the demo reset, and their tests |
| `docs/` | The shared contract and how to put it online |

## Licence

MIT. See [LICENSE](LICENSE).
