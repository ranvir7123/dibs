# Dibs: putting it online on Render

Render makes four things from the file `render.yaml`: the site (always on), its database, a timer that runs the checks every minute, and a service for background tasks (used only if you do Part 8). You can do every part below on a phone.

Nobody has done these steps yet. What is still unchecked is listed at the end.

Never paste a key or password into a chat. Paste them only into Render's and PayPal's own pages.

## Before you start

- The code, with `render.yaml` in it, must be on GitHub in your `dibs` project. Ask the main session to say "pushed" before you begin.
- Render will ask for a payment card, because the always-on site, the database and the timer are paid sizes. Render shows the price before you confirm.

## Part 1. Make a Render account

https://dashboard.render.com/register

1. Tap "GitHub".
2. Sign in to GitHub and allow Render.
3. When Render asks which projects it may see, pick "Only select repositories", choose `dibs`, and confirm.

## Part 2. Collect four values (keep each tab open)

https://developer.paypal.com/dashboard/applications/sandbox

4. Tap your app (the one whose keys Dibs already uses on the laptop).
5. Leave this tab open: it shows "Client ID" and, after tapping "Show", "Secret key 1".

https://developer.paypal.com/dashboard/accounts

6. Leave this tab open: it lists your pretend PayPal accounts and their emails.

https://aistudio.google.com/apikey

7. Leave this tab open: it shows your Google AI key (tap the copy button beside it when needed).

## Part 3. Make the site, the database and the timer

https://dashboard.render.com/blueprint/new

8. Tap "Connect" beside `dibs`.
9. In "Blueprint Name" type `dibs`.
10. Leave the branch as `main`.
11. Render now lists boxes to fill in. Fill them exactly as in steps 12 to 24.
12. `DIBS_BASE_URL`: leave empty.
13. `PAYPAL_CLIENT_ID`: paste "Client ID" from the PayPal tab of step 5.
14. `PAYPAL_CLIENT_SECRET`: paste "Secret key 1" from the same tab.
15. `PAYPAL_WEBHOOK_ID`: leave empty.
16. `PAYPAL_LOGIN_ON`: leave empty.
17. `PAYPAL_TEST_BUYER_EMAIL`: paste the email of your pretend buyer (the "Personal" account you approve holds with) from the tab of step 6.
18. `PAYPAL_TEST_WORKER_EMAIL`: paste the email of your first pretend worker from the same tab.
19. `PAYPAL_TEST_WORKER2_EMAIL`: paste the email of your second pretend worker from the same tab.
20. `GOOGLE_AI_API_KEY`: paste the key from the Google tab of step 7.
21. `YOUTUBE_API_KEY`: leave empty.
22. `ANTHROPIC_API_KEY`: leave empty.
23. `DIBS_CHECKS_ON_RENDER`: leave empty.
24. `RENDER_API_KEY`: leave empty.
25. Tap "Deploy Blueprint".
26. Add your payment card if Render asks.
27. Wait until `dibs-db`, `dibs`, `dibs-tick` and `dibs-checks` all show a green tick. The first build takes several minutes.

The tables are created and the six sample jobs are loaded by themselves during this first build. You run no command.

## Part 4. Tell the site its own address

https://dashboard.render.com

28. Tap the service named `dibs`.
29. Copy the address under its name at the top. It starts with `https://dibs` and ends with `.onrender.com`. This is your site address.
30. Tap "Environment" in the menu.
31. Tap "Edit".
32. In the box beside `DIBS_BASE_URL`, paste your site address. Remove any `/` at the very end.
33. Tap "Save, rebuild, and deploy".
34. Wait for the green tick.

## Part 5. Tell PayPal where to send its messages

https://developer.paypal.com/dashboard/applications/sandbox

35. Tap your app.
36. Scroll to "Sandbox Webhooks" and tap "Add Webhook".
37. In "Webhook URL", paste your site address and type `/api/paypal/webhook` straight after it.
38. Tick these nine boxes: "Checkout order approved", "Payment capture completed", "Payment capture refunded", "Payment capture reversed", "Payment payouts-item succeeded", "Payment payouts-item failed", "Payment payouts-item returned", "Payment payouts-item blocked", "Payment payouts-item unclaimed".
39. Tap "Save".
40. Copy the "Webhook ID" shown beside the new line.

