/**
 * Works out what a result has earned from what was measured. Plain sums in
 * whole cents. Moves no money: lane A pays the part not yet paid.
 */
import type { JobCard, Measured } from "@/contract/types";

/** The number a per-unit job counts, out of what was measured. */
export function countedUnits(card: JobCard, measured: Measured): number {
  if (card.payRule.kind !== "per_unit") return 0;
  switch (card.payRule.unit) {
    case "view":
      return measured.views ?? 0;
    case "click":
      return measured.clicksReal ?? 0;
    case "sale":
      return measured.sales ?? 0;
    case "item":
      return measured.items ?? 0;
  }
}

/**
 * Everything this result has earned, never more than the job's cap.
 * finishMet matters only for "once" pay: the one amount is earned when the
 * finish line is met.
 */
export function earnedFor(card: JobCard, measured: Measured, finishMet: boolean): number {
  const rule = card.payRule;
  let cents: number;
  if (rule.kind === "per_unit") {
    // $2.00 for every 1,000 views pays in proportion: 6,200 views is $12.40.
    cents = Math.floor((countedUnits(card, measured) * rule.centsPerBatch) / rule.batchSize);
  } else if (rule.kind === "per_rule") {
    cents = (measured.rulesPassed ?? 0) * rule.centsPerRule;
  } else {
    cents = finishMet ? rule.cents : 0;
  }
  return Math.max(0, Math.min(cents, card.capCents));
}
