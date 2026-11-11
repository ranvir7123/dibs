"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

interface Item {
  href: string;
  label: string;
  icon: IconName;
  /** Also on the bar at the bottom of a phone screen. */
  dock?: boolean;
  /** Which addresses light this item up. */
  on: (path: string) => boolean;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Work",
    items: [
      { href: "/", label: "Jobs", icon: "jobs", dock: true, on: (p) => p === "/" || p.startsWith("/jobs") },
      { href: "/work", label: "My work", icon: "list", dock: true, on: (p) => p.startsWith("/work") },
      { href: "/payouts", label: "Payouts", icon: "wallet", dock: true, on: (p) => p.startsWith("/payouts") },
    ],
  },
  {
    title: "Hire",
    items: [
      { href: "/post", label: "Post a job", icon: "plus", dock: true, on: (p) => p.startsWith("/post") },
      { href: "/people", label: "People", icon: "people", dock: true, on: (p) => p.startsWith("/people") },
      // Every money move on the jobs a business posted. On a phone it is reached from the People screen and from the round person button.
      { href: "/ledger", label: "Ledger", icon: "file", on: (p) => p.startsWith("/ledger") },
    ],
  },
  {
    title: "Account",
    items: [{ href: "/you", label: "Settings", icon: "gear", on: (p) => p.startsWith("/you") }],
  },
];

/**
 * The menu. On a big screen it is the list in the black side bar; on a phone
 * ("dock") it is the black bar along the bottom. `openJobs` is the real count
 * of jobs on the board, shown next to "Jobs"; null leaves it out.
 */
export function SideNav({ variant = "side", openJobs = null }: { variant?: "side" | "dock"; openJobs?: number | null }) {
  const path = usePathname();

  if (variant === "dock") {
    return (
      <nav className="dock" aria-label="Main">
        {GROUPS.flatMap((group) => group.items)
          .filter((item) => item.dock)
          .map((item) => {
            const on = item.on(path);
            return (
              <Link key={item.href} href={item.href} className={on ? "on" : undefined} aria-current={on && path === item.href ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
      </nav>
    );
  }

  return (
    <nav className="menu" aria-label="Main">
      {GROUPS.map((group) => (
        <Fragment key={group.title}>
          <h4>{group.title}</h4>
          {group.items.map((item) => {
            const on = item.on(path);
            return (
              <Link key={item.href} href={item.href} className={on ? "on" : undefined} aria-current={on && path === item.href ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
                {item.href === "/" && openJobs !== null && openJobs > 0 ? <em className="num">{openJobs} open</em> : null}
              </Link>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
