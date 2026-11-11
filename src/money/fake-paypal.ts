/**
 * A pretend PayPal for tests. It keeps PayPal's rules that matter to Dibs:
 * - a hold can be taken from in parts, never for more than is left;
 * - each take needs its own invoice number;
 * - the same request id sent twice gives the first answer, not a second take;
 * - a payout batch id can be used once;
 * - nothing can be taken from a hold that was let go.
 */
import { PayPalProblem, type PayPal, type PayPalOrder, type PayPalPayout } from "./paypal";

type Action = "createHoldOrder" | "createSaleOrder" | "getOrder" | "authorizeOrder" | "captureOrder" | "takeFromHold" | "getHold" | "refundPayment" | "voidHold" | "sendPayout" | "getPayout" | "verifyWebhook";

interface Hold {
  id: string;
  amountCents: number;
  takenCents: number;
  voided: boolean;
  invoices: Set<string>;
}

export interface FakePayPal extends PayPal {
  /** Every call made, in order. */
  calls: { action: Action; [key: string]: unknown }[];
  /** The payer approves an order on PayPal's page. */
  approve(orderId: string): void;
  /** Makes the next call of this kind fail. status 0 means "PayPal could not be reached". */
  failNext(action: Action, issue?: string, status?: number): void;
  /** What a payout ends as (default SUCCESS), and how many look-ups it stays PENDING for first (default 0). */
  payoutEnds(status: string, pendingLooks?: number): void;
  /** What is still held on a hold. */
  heldCents(authorizationId: string): number;
  /** Whether verifyWebhook says a message is real (default true). */
  webhookIsReal: boolean;
  /** How many payouts PayPal really made (a repeat of a batch id makes none). */
  payoutsMade: number;
  /** What PayPal says about the next takes (default COMPLETED). */
  takeStatus: string;
  count(action: Action): number;
  /** A refund made on PayPal's own site, not through Dibs. */
  refundOutside(orderId: string, cents: number): void;
}

// One counter for every pretend PayPal in a test file, so two of them never hand out the same number
// (PayPal's real numbers are never repeated either).
let next = 1;

