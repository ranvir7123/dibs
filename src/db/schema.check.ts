/**
 * Proof, by the type checker, that each table row has exactly the shape the
 * contract promises. If a column and a contract field drift apart,
 * "npm run typecheck" fails on the matching line below. Nothing here runs.
 */
import type * as contract from "../contract/types";
import type * as schema from "./schema";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export type TablesMatchContract = [
  Expect<Same<Row<typeof schema.people>, contract.Person>>,
  Expect<Same<Row<typeof schema.jobs>, contract.Job>>,
  Expect<Same<Row<typeof schema.claims>, contract.Claim>>,
  Expect<Same<Row<typeof schema.results>, contract.Result>>,
  Expect<Same<Row<typeof schema.checks>, contract.Check>>,
  Expect<Same<Row<typeof schema.readings>, contract.Reading>>,
  Expect<Same<Row<typeof schema.moneyMoves>, contract.MoneyMove>>,
  Expect<Same<Row<typeof schema.trackedLinks>, contract.TrackedLink>>,
  Expect<Same<Row<typeof schema.clicks>, contract.Click>>,
  Expect<Same<Row<typeof schema.sales>, contract.Sale>>,
];

type Expect<T extends true> = T;
