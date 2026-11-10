import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { IconSprite } from "@/ui/Icon";
import "./globals.css";

// The outer frame of every page. The fonts are the two in the approved
// drawing: Geist for everything, Instrument Serif italic for the word "Dibs".
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dibs", template: "%s · Dibs" },
  description: "Post a result. Pay only when it is real.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${serif.variable}`}>
      <body>
        <IconSprite />
        {children}
      </body>
    </html>
  );
}