export function makeFakePayPal(): FakePayPal {
  const id = (prefix: string) => `${prefix}${String(next++).padStart(6, "0")}`;
  const orders = new Map<string, PayPalOrder & { intent: "AUTHORIZE" | "CAPTURE" }>();
  const holds = new Map<string, Hold>();
  const takesByRequest = new Map<string, { id: string; status: string }>();
  const payouts = new Map<string, { info: PayPalPayout; looksLeft: number; ends: string }>();
  const failures = new Map<Action, { issue: string; status: number }>();
  let payoutEnd = "SUCCESS";
  let payoutPendingLooks = 0;

  const begin = (action: Action, details: Record<string, unknown> = {}) => {
    fake.calls.push({ action, ...details });
    const failure = failures.get(action);
    if (failure) {
      failures.delete(action);
      throw new PayPalProblem(`PayPal said no (${failure.issue})`, failure.status, [failure.issue]);
    }
  };
  const no = (issue: string, status = 422) => new PayPalProblem(`PayPal said no (${issue})`, status, [issue]);
  const order = (orderId: string) => {
    const found = orders.get(orderId);
    if (!found) throw no("RESOURCE_NOT_FOUND", 404);
    return found;
  };
  const copy = (o: PayPalOrder): PayPalOrder => ({ ...o, authorization: o.authorization && { ...o.authorization }, capture: o.capture && { ...o.capture } });

  const create = (intent: "AUTHORIZE" | "CAPTURE", input: { amountCents: number; customId: string; returnUrl?: string }) => {
    const made = {
      intent,
      id: id("ORDER"),
      status: input.returnUrl ? "PAYER_ACTION_REQUIRED" : "CREATED",
      approveUrl: "",
      customId: input.customId,
      amountCents: input.amountCents,
      currency: "USD",
      authorization: null,
      capture: null,
      refundedCents: 0,
      paidWithPayPalAccount: true,
    };
    made.approveUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${made.id}`;
    orders.set(made.id, made);
    return copy(made);
  };

  const finished = (entry: { info: PayPalPayout; ends: string }) => {
    entry.info.batchStatus = entry.ends === "SUCCESS" || entry.ends === "UNCLAIMED" ? "SUCCESS" : entry.ends === "PENDING" ? "PROCESSING" : "SUCCESS";
    entry.info.itemStatus = entry.ends;
    entry.info.itemId = entry.info.itemId ?? id("ITEM");
    entry.info.transactionId = entry.ends === "SUCCESS" ? (entry.info.transactionId ?? id("TXN")) : null;
    entry.info.problem = entry.ends === "SUCCESS" || entry.ends === "PENDING" ? null : `RECEIVER_PROBLEM: ${entry.ends}`;
  };

  const fake: FakePayPal = {
    calls: [],
    webhookIsReal: true,
    payoutsMade: 0,
    takeStatus: "COMPLETED",
    count: (action) => fake.calls.filter((c) => c.action === action).length,
    refundOutside(orderId, cents) {
      const of = order(orderId);
      of.refundedCents += cents;
      if (of.capture) of.capture.status = of.refundedCents >= of.capture.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
    },
    approve(orderId) {
      order(orderId).status = "APPROVED";
      order(orderId).approveUrl = null;
    },
    failNext(action, issue = "INTERNAL_SERVICE_ERROR", status = 422) {
      failures.set(action, { issue, status });
    },
    payoutEnds(status, pendingLooks = 0) {
      payoutEnd = status;
      payoutPendingLooks = pendingLooks;
    },
    heldCents(authorizationId) {
      const hold = holds.get(authorizationId);
      return hold && !hold.voided ? hold.amountCents - hold.takenCents : 0;
    },

    async createHoldOrder(input) {
      begin("createHoldOrder", { ...input });
      return create("AUTHORIZE", input);
    },
    async createSaleOrder(input) {
      begin("createSaleOrder", { ...input });
      return create("CAPTURE", input);
    },
    async getOrder(orderId) {
      begin("getOrder", { orderId });
      return copy(order(orderId));
    },
    async authorizeOrder(orderId) {
      begin("authorizeOrder", { orderId });
      const found = order(orderId);
      if (found.authorization) throw no("ORDER_ALREADY_AUTHORIZED");
      if (found.status !== "APPROVED") throw no("ORDER_NOT_APPROVED");
      const hold: Hold = { id: id("AUTH"), amountCents: found.amountCents ?? 0, takenCents: 0, voided: false, invoices: new Set() };
      holds.set(hold.id, hold);
      found.status = "COMPLETED";
      found.authorization = { id: hold.id, status: "CREATED", amountCents: hold.amountCents, endsAt: new Date(Date.now() + 29 * 86_400_000) };
      return copy(found);
    },
    async captureOrder(orderId) {
      begin("captureOrder", { orderId });
      const found = order(orderId);
      if (found.capture) throw no("ORDER_ALREADY_CAPTURED");
      if (found.status !== "APPROVED") throw no("ORDER_NOT_APPROVED");
      found.status = "COMPLETED";
      found.capture = { id: id("CAP"), status: "COMPLETED", amountCents: found.amountCents ?? 0 };
      return copy(found);
    },
    async takeFromHold(input) {
      begin("takeFromHold", input);
      const before = takesByRequest.get(input.requestId);
      if (before) return { ...before };
      const hold = holds.get(input.authorizationId);
      if (!hold) throw no("RESOURCE_NOT_FOUND", 404);
      if (hold.voided) throw no("AUTHORIZATION_VOIDED");
      if (hold.invoices.has(input.invoiceId)) throw no("DUPLICATE_TRANSACTION");
      if (input.amountCents <= 0 || input.amountCents > hold.amountCents - hold.takenCents) throw no("MAX_CAPTURE_AMOUNT_EXCEEDED");
      hold.takenCents += input.amountCents;
      hold.invoices.add(input.invoiceId);
      const made = { id: id("CAP"), status: fake.takeStatus };
      takesByRequest.set(input.requestId, made);
      return { ...made };
    },
    async getHold(authorizationId) {
      begin("getHold", { authorizationId });
      const hold = holds.get(authorizationId);
      const of = [...orders.values()].find((o) => o.authorization?.id === authorizationId);
      if (!hold || !of?.authorization) throw no("RESOURCE_NOT_FOUND", 404);
      return { status: hold.voided ? "VOIDED" : hold.takenCents > 0 ? "PARTIALLY_CAPTURED" : "CREATED", amountCents: hold.amountCents, endsAt: of.authorization.endsAt };
    },
    async refundPayment(input) {
      begin("refundPayment", input);
      const of = [...orders.values()].find((o) => o.capture?.id === input.captureId);
      if (!of?.capture) throw no("RESOURCE_NOT_FOUND", 404);
      const left = of.capture.amountCents - of.refundedCents;
      const amount = input.amountCents ?? left;
      if (left <= 0) throw no("CAPTURE_FULLY_REFUNDED");
      if (amount <= 0 || amount > left) throw no("REFUND_AMOUNT_EXCEEDED");
      of.refundedCents += amount;
      of.capture.status = of.refundedCents >= of.capture.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
      return { id: id("REFUND"), status: "COMPLETED" };
    },
    async voidHold(authorizationId) {
      begin("voidHold", { authorizationId });
      const hold = holds.get(authorizationId);
      if (!hold) throw no("RESOURCE_NOT_FOUND", 404);
      hold.voided = true;
      return { status: "VOIDED" };
    },
    async sendPayout(input) {
      begin("sendPayout", input);
      // Like the real one: a batch id used before pays nothing new and gives back the first payout.
      const before = payouts.get(input.batchId);
      if (before) return fake.getPayout(before.info.batchId);
      fake.payoutsMade += 1;
      const entry = {
        info: { batchId: id("BATCH"), batchStatus: "PENDING", itemStatus: null, itemId: null, transactionId: null, problem: null } as PayPalPayout,
        looksLeft: payoutPendingLooks,
        ends: payoutEnd,
      };
      payouts.set(input.batchId, entry);
      return { ...entry.info };
    },
    async getPayout(batchId) {
      begin("getPayout", { batchId });
      const entry = [...payouts.values()].find((p) => p.info.batchId === batchId);
      if (!entry) throw no("RESOURCE_NOT_FOUND", 404);
      if (entry.looksLeft > 0) {
        entry.looksLeft -= 1;
        return { ...entry.info, batchStatus: "PROCESSING", itemStatus: "PENDING" };
      }
      // A payout that was set to stay pending finishes as whatever is set now.
      if (entry.ends === "PENDING") entry.ends = payoutEnd;
      finished(entry);
      return { ...entry.info };
    },
    async verifyWebhook(input) {
      begin("verifyWebhook", { webhookId: input.webhookId });
      return fake.webhookIsReal;
    },
  };
  return fake;
}
