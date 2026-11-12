import type { ReactNode } from "react";
import { brandFor, type BrandMark } from "./brand";
import { initial, tone } from "./format";

/** The made-up logos, drawn by us as simple line pictures on a 24 by 24 grid. */
const MARKS: Record<BrandMark, ReactNode> = {
  // A kettle with two curls of steam.
  kettle: (
    <>
      <path d="M6 19h11a1 1 0 0 0 1-1v-3a6.5 6.5 0 0 0-13 0v3a1 1 0 0 0 1 1z" />
      <path d="M18 13h1.2a2 2 0 0 1 0 4H18M5.1 13.6 2.6 11.4M10 5.6c0-1.1 1-1.1 1-2.2M13.4 5.6c0-1.1 1-1.1 1-2.2" />
    </>
  ),
  // A spool of thread.
  spool: <path d="M6.5 4.5h11M6.5 19.5h11M9 4.5v15M15 4.5v15M9 8.5h6M9 12h6M9 15.5h6" />,
  // A comet with its tail.
  comet: (
    <>
      <circle cx="15.5" cy="15.5" r="3.8" fill="currentColor" stroke="none" />
      <path d="M12 12 4 4M10.3 16.2 6.2 12.1M16.2 10.3 12.1 6.2" />
    </>
  ),
  // A loaf of bread with three cuts.
  loaf: (
    <>
      <path d="M4 12a3.5 3.5 0 0 1 3.5-3.5h9A3.5 3.5 0 0 1 20 12c0 1-.5 1.8-1.2 2.3V18a1 1 0 0 1-1 1H6.2a1 1 0 0 1-1-1v-3.7C4.5 13.8 4 13 4 12z" />
      <path d="M8.6 11.5 9.8 14M11.6 11.5l1.2 2.5M14.6 11.5l1.2 2.5" />
    </>
  ),
};

/**
 * The round picture for a person. A sample business (known by its id) shows its
 * made-up logo; everyone else shows their first letter, in the colour that goes
 * with their name.
 */
export function Avatar({ name, id }: { name: string; id?: string | null }) {
  const brand = brandFor(id);
  if (brand) {
    return (
      <span className="avatar logo" style={{ background: brand.back, color: brand.ink }} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {MARKS[brand.mark]}
        </svg>
      </span>
    );
  }
  return (
    <span className={`avatar ${tone(name)}`} aria-hidden="true">
      {initial(name)}
    </span>
  );
}
