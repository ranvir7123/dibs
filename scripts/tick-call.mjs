// The Render timer runs this once a minute. It asks the site, over Render's
// own inside network, to run the due checks and payments (/api/tick), and
// prints the site's answer. It holds no keys of its own: only the timer
// password, which Render copies from the site.
//
// Needs: DIBS_WEB_HOSTPORT (the site's inside address, host:port) and TICK_SECRET.
const hostport = process.env.DIBS_WEB_HOSTPORT?.trim();
const secret = process.env.TICK_SECRET?.trim();

if (!hostport || !secret) {
  console.error("The tick could not run: DIBS_WEB_HOSTPORT or TICK_SECRET is missing on the timer.");
  process.exit(1);
}

const started = Date.now();
try {
  // A check where AI watches a video can take minutes, so wait up to ten.
  const response = await fetch(`http://${hostport}/api/tick`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const text = await response.text();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Tick at ${new Date().toISOString()}: the site answered ${response.status} after ${seconds} s: ${text.slice(0, 2000)}`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(`The tick could not run: the site did not answer (${error instanceof Error ? error.message : String(error)}).`);
  process.exit(1);
}
