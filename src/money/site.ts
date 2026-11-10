/**
 * The site's own address, with no slash at the end. PayPal sends people back
 * to it. DIBS_BASE_URL wins; otherwise it is read from the request (which is
 * right behind a tunnel or a host such as Vercel); otherwise the laptop's.
 */
export function siteBase(request?: Request): string {
  const fixed = process.env.DIBS_BASE_URL?.trim();
  if (fixed) return fixed.replace(/\/+$/, "");
  if (request) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (host) {
      const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
      const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || (local ? "http" : "https");
      return `${proto}://${host}`;
    }
    return new URL(request.url).origin;
  }
  // On Vercel the site is told its own address.
  const hosted = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (hosted) return `https://${hosted.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}
