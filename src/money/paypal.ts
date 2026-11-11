/**
 * Every call Dibs makes to PayPal goes through this file. Nothing outside
 * src/money talks to PayPal, and AI never does.
 *
 * Test mode only: the address must be PayPal's sandbox (pretend money).
 * Keys come from PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET and are never
 * printed or put in an error message.
 *
 * Tests swap the real PayPal for a pretend one with usePayPal(fake).
 */

import { settings } from "../settings";

const SANDBOX ="https://api-m.sandbox.paypal.com";

/** What our own label on a PayPal order starts with, so PayPal's messages can be told apart. */
export const JOB_LABEL = "dibs-job:";
export const SALE_LABEL = "dibs-sale:";

/** A PayPal answer that was not a success, in plain words. */
export class PayPalProblem extends Error {
  constructor(
    message: string,
    /** The web status PayPal answered with (0 when PayPal could not be reached). */
    readonly status: number,
    /** PayPal's own short codes for what went wrong, such as AUTHORIZATION_VOIDED. */
    readonly issues: string[],
    /** PayPal's whole answer, for the few cases that need more than the codes. Never shown to anyone. */
    readonly answer: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PayPalProblem";
  }
}

export interface PayPalOrder {
  id: string;
  /** CREATED, PAYER_ACTION_REQUIRED, APPROVED, COMPLETED, VOIDED. */
  status: string;
  /** The page the payer approves on. Null once approved. */
  approveUrl: string | null;
  /** Our own label, sent back by PayPal. */
  customId: string | null;
  amountCents: number | null;
  currency: string | null;
  /** The hold, once the order has been authorised. */
  authorization: { id: string; status: string; amountCents: number; /** The date the hold ends, from PayPal's own answer. */ endsAt: Date | null } | null;
  /** The payment, once the order has been captured. */
  capture: { id: string; status: string; amountCents: number } | null;
  /** How much of the payment has been refunded to the payer, added up from PayPal's own list of refunds. */
  refundedCents: number;
  /** True when the payer used a PayPal account (not a raw card number). */
  paidWithPayPalAccount: boolean;
}

export interface PayPalPayout {
  batchId: string;
  /** PENDING, PROCESSING, SUCCESS, DENIED, CANCELED for the batch. */
  batchStatus: string;
  /** SUCCESS, FAILED, PENDING, UNCLAIMED, RETURNED, ONHOLD, BLOCKED, REFUNDED, REVERSED. Null until PayPal lists the item. */
  itemStatus: string | null;
  itemId: string | null;
  /** The number both sides see in their PayPal activity. Set when the money has moved. */
  transactionId: string | null;
  /** PayPal's reason when the item did not go through. */
  problem: string | null;
}

export interface WebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

/**
 * What an order is made from. With returnUrl and cancelUrl the payer leaves
 * our page for PayPal's and is sent back. Without them the order is for
 * PayPal's button, whose window opens over our page.
 */
export interface OrderInput {
  requestId: string;
  amountCents: number;
  description: string;
  customId: string;
  returnUrl?: string;
  cancelUrl?: string;
}

/** The PayPal actions Dibs uses. The real one calls PayPal; tests pass a pretend one. */
export interface PayPal {
  /** An order that HOLDS money (nothing is taken yet). The payer approves it on PayPal's page. */
  createHoldOrder(input: OrderInput): Promise<PayPalOrder>;
  /** An order that TAKES money at once when approved: a shop sale. */
  createSaleOrder(input: OrderInput): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  /** Turns an approved hold order into a real hold. */
  authorizeOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  /** Takes the money of an approved sale order. */
  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  /** Takes part of a hold. The rest stays held. */
  takeFromHold(input: { authorizationId: string; requestId: string; amountCents: number; invoiceId: string; note: string }): Promise<{ id: string; status: string }>;
  /** Reads a hold again: its state and the date it ends. */
  getHold(authorizationId: string): Promise<{ status: string; amountCents: number; endsAt: Date | null }>;
  /** Gives a payment back to the payer: all of it, or amountCents of it. */
  refundPayment(input: { captureId: string; requestId: string; amountCents?: number; note?: string }): Promise<{ id: string; status: string }>;
  /** Lets a hold go. Fine to call on a hold that was already let go. */
  voidHold(authorizationId: string): Promise<{ status: string }>;
  /** Sends money to an email address, with a note. PayPal finishes it some seconds later. */
  sendPayout(input: { batchId: string; email: string; amountCents: number; note: string; subject: string }): Promise<PayPalPayout>;
  getPayout(batchId: string): Promise<PayPalPayout>;
  /** Asks PayPal whether a message that reached our server really came from PayPal. */
  verifyWebhook(input: { webhookId: string; headers: WebhookHeaders; rawBody: string }): Promise<boolean>;
}

