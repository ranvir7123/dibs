/**
 * What Dibs does when PayPal calls our server (a "webhook": PayPal sending us
 * a message when something happens). Every message is first checked with
 * PayPal to be real; a message that fails the check changes nothing.
 *
 * Messages handled:
 * - a payment was taken on a shop order   -> the sale is counted for the worker whose code is on it
 * - a buyer approved a shop order         -> the payment is taken (in case they closed the tab early)
 * - a poster approved a job's hold        -> the hold is locked and the job opened (same reason)
 * - a payout finished or failed           -> its record is updated
 */
import { confirmHold, MoneyRefusal, recordSale, settlePayout } from "./index";
import { getPayPal, JOB_LABEL, PayPalProblem, SALE_LABEL, textToCents } from "./paypal";
import { cleanCode, finishShopOrder } from "./shop";

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === "object" && value !== null ? (value as Json) : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export interface WebhookAnswer {
  /** 200 = handled (or nothing to do). 401 = not from PayPal. 5xx = try again later; PayPal resends. */
  status: number;
  body: string;
}

export async function handlePayPalMessage(headers: Headers, rawBody: string): Promise<WebhookAnswer> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) return { status: 503, body: "PAYPAL_WEBHOOK_ID is not set, so messages cannot be checked." };

  const sent = {
    authAlgo: headers.get("paypal-auth-algo") ?? "",
    certUrl: headers.get("paypal-cert-url") ?? "",
    transmissionId: headers.get("paypal-transmission-id") ?? "",
    transmissionSig: headers.get("paypal-transmission-sig") ?? "",
    transmissionTime: headers.get("paypal-transmission-time") ?? "",
  };
  let event: Json;
  try {
    event = obj(JSON.parse(rawBody));
  } catch {
    return { status: 401, body: "Not a PayPal message." };
  }
  if (Object.values(sent).some((value) => !value)) return { status: 401, body: "Not a PayPal message: its signature is missing." };

  try {
    if (!(await getPayPal().verifyWebhook({ webhookId, headers: sent, rawBody }))) {
      return { status: 401, body: "PayPal says this message is not real." };
    }
  } catch (error) {
    // PayPal refusing the check outright (4xx) means the message is malformed; anything else is worth another try.
    if (error instanceof PayPalProblem && error.status >= 400 && error.status < 500) return { status: 401, body: "PayPal could not check this message." };
    return { status: 503, body: "Could not reach PayPal to check this message." };
  }

  const type = text(event.event_type);
  const resource = obj(event.resource);
  try {
    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      const label = text(resource.custom_id);
      if (!label.startsWith(SALE_LABEL)) return { status: 200, body: "Not a shop sale." };
      const code = cleanCode(label.slice(SALE_LABEL.length));
      const orderId = text(obj(obj(resource.supplementary_data).related_ids).order_id);
      const amountCents = textToCents(obj(resource.amount).value);
      if (!code) return { status: 200, body: "A sale with no worker's code." };
      if (!orderId || amountCents === null) return { status: 200, body: "A sale message without its order or amount." };
      const sale = await recordSale({ paypalOrderId: orderId, linkCode: code, amountCents });
      return { status: 200, body: `Sale ${sale.id} counted.` };
    }
    if (type === "CHECKOUT.ORDER.APPROVED") {
      const label = text(obj((resource.purchase_units as unknown[] | undefined)?.[0]).custom_id);
      if (label.startsWith(JOB_LABEL)) {
        await confirmHold(label.slice(JOB_LABEL.length));
        return { status: 200, body: "Hold locked." };
      }
      if (label.startsWith(SALE_LABEL)) {
        await finishShopOrder(text(resource.id));
        return { status: 200, body: "Shop order finished." };
      }
      return { status: 200, body: "Not a Dibs order." };
    }
    if (type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
      const moveId = text(obj(resource.payout_item).sender_item_id);
      const move = moveId ? await settlePayout(moveId) : null;
      return { status: 200, body: move ? `Payout ${move.status}.` : "No payout waiting for this." };
    }
    return { status: 200, body: "Nothing to do for this kind of message." };
  } catch (error) {
    // A plain refusal (unknown code, job not open, order does not match): sending it again would not help.
    if (error instanceof MoneyRefusal) return { status: 200, body: `Not acted on: ${error.message}` };
    // Anything else (PayPal or the database had trouble): ask PayPal to send the message again later.
    console.error("PayPal message not handled:", error instanceof PayPalProblem ? error.message : "a fault on our side");
    return { status: 503, body: "Trouble while handling this. Send it again." };
  }
}
