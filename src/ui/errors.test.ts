import { describe, expect, it } from "vitest";
import { isNotBuilt, plainError } from "./errors";

describe("plainError", () => {
  it("turns a part that is not built yet into plain words", () => {
    const text = plainError(new Error("not built yet: lane B owns writeJobCard"));
    expect(text).toBe("The part of Dibs that writes job cards is not switched on yet. Nothing was saved and no money was locked.");
    expect(text).not.toContain("lane");
  });

  it("has words for every part another lane owns", () => {
    for (const name of ["startHold", "confirmHold", "payWorker", "letGo", "recordSale", "writeJobCard", "runChecks", "tick", "storeHandInFile"]) {
      const text = plainError(new Error(`not built yet: lane A owns ${name}`));
      expect(text).not.toContain("not built yet");
      expect(text).not.toContain(name);
    }
  });

  it("knows when an error is a part that is not built", () => {
    expect(isNotBuilt(new Error("not built yet: lane A owns startHold"))).toBe(true);
    expect(isNotBuilt(new Error("Please give the email your PayPal uses."))).toBe(false);
  });

  it("passes on the database's own plain sentences", () => {
    expect(plainError(new Error("Please give the email your PayPal uses."))).toBe("Please give the email your PayPal uses.");
    // Lane B's sentences do not always end with a full stop.
    const noStop = "This job counts clicks or sales, so please add the link to your page, starting with https://";
    expect(plainError(new Error(noStop))).toBe(noStop);
  });

  it("never shows code-like errors", () => {
    expect(plainError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe("Something went wrong on our side. Please try again.");
    expect(plainError("boom")).toBe("Something went wrong on our side. Please try again.");
    expect(plainError(new Error('duplicate key value violates unique constraint "x"'))).toBe("Something went wrong on our side. Please try again.");
  });
});