https://dashboard.render.com

41. Tap `dibs`, then "Environment", then "Edit".
42. In the box beside `PAYPAL_WEBHOOK_ID`, paste the Webhook ID from step 40.
43. Tap "Save, rebuild, and deploy".

## Part 6. Switch on "Log in with PayPal"

Do this part only after the money session says the login is ready.

https://developer.paypal.com/dashboard/applications/sandbox

44. Tap your app.
45. Tick "Log in with PayPal" and tap "Advanced Settings" beside it.
46. In "Return URL", paste your site address and type `/api/paypal/login/return` straight after it.
47. Tap "Save".

https://dashboard.render.com

48. Tap `dibs`, then "Environment", then "Edit".
49. In the box beside `PAYPAL_LOGIN_ON`, type `1`.
50. Tap "Save, rebuild, and deploy".

## Part 7. Check it as a stranger

51. Open a private browser tab.
52. Open your site address with `/api/health` typed straight after it. It must say `"ok":true` and `hosted Postgres`.
53. Open your site address. The board must show 6 jobs.
54. Tap any job. Its page must open.

https://dashboard.render.com

55. Tap `dibs-tick`, then "Logs".
56. Within two minutes a new line must appear that starts with `Tick at` and ends with `0 problems`.

## Part 8. Hand the slow checks to Render's background tasks

This part is extra. The site works without it: the timer then does every check itself. With it, each check where AI watches a video runs as its own background task (Render calls these "Workflows"), so one long video never holds up the rest. `render.yaml` already made the task service, named `dibs-checks`.

https://dashboard.render.com/u/settings#api-keys

57. Tap "Create API Key".
58. In "Name" type `dibs-checks`.
59. Tap "Create API Key" and copy the key it shows. It is shown once only.

https://dashboard.render.com

60. Tap `dibs`, then "Environment", then "Edit".
61. In the box beside `RENDER_API_KEY`, paste the key from step 59.
62. In the box beside `DIBS_CHECKS_ON_RENDER`, type `1`.
63. Tap "Save, rebuild, and deploy".
64. Tap `dibs-tick`, then "Manual Deploy", then "Deploy latest commit", so the timer reads the two new values.
65. On the site, hand in a public video on a job that says "AI watches your video".
66. Tap `dibs-tick`, then "Logs". Within two minutes a line must appear that starts `Handed the slow check for result`.
67. Tap `dibs-checks`, then "Runs" (the list of task runs). A run of `runCheck` must appear and end as "Completed".
68. Open the job's page on the site. The result card must show the checks AI made.

What you see if it does not work:

| You see in the `dibs-tick` log | It means | Do this |
|---|---|---|
| No `Handed the slow check` line, and the check appears on the site anyway | The switch is off or a value is missing, so the timer did the check itself. | Check steps 61 to 64. |
| `Could not hand the check ... (Render refused the key in RENDER_API_KEY), so it was done here instead.` | The key is wrong. The check was still done. | Do steps 57 to 64 again. |
| `Could not hand the check ... (Render has no task called ...), so it was done here instead.` | The task service is not running, or its name did not reach the timer. The check was still done. | Tap `dibs-checks` and see whether its last build failed. Send its last 20 log lines to the main session. |
| `Handed the slow check` appears, but the run on `dibs-checks` ends as "Failed" | The task could not do the check. It is tried once more by itself, and the timer tries again 10 minutes later. | Tap the failed run, copy the error line, send it to the main session. |

To switch this part off again: empty the box beside `DIBS_CHECKS_ON_RENDER`, save, and do step 64.

## If something goes wrong