// ---------------------------------------------------------------- money as text

/** 1240 -> "12.40". PayPal wants money as text with two decimals. */
export function centsToText(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Not whole cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "12.40" -> 1240. Null when the text is not money. */
export function textToCents(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

// ---------------------------------------------------------------- the real PayPal

type Json = Record<string, unknown>;

function apiBase(): string {
  const base = (process.env.PAYPAL_API_BASE?.trim() || SANDBOX).replace(/\/+$/, "");
  if (!/^https:\/\/api(-m)?\.sandbox\.paypal\.com$/.test(base)) {
    throw new Error("Dibs only works with PayPal test mode. PAYPAL_API_BASE must be empty or PayPal's sandbox address.");
  }
  return base;
}

let cachedToken: { value: string; goodUntil: number; forClient: string } | null = null;

async function token(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new PayPalProblem("The PayPal test keys are missing. Put PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local.", 0, ["NO_KEYS"]);
  }
  if (cachedToken && cachedToken.forClient === id && cachedToken.goodUntil > Date.now()) return cachedToken.value;
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PayPalProblem("Could not reach PayPal test mode.", 0, ["UNREACHABLE"]);
  }
  const data = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok || typeof data.access_token !== "string") {
    throw new PayPalProblem(`PayPal test mode refused the keys (status ${response.status}).`, response.status, ["BAD_KEYS"]);
  }
  const seconds = typeof data.expires_in === "number" ? data.expires_in : 300;
  cachedToken = { value: data.access_token, goodUntil: Date.now() + (seconds - 60) * 1000, forClient: id };
  return cachedToken.value;
}

const EMAIL = /[\w.+-]+@[\w.-]+\.\w+/g;

function problemFrom(status: number, data: Json): PayPalProblem {
  const details = Array.isArray(data.details) ? (data.details as Json[]) : [];
  const issues = details.map((d) => d.issue).filter((i): i is string => typeof i === "string");
  if (typeof data.name === "string") issues.push(data.name);
  const said =
    details.map((d) => d.description).find((d): d is string => typeof d === "string") ??
    (typeof data.message === "string" ? data.message : "no reason given");
  const text = `PayPal said no (status ${status}${issues.length ? `, ${issues.join(", ")}` : ""}): ${said}`;
  return new PayPalProblem(text.replace(EMAIL, "<email>"), status, issues, data);
}

