import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as contract from "./index";
import { settings } from "../settings";

// docs/CONTRACT.md and src/contract/ must say the same thing. This test reads
// the code and fails for any name the document does not mention.

const root = process.cwd();
const doc = readFileSync(path.join(root, "docs/CONTRACT.md"), "utf8");
const typesSource = readFileSync(path.join(root, "src/contract/types.ts"), "utf8");
const inCode = (name: string) => doc.includes(`\`${name}\``) || doc.includes(`${name}(`);

/** Splits types.ts into each exported shape and the field names inside it. */
function shapes(): { name: string; fields: string[] }[] {
  const out: { name: string; fields: string[] }[] = [];
  const pattern = /export (?:interface|type) (\w+)[^{=]*(?:=\s*)?([\s\S]*?)(?=\nexport |\n\/\/ -{10,}|$)/g;
  for (const match of typesSource.matchAll(pattern)) {
    const body = match[2].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const fields = [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
    out.push({ name: match[1], fields: [...new Set(fields)] });
  }
  return out;
}

describe("docs/CONTRACT.md matches src/contract", () => {
  const all = shapes();

  it("finds the shapes in the code", () => {
    const names = all.map((s) => s.name);
    for (const expected of ["Person", "Job", "JobCard", "Claim", "Result", "Check", "MoneyMove", "TrackedLink"]) {
      expect(names).toContain(expected);
    }
    expect(all.find((s) => s.name === "Person")?.fields).toEqual(["id", "name", "paypalEmail", "createdAt"]);
  });

  it("names every shape", () => {
    expect(all.map((s) => s.name).filter((name) => !inCode(name))).toEqual([]);
  });

  it("names every field of every shape", () => {
    const missing = all.flatMap((s) => s.fields.filter((f) => !inCode(f)).map((f) => `${s.name}.${f}`));
    expect(missing).toEqual([]);
  });

  it("names every function and value the contract exports", () => {
    expect(Object.keys(contract).filter((name) => !inCode(name) && name !== "PERSON_COOKIE")).toEqual([]);
    expect(doc).toContain("PERSON_COOKIE");
    expect(doc).toContain(`\`${contract.PERSON_COOKIE}\``);
  });

  it("lists every setting with its current value", () => {
    const flat = (value: object, prefix = ""): [string, unknown][] =>
      Object.entries(value).flatMap(([key, v]) =>
        typeof v === "object" && v !== null ? flat(v, `${prefix}${key}.`) : [[`${prefix}${key}`, v]],
      );
    const section = doc.slice(doc.indexOf("## 5. Settings"), doc.indexOf("## 6."));
    expect(section.length).toBeGreaterThan(100);
    for (const [name, value] of flat(settings)) {
      // A nested setting such as cheatTests.viewJump.minViewsBeforeTesting is found
      // by its group ("viewJump") and its own name, which share one row.
      const parts = name.split(".").slice(-2);
      const row = section.split("\n").find((line) => line.startsWith("|") && parts.every((part) => line.includes(part)));
      expect(row, `settings.${name} is missing from CONTRACT.md`).toBeDefined();
      expect(row, `settings.${name} shows a different value in CONTRACT.md`).toContain(String(value));
    }
  });

  it("lists every name in .env.example, and the other way round", () => {
    const example = readFileSync(path.join(root, ".env.example"), "utf8");
    const lines = example.split("\n").filter((line) => /^[A-Z0-9_]+=/.test(line));
    const names = lines.map((line) => line.split("=")[0]);
    expect(names.filter((name) => !doc.includes(`\`${name}\``))).toEqual([]);
    expect(lines.filter((line) => !line.trim().endsWith("="))).toEqual([]); // no values, ever
    for (const needed of [
      "PAYPAL_CLIENT_ID",
      "PAYPAL_CLIENT_SECRET",
      "PAYPAL_TEST_BUYER_EMAIL",
      "PAYPAL_TEST_WORKER_EMAIL",
      "GOOGLE_AI_API_KEY",
      "YOUTUBE_API_KEY",
      "ANTHROPIC_API_KEY",
      "DATABASE_URL",
    ]) {
      expect(names).toContain(needed);
    }
  });
});
