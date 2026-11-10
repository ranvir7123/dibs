import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/ui/Avatar";
import { Icon } from "@/ui/Icon";
import { SideNav } from "@/ui/SideNav";
import { getViewer } from "@/ui/viewer";

// The window every screen sits in: the side bar from the drawing, then the page.
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  return (
    <div className="wrap">
      <div className="win">
        <aside className="side">
          <Link href="/" className="logo keep" aria-label="Dibs, the jobs board">
            Dibs
          </Link>
          <SideNav />
          <div className="side-foot">
            <Link href="/you" className="me keep" aria-label={viewer ? `You are ${viewer.name}. Switch person` : "Choose who you are"}>
              {viewer ? (
                <Avatar name={viewer.name} />
              ) : (
                <span className="avatar" style={{ background: "var(--inset)", color: "var(--mute)" }} aria-hidden="true">
                  <Icon name="user" />
                </span>
              )}
              <span>
                <b>{viewer ? viewer.name : "Who are you?"}</b>
                <small>{viewer ? "Switch person" : "Tap to choose"}</small>
              </span>
            </Link>
            <p className="testmode">PayPal test mode. No real money moves.</p>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
