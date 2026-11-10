"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

interface Item {
  href: string;
  label: string;
  icon: IconName;
  /** Stays on the top bar on a phone, as in the drawing. */
  keep?: boolean;
  /** Which addresses light this item up. */
  on: (path: string) => boolean;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Work",
    items: [
      { href: "/", label: "Jobs", icon: "jobs", keep: true, on: (p) => p === "/" },
      { href: "/work", label: "My work", icon: "list", on: (p) => p.startsWith("/work") },
      { href: "/payouts", label: "Payouts", icon: "wallet", on: (p) => p.startsWith("/payouts") },
    ],
  },
  {
    title: "Hire",
    items: [
      { href: "/post", label: "Post a job", icon: "plus", keep: true, on: (p) => p.startsWith("/post") },
      // As in the drawing: "People" is lit while a poster looks at a job's results.
      { href: "/people", label: "People", icon: "people", on: (p) => p.startsWith("/people") || p.startsWith("/jobs") },
    ],
  },
  {
    title: "Account",
    items: [{ href: "/you", label: "Settings", icon: "gear", on: (p) => p.startsWith("/you") }],
  },
];

export function SideNav() {
  const path = usePathname();
  return (
    <>
      {GROUPS.map((group) => (
        <Fragment key={group.title}>
          <h4>{group.title}</h4>
          {group.items.map((item) => {
            const on = item.on(path);
            const className = [on ? "on" : "", item.keep ? "keep" : ""].filter(Boolean).join(" ");
            return (
              <Link key={item.href} href={item.href} className={className || undefined} aria-current={on && path === item.href ? "page" : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}
