import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./client";

// The embedded database must only ever be open in one program at a time.
// These tests use a real folder in the temp directory, not the project's.
const folder = mkdtempSync(path.join(os.tmpdir(), "dibs-lock-test-"));
const dataDir = path.join(folder, "db");
const lockFile = `${dataDir}.lock`;
process.env.DIBS_DATA_DIR = dataDir;

afterEach(closeDb);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe("the embedded database folder", () => {
  it("refuses to open while another running program has it open", async () => {
    writeFileSync(lockFile, String(process.ppid)); // our parent is certainly running
    await expect(getDb()).rejects.toThrow("already open in another program");
    await expect(getDb()).rejects.toThrow("DIBS_DATA_DIR");
    rmSync(lockFile);
  });

  it("opens when the program that had it open is gone", async () => {
    writeFileSync(lockFile, "99999999"); // no such program
    await getDb();
    expect(readFileSync(lockFile, "utf8")).toBe(String(process.pid));
  });

  it("frees the folder when it is closed", async () => {
    await getDb();
    expect(existsSync(lockFile)).toBe(true);
    await closeDb();
    expect(existsSync(lockFile)).toBe(false);
  });
});
