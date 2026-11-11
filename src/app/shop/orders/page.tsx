// /shop/orders: the shop owner's orders. Every sale that came through a
// worker's link, where it stands for commission, and a Refund button.
// The owner is whoever is using this browser (the dibs_person cookie) and
// posted the sales job. Lane A.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { formatCents } from "@/contract/money";
import type { ShopOrder } from "@/contract/types";
import { getShopOrders } from "@/money";
import { shopItem } from "@/money/shop";
import { settings } from "@/settings";
import { dayMonth, timeOfDay } from "@/ui/format";
import RefundButton from "@/ui/RefundButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Orders | ${shopItem.shopName}` };

/** Where the sale stands, in plain words. */
function standing(order: ShopOrder, now: Date): { text: string; pill: string } {
  if (order.state === "refunded") return { text: "Refunded, not counted", pill: "stop" };
  if (order.state === "waiting") {
    const minutes = Math.max(1, Math.ceil((order.countsAt.getTime() - now.getTime()) / 60_000));
    return { text: `Counts in ${minutes} min, unless refunded`, pill: "soon" };
  }
  if (order.state === "part_refunded") return { text: `Part refunded, counted. Kept ${formatCents(order.keptCents)}`, pill: "paid" };
  return { text: "Counted", pill: "paid" };
}

export default async function ShopOrdersPage() {
  const viewerId = (await cookies()).get("dibs_person")?.value ?? null;
  const orders = viewerId ? await getShopOrders(viewerId) : [];
  const now = new Date();

  return (
    <main className="content">
      <div className="head">
        <div>
          <span className="eyebrow">{shopItem.shopName}</span>
          <h1>Orders</h1>
          <p>
            Every sale that came through a worker&rsquo;s link. A sale counts for commission {settings.saleRefundWaitMinutes} minutes after it is paid. Refund it and it is not counted, and no commission is paid for it.
          </p>
        </div>
        <span className="pill held">Test mode: pretend money</span>
      </div>

      {!viewerId ? (
        <div className="empty">
          <h3>Choose who you are first</h3>
          <p>Orders are shown to the business that posted the sales job. Join or switch person on Dibs, then come back.</p>
          <Link className="btn main-b" href="/">
            Go to Dibs
          </Link>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty">
          <h3>No orders yet</h3>
          <p>When someone buys through a worker&rsquo;s link, the order shows here with PayPal&rsquo;s reference.</p>
          <Link className="btn ghost" href="/shop">
            Open the shop
          </Link>
        </div>
      ) : (
        <div className="panel rows">
          {orders.map((order) => {
            const state = standing(order, now);
            return (
              <div key={order.sale.id} style={{ flexWrap: "wrap" }}>
                <span className="grow" style={{ flex: "1 1 260px" }}>
                  <b style={{ overflowWrap: "anywhere" }}>
                    {formatCents(order.sale.amountCents)} through {order.workerName}&rsquo;s link
                  </b>
                  <span className="num" style={{ overflowWrap: "anywhere" }}>
                    {dayMonth(order.sale.at)}, {timeOfDay(order.sale.at)}. PayPal order {order.sale.paypalOrderId}
                    {order.sale.paypalCaptureId ? `. PayPal reference ${order.sale.paypalCaptureId}` : ""}
                  </span>
                </span>
                {order.keptCents > 0 ? <span className={`pill ${state.pill}`}>{state.text}</span> : null}
                {/* A sample row was never a real PayPal payment, so there is nothing to give back. */}
                {order.sale.paypalOrderId.startsWith("SAMPLE") ? <span className="sub">Sample order</span> : <RefundButton paypalOrderId={order.sale.paypalOrderId} keptCents={order.keptCents} />}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
