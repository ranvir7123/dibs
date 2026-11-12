import { describe, expect, it } from "vitest";
import { brandFor } from "./brand";

describe("brandFor", () => {
  it("gives each sample business its own logo and colours", () => {
    const ids = ["per_kettle", "per_loom", "per_tinycomet", "per_northside"];
    const brands = ids.map((id) => brandFor(id));
    expect(brands.map((brand) => brand?.mark)).toEqual(["kettle", "spool", "comet", "loaf"]);
    expect(new Set(brands.map((brand) => brand?.back)).size).toBe(4);
    for (const brand of brands) {
      expect(brand?.back).toMatch(/^#[0-9a-f]{6}$/);
      expect(brand?.ink).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("gives nothing to workers, new businesses, or no one", () => {
    expect(brandFor("per_aarav")).toBeNull();
    expect(brandFor("per_abc123")).toBeNull();
    expect(brandFor("toString")).toBeNull();
    expect(brandFor("")).toBeNull();
    expect(brandFor(null)).toBeNull();
    expect(brandFor(undefined)).toBeNull();
  });
});
