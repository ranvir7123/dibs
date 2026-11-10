/** True when the value is a money amount Dibs accepts: a whole number of cents, zero or more. */
export function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Writes whole cents as dollars for the screen: 1240 becomes "$12.40". */
export function formatCents(cents: number): string {
  if (!isCents(cents)) {
    throw new Error(`Money must be whole cents, zero or more. Got: ${cents}`);
  }
  const dollars = Math.floor(cents / 100).toLocaleString("en-US");
  const rest = String(cents % 100).padStart(2, "0");
  return `$${dollars}.${rest}`;
}
