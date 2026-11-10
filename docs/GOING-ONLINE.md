# Dibs: putting it online

Three free services: **Vercel** runs the site, **Neon** is the database (a hosted Postgres), and **cron-job.org** is the timer that calls "run the checks" every minute. Vercel's own free timer cannot do that: it runs once a day.

You do every step yourself. Nothing here has been done for you, and no account has been made.

Where a button name is in "quotes", it is the name on the maker's own help page on 10 Nov 2026. Where a step says *(name may differ)*, the help page did not show the screen, so look for the closest match.

Run every command in PowerShell, inside `C:\dev\paypal\dibs`.

## Before you start

- The code must be in a GitHub project in your name. A `git push` must have worked.
- `.env.local` on your laptop must already have your PayPal test keys, AI keys and the three pretend PayPal emails.
- Never paste a key or password into a chat. Type or paste them only into Vercel, cron-job.org, or `.env.local`.

## Part 1. Put the site on Vercel

https://vercel.com/new

1. Log in to Vercel with your GitHub account.
2. Under "Import Git Repository", find `dibs` and click "Import".
3. If `dibs` is not in the list, click "Adjust GitHub App Permissions", tick the `dibs` project, click "Save", and go back to https://vercel.com/new
4. Leave every setting as Vercel filled it in (it sees that this is a Next.js project).
5. Click "Deploy".
6. Wait for it to finish. The first build may fail or the site may show an error, because the database and keys are not there yet. That is expected. Carry on.
7. Copy the site's address from the top of the project page. It looks like `https://dibs-something.vercel.app`. Write it down: this is **your site address**.

## Part 2. Make the database

https://vercel.com/marketplace/neon

8. Click "Install".
9. Choose "Create New Neon Account" and click "Continue".
10. Pick the region closest to you.
11. Leave "Auth" and "Realtime" switched off.
12. Pick the free plan, accept the terms, and name the database `dibs`.
13. Finish creating it *(name may differ: "Create" or "Continue")*. You land on the "Storage" tab.
14. Click your new database, then click "Connect Project".
15. Choose the `dibs` project, leave all environments ticked, and click "Connect".

Vercel has now added two addresses to the project by itself: `DATABASE_URL` (the one the site uses) and `DATABASE_URL_UNPOOLED` (the direct one, used for creating tables).

## Part 3. Give the site its keys

https://vercel.com/dashboard

16. Click the `dibs` project.
17. Click "Environment Variables" in the sidebar *(it may be under "Settings")*.
18. Add each name below, one at a time: type the "Name", paste the "Value", click "Save".
19. `DIBS_BASE_URL` = your site address from step 7, with no slash at the end.
20. `TICK_SECRET` = a long password you make up now (30 letters and numbers, no spaces). Write it down somewhere safe: you need it again in Part 6.
21. `PAYPAL_CLIENT_ID` = the same value as in your `.env.local`.
22. `PAYPAL_CLIENT_SECRET` = the same value as in your `.env.local`.
23. `PAYPAL_TEST_BUYER_EMAIL` = the same value as in your `.env.local`.
24. `PAYPAL_TEST_WORKER_EMAIL` = the same value as in your `.env.local`.
25. `PAYPAL_TEST_WORKER2_EMAIL` = the same value as in your `.env.local`.
26. `GOOGLE_AI_API_KEY` = the same value as in your `.env.local`.
27. `YOUTUBE_API_KEY` = the same value as in your `.env.local`.
28. `ANTHROPIC_API_KEY` = the same value as in your `.env.local`.
29. Do not add `DATABASE_URL`: Part 2 already did. Do not add `DIBS_DATA_DIR` or `DIBS_DIST_DIR`: they are for laptops only.

## Part 4. Create the tables and load the sample jobs, from your laptop

https://vercel.com/dashboard

30. Click the `dibs` project, then "Environment Variables".
31. Find `DATABASE_URL_UNPOOLED`, click the three dots beside it, and reveal and copy its value *(name may differ)*.
32. Open `.env.local` on your laptop in Notepad.
33. On the `DATABASE_URL=` line, paste the value after the `=`.
34. On the `DIBS_BASE_URL=` line, put your site address from step 7.
35. On the `TICK_SECRET=` line, put the password from step 20.
36. Save and close the file.
37. Create the tables:

```powershell
npm run db:migrate
```

38. Load the sample jobs and the people in the video (this wipes the online database, so it asks you to mean it):

```powershell
$env:DIBS_ALLOW_SEED="1"; npx tsx scripts/demo-reset.ts; Remove-Item Env:DIBS_ALLOW_SEED
```

39. Check it printed "hosted Postgres" and 6 open jobs.

From now on, commands on your laptop talk to the online database. To go back to the laptop's own database, empty the `DATABASE_URL=` line again. (`npx tsx scripts/attack.ts --stand-in` refuses to run while that line is filled, so it cannot put pretend clicks online.)

## Part 5. Build the site again with its keys

https://vercel.com/dashboard

40. Click the `dibs` project, then "Deployments".
41. Click the three dots beside the newest one and click "Redeploy". Confirm.
42. Wait for it to finish.
43. Open your site address followed by `/api/health`. It must say the database can be reached.
44. Open your site address. The board must show 6 jobs.

