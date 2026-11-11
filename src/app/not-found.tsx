import type { Metadata } from "next";
import Link from "next/link";
import { Empty } from "@/ui/States";

export const metadata: Metadata = { title: "Page not found" };

// Shown for an address that is not part of Dibs at all, in the same look as the rest of the site.
export default function NotFound() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 16px" }}>
      <Link href="/" className="logo" aria-label="Dibs, the jobs board" style={{ display: "inline-block", marginBottom: 24 }}>
        Dibs
      </Link>
      <Empty
        icon="jobs"
        title="We could not find that page"
        action={
          <Link href="/" className="btn main-b">
            Back to the jobs
          </Link>
        }
      >
        The link may be old or mistyped.
      </Empty>
    </main>
  );
}