/** One call to PayPal. Throws PayPalProblem for anything that is not a success. */
async function call(method: "GET" | "POST" | "DELETE", path: string, options: { body?: Json | string; requestId?: string } = {}): Promise<Json> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token()}`,
    Accept: "application/json",
    Prefer: "return=representation",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  // The same request id sent twice makes PayPal answer with the first result
  // instead of doing the thing twice.
  if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new PayPalProblem("Could not reach PayPal test mode. Nothing is known about this call, so it will be tried again.", 0, ["UNREACHABLE"]);
  }
  const raw = await response.text();
  let data: Json = {};
  try {
    data = raw ? (JSON.parse(raw) as Json) : {};
  } catch {
    data = { message: "PayPal's answer could not be read." };
  }
  if (!response.ok) throw problemFrom(response.status, data);
  return data;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asOrder(data: Json): PayPalOrder {
  const unit = ((data.purchase_units as Json[] | undefined) ?? [])[0] ?? {};
  const amount = (unit.amount as Json | undefined) ?? {};
  const payments = (unit.payments as Json | undefined) ?? {};
  const auth = ((payments.authorizations as Json[] | undefined) ?? [])[0];
  const capture = ((payments.captures as Json[] | undefined) ?? [])[0];
  const links = (data.links as Json[] | undefined) ?? [];
  const approve = links.find((l) => l.rel === "payer-action") ?? links.find((l) => l.rel === "approve");
  const source = (data.payment_source as Json | undefined) ?? {};
  const moneyOf = (thing: Json | undefined) => textToCents(((thing?.amount as Json | undefined) ?? {}).value) ?? 0;
  return {
    id: String(data.id),
    status: String(data.status),
    approveUrl: approve && typeof approve.href === "string" ? approve.href : null,
    customId: typeof unit.custom_id === "string" ? unit.custom_id : null,
    amountCents: textToCents(amount.value),
    currency: typeof amount.currency_code === "string" ? amount.currency_code : null,
    authorization: auth ? { id: String(auth.id), status: String(auth.status), amountCents: moneyOf(auth), endsAt: asDate(auth.expiration_time) } : null,
    refundedCents: ((payments.refunds as Json[] | undefined) ?? []).filter((r) => r.status === "COMPLETED" || r.status === "PENDING").reduce((total, r) => total + moneyOf(r), 0),
    capture: capture ? { id: String(capture.id), status: String(capture.status), amountCents: moneyOf(capture) } : null,
    paidWithPayPalAccount: typeof source.paypal === "object" && source.paypal !== null,
  };
}

function asPayout(data: Json): PayPalPayout {
  const header = (data.batch_header as Json | undefined) ?? {};
  const item = ((data.items as Json[] | undefined) ?? [])[0];
  const errors = (item?.errors as Json | undefined) ?? undefined;
  const reason = errors ? [errors.name, errors.message].filter((x) => typeof x === "string").join(": ") : null;
  return {
    batchId: String(header.payout_batch_id),
    batchStatus: String(header.batch_status),
    itemStatus: item && typeof item.transaction_status === "string" ? item.transaction_status : null,
    itemId: item && typeof item.payout_item_id === "string" ? item.payout_item_id : null,
    transactionId: item && typeof item.transaction_id === "string" ? item.transaction_id : null,
    problem: reason ? reason.replace(EMAIL, "<email>") : null,
  };
}

function orderBody(intent: "AUTHORIZE" | "CAPTURE", input: OrderInput, currency: string): Json {
  const unit = { description: input.description.slice(0, 127), custom_id: input.customId.slice(0, 127), amount: { currency_code: currency, value: centsToText(input.amountCents) } };
  // For PayPal's button (its window opens over our page) the order carries no
  // return address: the button tells our page when the payer has approved.
  if (!input.returnUrl || !input.cancelUrl) return { intent, purchase_units: [unit] };
  return {
    intent,
    purchase_units: [
      {
        description: input.description.slice(0, 127),
        custom_id: input.customId.slice(0, 127),
        amount: { currency_code: currency, value: centsToText(input.amountCents) },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Dibs (test mode)",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
    },
  };
}

function realPayPal(currency: string): PayPal {
  return {
    async createHoldOrder(input) {
      return asOrder(await call("POST", "/v2/checkout/orders", { body: orderBody("AUTHORIZE", input, currency), requestId: input.requestId }));
    },
    async createSaleOrder(input) {
      return asOrder(await call("POST", "/v2/checkout/orders", { body: orderBody("CAPTURE", input, currency), requestId: input.requestId }));
    },
    async getOrder(orderId) {
      return asOrder(await call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`));
    },
    async authorizeOrder(orderId, requestId) {
      return asOrder(await call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { body: {}, requestId }));
    },
    async captureOrder(orderId, requestId) {
      return asOrder(await call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { body: {}, requestId }));
    },
    async takeFromHold(input) {
      const data = await call("POST", `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/capture`, {
        requestId: input.requestId,
        body: {
          amount: { currency_code: currency, value: centsToText(input.amountCents) },
          // false = more may be taken from this hold later
          final_capture: false,
          // PayPal refuses a second take with the same invoice number, so each take has its own
          invoice_id: input.invoiceId,
          note_to_payer: input.note.slice(0, 255),
        },
      });
      return { id: String(data.id), status: String(data.status) };
    },
    async getHold(authorizationId) {
      const data = await call("GET", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
      return { status: String(data.status), amountCents: textToCents(((data.amount as Json | undefined) ?? {}).value) ?? 0, endsAt: asDate(data.expiration_time) };
    },
    async refundPayment(input) {
      const data = await call("POST", `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`, {
        requestId: input.requestId,
        // An empty body gives all of it back; an amount gives that part back.
        body: {
          ...(input.amountCents === undefined ? {} : { amount: { currency_code: currency, value: centsToText(input.amountCents) } }),
          ...(input.note ? { note_to_payer: input.note.slice(0, 255) } : {}),
        },
      });
      return { id: String(data.id), status: String(data.status) };
    },
    async voidHold(authorizationId) {
      try {
        const data = await call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`);
        return { status: typeof data.status === "string" ? data.status : "VOIDED" };
      } catch (error) {
        // Already let go earlier: that is the result we wanted.
        if (error instanceof PayPalProblem && error.issues.some((i) => i === "PREVIOUSLY_VOIDED" || i === "AUTHORIZATION_VOIDED")) {
          return { status: "VOIDED" };
        }
        throw error;
      }
    },
    async sendPayout(input) {
      const send = () => call("POST", "/v1/payments/payouts", {
        body: {
          sender_batch_header: {
            // PayPal refuses a second payout with the same batch id, so a repeat can never pay twice
            sender_batch_id: input.batchId,
            email_subject: input.subject.slice(0, 255),
            email_message: input.note.slice(0, 1000),
          },
          items: [
            {
              recipient_type: "EMAIL",
              amount: { value: centsToText(input.amountCents), currency },
              receiver: input.email,
              note: input.note.slice(0, 1000),
              sender_item_id: input.batchId,
            },
          ],
        },
      });
      try {
        return asPayout(await send());
      } catch (error) {
        // Sent before with this batch id (tested 10 Nov: PayPal answers 400 "Batch with given
        // sender_batch_id already exists" and points at the first one). Nothing is paid twice:
        // the first payout is looked up and returned.
        const first = error instanceof PayPalProblem ? /\/v1\/payments\/payouts\/([A-Z0-9]+)/.exec(JSON.stringify(error.answer.details ?? "")) : null;
        if (first) return this.getPayout(first[1]);
        throw error;
      }
    },
    async getPayout(batchId) {
      return asPayout(await call("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`));
    },
    async verifyWebhook(input) {
      // The message is put in exactly as it arrived. Reading it and writing it
      // out again could change a character and make PayPal's check fail.
      const body =
        `{"auth_algo":${JSON.stringify(input.headers.authAlgo)},` +
        `"cert_url":${JSON.stringify(input.headers.certUrl)},` +
        `"transmission_id":${JSON.stringify(input.headers.transmissionId)},` +
        `"transmission_sig":${JSON.stringify(input.headers.transmissionSig)},` +
        `"transmission_time":${JSON.stringify(input.headers.transmissionTime)},` +
        `"webhook_id":${JSON.stringify(input.webhookId)},` +
        `"webhook_event":${input.rawBody}}`;
      const data = await call("POST", "/v1/notifications/verify-webhook-signature", { body });
      return data.verification_status === "SUCCESS";
    },
  };
}

