import { describe, expect, it } from "vitest";
import * as money from "@/money";

// This file described the hand-over state: each lane's functions said plainly
// that they were not built yet. Both lanes have now built theirs.
// Lane A built its five functions on 10 Nov 2026. Their tests are in src/money/.
// Lane B built its four functions on 10 Nov 2026. Their tests are in src/checkers/.

describe("lane A (money) functions keep their agreed names", () => {
  it("has startHold, confirmHold, payWorker, letGo and recordSale", () => {
    for (const name of ["startHold", "confirmHold", "payWorker", "letGo", "recordSale"] as const) {
      expect(typeof money[name]).toBe("function");
    }
  });
});
