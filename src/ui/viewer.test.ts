import { describe, expect, it, vi } from "vitest";

// viewer.ts reads cookies and the database; safeNext itself needs neither.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("@/contract", () => ({ getPerson: async () => null, PERSON_COOKIE: "dibs_person" }));

import { safeNext } from "./viewer";

describe("safeNext", () => {
  it("keeps addresses inside Dibs", () => {
    expect(safeNext("/work")).toBe("/work");
    expect(safeNext("/jobs/job_1?show=paid")).toBe("/jobs/job_1?show=paid");
  });

  it("sends everything else to the board", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    // Browsers drop the tab, which would leave //evil.example
    expect(safeNext("/\t/evil.example")).toBe("/");
    expect(safeNext("/\n/evil.example")).toBe("/");
  });
});
