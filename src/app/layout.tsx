import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import type { ReactNode } from "react";
import { IconSprite } from "@/ui/Icon";
import "./globals.css";

// The outer frame of every page. One font for everything: Figtree, a free
// round sans, in weights from normal text up to the heavy headings.
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], variable: "--font-figtree", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dibs", template: "%s · Dibs" },
  description: "Post a result. Pay only when it is real.",
};

export const viewport: Viewport = {
  themeColor: "#ebe3d6",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={figtree.variable}>
      <body>
        <IconSprite />
        {children}
      </body>
    </html>
  );
}
