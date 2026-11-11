import Link from "next/link";
import type { ReactNode } from "react";
import { getBoard } from "@/contract";
import { Avatar } from "@/ui/Avatar";
import { Icon } from "@/ui/Icon";
import { SideNav } from "@/ui/SideNav";
import { getViewer } from "@/ui/viewer";

/** How many jobs are on the board, for the menu. The menu still shows if this cannot be read. */
async function openJobCount(): Promise<number | null> {
  try {
    return (await getBoard()).categoryCounts.all;
  } catch {
    return null;
  }
}

// What every screen sits in: the black menu on the left, a bar along the top,
// then the page. On a phone the menu becomes a bar along the bottom.
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [viewer, openJobs] = await Promise.all([getViewer(), openJobCount()]);
  const meLabel = viewer ? `You are ${viewer.name}. Switch person` : "Choose who you are";
  const mePicture = viewer ? (
    <Avatar name={viewer.name} />
  ) : (
    <span className="avatar" aria-hidden="true">
      <Icon name="user" />
    </span>
  );

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <Link href="/" className="logo" aria-label="Dibs, the jobs board">
            Dibs
          </Link>
          <span className="tag">Test mode</span>
        </div>
        <SideNav openJobs={openJobs} />
        <Link href="/you" className="me" aria-label={meLabel}>
          {mePicture}
          <span>
            <b>{viewer ? viewer.name : "Who are you?"}</b>
            <small>{viewer ? "Switch person" : "Tap to choose"}</small>
          </span>
        </Link>
      </aside>

      <div className="main">
        <header className="top">
          <Link href="/" className="logo" aria-label="Dibs, the jobs board">
            Dibs
          </Link>
          <div className="status">
            <span className="badge">PayPal test mode</span>
            <small>No real money moves. Results are paid without anyone approving.</small>
          </div>
          <div className="top-right">
            {viewer ? (
              <div className="payto">
                <small>Paid out to</small>
                <b title={viewer.paypalEmail}>{viewer.paypalEmail}</b>
              </div>
            ) : (
              <Link href="/you" className="btn ghost">
                Say who you are
              </Link>
            )}
            <Link href="/post" className="btn main-b">
              Post a job
            </Link>
          </div>
          <Link href="/you" className="me-mini" aria-label={meLabel}>
            {mePicture}
          </Link>
        </header>
        <main className="content">{children}</main>
      </div>

      <SideNav variant="dock" />
    </div>
  );
}