// ---------------------------------------------------------------- which PayPal is in use

const holder = globalThis as unknown as { __dibsPayPal?: PayPal };

/** The PayPal in use: the real test-mode one, unless a test put a pretend one in. */
export function getPayPal(): PayPal {
  return holder.__dibsPayPal ?? realPayPal(settings.currency);
}

/** For tests: use a pretend PayPal. Pass null to go back to the real one. */
export function usePayPal(fake: PayPal | null): void {
  holder.__dibsPayPal = fake ?? undefined;
}

// ---------------------------------------------------------------- telling PayPal where our server is (used by the proof scripts)

/** Tells PayPal the address to call about sales, approved holds and payouts. Returns the number for PAYPAL_WEBHOOK_ID. */
export async function addWebhook(url: string): Promise<string> {
  const data = await call("POST", "/v1/notifications/webhooks", {
    body: {
      url,
      event_types: [
        { name: "PAYMENT.CAPTURE.COMPLETED" },
        { name: "CHECKOUT.ORDER.APPROVED" },
        { name: "PAYMENT.CAPTURE.REFUNDED" },
        { name: "PAYMENT.CAPTURE.REVERSED" },
        { name: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" },
        { name: "PAYMENT.PAYOUTS-ITEM.FAILED" },
        { name: "PAYMENT.PAYOUTS-ITEM.RETURNED" },
        { name: "PAYMENT.PAYOUTS-ITEM.BLOCKED" },
        { name: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED" },
      ],
    },
  });
  return String(data.id);
}

export async function listWebhooks(): Promise<{ id: string; url: string }[]> {
  const data = await call("GET", "/v1/notifications/webhooks");
  return ((data.webhooks as Json[] | undefined) ?? []).map((w) => ({ id: String(w.id), url: String(w.url) }));
}

export async function removeWebhook(id: string): Promise<void> {
  await call("DELETE", `/v1/notifications/webhooks/${encodeURIComponent(id)}`);
}

/** PayPal's address and our keys as a sign-in header, for the one call that is made as the app itself (Log in with PayPal). Never printed. */
export function appSignIn(): { base: string; header: string } {
  const id = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new PayPalProblem("The PayPal test keys are missing.", 0, ["NO_KEYS"]);
  return { base: apiBase(), header: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` };
}

/** For the proof scripts only: one raw call, so a test can do something the product never does (such as paying with PayPal's published test card). */
export const rawCallForProofs = call;