Keys only take effect on a new build. Any time you change a key in Vercel, do steps 40 to 42 again.

## Part 6. Start the timer

https://console.cron-job.org/signup

45. Make a free account and confirm your email.
46. Click "Create cronjob".
47. "Title": `Dibs tick`.
48. "URL": your site address followed by `/api/tick`.
49. Under the schedule, choose every 1 minute *(name may differ: "Every 1 minute(s)")*.
50. Open the "Advanced" tab.
51. Under "Headers", add one: key `Authorization`, value `Bearer ` followed by your password from step 20 (the word Bearer, one space, then the password).
52. Leave the request method as GET.
53. Go back to the first tab and switch on the option to email you when the job fails *(name may differ)*.
54. Click "Create".
55. Wait two minutes, click the job, and open its history. The newest runs must say 200.

What the answers mean: **200** = it worked. **401** = the password in step 51 does not match `TICK_SECRET` in Vercel. **503** = `TICK_SECRET` is missing in Vercel, or the site was not rebuilt after adding it (do steps 40 to 42).

## Part 7. Tell PayPal where the site is

PayPal can call the site when a sale happens (this is called a "webhook"). It needs the site's address once.

56. Run this, with your site address in place of the capitals:

```powershell
npx tsx src/money/proof/webhook.ts add https://YOUR-SITE-ADDRESS/api/paypal/webhook
```

57. It prints a number. In Vercel, add it as `PAYPAL_WEBHOOK_ID` (steps 16 to 18).
58. Put the same number on the `PAYPAL_WEBHOOK_ID=` line in `.env.local`.
59. Build the site again (steps 40 to 42).

## Part 8. Check it as a stranger would

60. Open your site address in a private browser window.
61. Check the board loads and a job page opens.
62. Fire the click attack at the sample link that has no clicks yet:

```powershell
npx tsx scripts/attack.ts --code kabirn2w
```

63. It must print "Clicks sent: 5,000", "Dibs stored: 5,000 of them" and "Dibs counted: 1 real click".
64. Run the reset again (step 38) so those clicks are gone before filming. Do the same before any second try of step 62.

## Limits you will hit (read once)

| Limit | What it means for you |
|---|---|
| The timer waits 30 seconds for an answer, and switches a job off after more than 25 failed runs. | A check that watches a long recording can take longer than 30 seconds. The check still finishes on Vercel, but the timer marks that run as failed. Look at the timer's page each morning; if the job is switched off, switch it back on. |
| Vercel refuses any upload over 4.5 MB, and does not keep files saved to its disk. | A tester's recording cannot be uploaded to the online site as built on 10 Nov. Film the game test on the laptop copy (`FILMING-CHECKLIST.md`, steps L1 to L5) unless the checkers session says this has been solved. |
| A Vercel request may run 300 seconds at most on the free plan. | The "run the checks" address is already set to that. |
| Neon's free database goes to sleep after 5 minutes with nothing happening. | The timer calls every minute, so it stays awake. The first page after a long quiet spell may be slow. |
| Neon's free plan gives each database a monthly allowance of computing (100 "CU-hours"). | The timer keeps the database awake all day, which uses the allowance all day. How fast depends on the size Neon runs it at, which was not confirmed. Look at Neon's usage page on Wednesday night. If more than a third is gone, switch the timer off on cron-job.org whenever you are not filming or testing, and on again when needed. |
| Vercel may slow or block a flood of requests from one address. | The click attack is such a flood. If step 62 prints answers other than 307 (for example 403 or 429), run it gentler by adding `--at-once 10` to the command. Not tried yet. |

## Not checked by anyone yet

- No step in this file has been carried out. The steps come from the makers' help pages (listed below) and from reading the code.
- `npm run db:migrate` and the reset against a hosted database: the code is there, but it has only ever run against the built-in database.
- The exact names of buttons marked *(name may differ)*, and every screen on cron-job.org (its help pages do not show them).
- Whether the direct address from step 31 needs anything added to work from a laptop. If step 37 fails with a message about SSL, add `?sslmode=require` to the end of the address in `.env.local` (if it already ends in `?something`, add `&sslmode=require` instead).
- Whether the site's own address is open to everyone by default. Vercel's help page says its protection covers preview links, not the main address, but does not state the default in one line. Step 60 is the test.

## Help pages these steps come from (read 10 Nov 2026)

- Importing from GitHub: https://vercel.com/docs/git/vercel-for-github
- Keys on Vercel, and rebuilding after a change: https://vercel.com/docs/environment-variables/managing-environment-variables
- Limits (4.5 MB, 300 seconds): https://vercel.com/docs/functions/limitations
- Vercel's own timer on the free plan: https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing
- Neon from inside Vercel, and the names it adds: https://neon.com/docs/guides/vercel-managed-integration
- Neon's free plan: https://neon.com/docs/introduction/plans
- Direct and pooled addresses: https://neon.com/docs/connect/connection-pooling
- cron-job.org limits (1 minute, 30 seconds, headers, 25 failures): https://cron-job.org/en/faq/
- Who can open the site: https://vercel.com/docs/deployment-protection
