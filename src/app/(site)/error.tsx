"use client";

import { useEffect } from "react";
import { ErrorPanel } from "@/ui/ErrorPanel";

// Shown inside the window when a page could not be drawn. The details go to
// the browser's log; the person sees plain words and a way forward.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorPanel retry={retry} />;
}
