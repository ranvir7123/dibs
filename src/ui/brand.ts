/**
 * Made-up logos for the sample businesses, so the board looks like real
 * brands post on it. Each mark is drawn by us (see Avatar.tsx) and is tied to
 * the sample person's id. Everyone else keeps the letter badge.
 */
export type BrandMark = "kettle" | "spool" | "comet" | "loaf";

export interface Brand {
  mark: BrandMark;
  /** The badge's fill colour. */
  back: string;
  /** The colour of the drawing. */
  ink: string;
}

const BRANDS: Record<string, Brand> = {
  per_kettle: { mark: "kettle", back: "#f4dfd3", ink: "#9a4527" },
  per_loom: { mark: "spool", back: "#dfe5f2", ink: "#3a4d87" },
  per_tinycomet: { mark: "comet", back: "#232744", ink: "#ffd66b" },
  per_northside: { mark: "loaf", back: "#f3e3bd", ink: "#84560f" },
};

/** The logo for a sample business, or null for anyone else. */
export function brandFor(personId: string | null | undefined): Brand | null {
  return (personId && Object.hasOwn(BRANDS, personId) ? BRANDS[personId] : null) ?? null;
}
