"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Fetches the page's numbers again every so often, so a job page left open
 * shows new results and payouts without anyone pressing reload. It waits
 * while the tab is in the background.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
