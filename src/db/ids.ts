import { randomBytes } from "node:crypto";

const LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (0/o, 1/l/i)

function randomText(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += LETTERS[bytes[i] % LETTERS.length];
  return out;
}

/** A new id such as "job_k3m9x2pq7w4n". Prefixes: per, job, clm, res, chk, rdg, mov, clk, sal. */
export function newId(prefix: string): string {
  return `${prefix}_${randomText(12)}`;
}

/** A new tracked link code: 8 lowercase letters and digits, short enough to share. */
export function newLinkCode(): string {
  return randomText(8);
}
