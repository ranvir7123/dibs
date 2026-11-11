import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// The database is told it is a hosted one, so the lock takes the path it
// takes online. The lock question itself is put to the real built-in
// Postgres in the first test, and answered by a stand-in in the second
// (a laptop has only one connection, so it cannot be refused its own lock).
const kind = vi.fn(async () => "hosted" as "hosted" | "embedded");
vi.mock("@/db/client", async (importActual) => {
  const actual = await importActual<typeof import("@/db/client")>();
  return { ...actual, dbKind: () => kind() };
});

import * as client from "@/db/client";
import { tickBusyHere, withTickLock } from "./tick-lock";

afterEach(() => {
  kind.mockClear();
  vi.restoreAllMocks();
});
afterAll(client.closeDb);

describe("the tick lock", () => {
  it("asks the database for the lock, runs the work, and frees the lock afterwards", async () => {
    const first = await withTickLock(async () => "done");
    expect(first).toEqual({ ran: true, value: "done" });
    // The lock was let go with the transaction, so the next one gets it too.
    expect(await withTickLock(async () => 2)).toEqual({ ran: true, value: 2 });
    expect(tickBusyHere()).toBe(false);
  });

  it("does nothing when another program holds the lock", async () => {
    const work = vi.fn(async () => "should not run");
    vi.spyOn(client, "getDb").mockResolvedValue({
      transaction: async (inside: (tx: unknown) => Promise<unknown>) => inside({ execute: async () => ({ rows: [{ got: false }] }) }),
    } as never);
    expect(await withTickLock(work)).toEqual({ ran: false });
    expect(work).not.toHaveBeenCalled();
  });

  it("lets only one run at a time inside one program, and frees the mark when the work fails", async () => {
    kind.mockResolvedValue("embedded");
    let release!: () => void;
    const slow = withTickLock(() => new Promise<string>((resolve) => (release = () => resolve("first"))));
    await vi.waitFor(() => expect(tickBusyHere()).toBe(true));
    expect(await withTickLock(async () => "second")).toEqual({ ran: false });
    release();
    expect(await slow).toEqual({ ran: true, value: "first" });

    await expect(
      withTickLock(async () => {
        throw new Error("broke");
      }),
    ).rejects.toThrow("broke");
    expect(tickBusyHere()).toBe(false);
  });
});