| You see | It means | Do this |
|---|---|---|
| `dibs` shows "Deploy failed" and its log says `Setting up the online database failed` | The site could not reach the database, or could not create the tables. | Tap `dibs`, "Manual Deploy", "Deploy latest commit". If it fails again, send the last 20 log lines (they hold no keys) to the main session. |
| The board is empty | The sample jobs were not loaded. | Tap `dibs`, then "Logs", and look for the line starting `The database was empty`. If it is missing, tell the main session. |
| A `Tick at` line ends with `1 problems` or more | A check or a payment failed; the lines under it say which, in plain words. | Nothing at once: it is tried again by itself. If the same line repeats for an hour, send it to the main session. |
| No `Tick at` line, and `The tick could not run:` instead | The timer cannot reach the database or is missing a key. | Send that one line to the main session. |
| PayPal's page shows an error after "Lock the money" | `DIBS_BASE_URL` is wrong. | Do steps 28 to 34 again and check the address has no `/` at the end. |

## Only for filming, from the laptop

The filming reset and the 5,000-click attack read the database from the laptop, so the laptop needs the database's outside address.

https://dashboard.render.com

69. Tap `dibs-db`.
70. Under "Connections", copy "External Database URL".
71. On the laptop, open `C:\dev\paypal\dibs\.env.local` in Notepad.
72. On the line that starts `DATABASE_URL=`, paste the address after the `=`, then type `?sslmode=require` straight after it.
73. On the line that starts `DIBS_BASE_URL=`, replace what is after the `=` with your site address.
74. Save and close the file.
75. In PowerShell, inside `C:\dev\paypal\dibs`, reset for filming (this wipes the online database, so it asks you to mean it):

```powershell
$env:DIBS_ALLOW_SEED="1"; npx tsx scripts/demo-reset.ts; Remove-Item Env:DIBS_ALLOW_SEED
```

76. When filming is over, empty the `DATABASE_URL=` line again, so the laptop goes back to its own database.

## What changed from the Vercel plan

- No Vercel, Neon or cron-job.org account is needed. The project never had a Vercel settings file, so nothing was removed.
- A recording of any size can be uploaded: the site keeps uploads on its own disk (1 GB), and they survive a new build.
- A slow check (AI watching a long video) is no longer cut off: the timer's run may last hours, where a web call was cut at 300 seconds.
- The site's `/api/tick` address still works, with the password Render made up (`TICK_SECRET`, on the `dibs` service's "Environment" page). Nothing needs to call it.

## Not checked by anyone yet

- No step in this file has been carried out. Button names come from Render's and PayPal's help pages; a name on your screen may differ slightly.
- Whether Render lets you leave a box empty in step 11, and whether it asks for all thirteen boxes on one screen.
- The first build on Render: installing, building, creating the tables and loading the sample jobs on a hosted database. Each piece ran on the laptop's built-in database only.
- Two ticks at the same moment on the hosted database. The lock that stops them was tested on the laptop's built-in database, and the "someone else has it" answer only with a stand-in.
- Whether the timer picks up a key by itself after you change it on `dibs` (steps 33 and 43). If the timer's log complains about a missing key afterwards, tap `dibs-tick`, "Manual Deploy", "Deploy latest commit".
- The timer fetching an uploaded recording from the site over Render's own network.
- The laptop reaching the online database with `?sslmode=require` (step 72).
- All of Part 8. Starting a background task on Render has never worked from here, because no Render account exists yet. What was tried: Render's real service refused a made-up key, and the timer then did the check itself and said so. Whether the task service builds and starts, whether its name reaches the timer, whether a task run can reach the database and fetch an uploaded recording, and the names of the buttons in steps 57 to 59 and 67 are all unchecked.
- The exact size of Render's bill. The site is $7 a month and the timer at least $1; the database price is shown by Render before you confirm.
- The nine PayPal box names in step 38 are PayPal's event names put into words; the list on PayPal's page uses the same words in a slightly different order.

## Help pages these steps come from (read 12 Nov 2026)

- Making services from `render.yaml`: https://render.com/docs/infrastructure-as-code
- What `render.yaml` may contain: https://render.com/docs/blueprint-spec
- The timer: https://render.com/docs/cronjobs
- Background tasks (Workflows): https://render.com/docs/workflows and https://render.com/docs/workflows-running
- Disks: https://render.com/docs/disks
- The database and its addresses: https://render.com/docs/postgresql-creating-connecting
- What runs before a new version starts: https://render.com/docs/deploys
