// /shop/thanks?order=<PayPal order>: shown after a buyer paid. What it shows
// is read again from PayPal and from the stored sale, never taken from the
// address alone. Lane A.
import type { Metadata } from "next";
import Link from "next/link";
import { formatCents } from "@/contract/money";
import { finishShopOrder, shopItem, type ShopOutcome } from "@/money/shop";
import styles from "../shop.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Thank you | ${shopItem.shopName}` };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ThanksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const orderId = first((await searchParams).order)?.trim() ?? "";
  let outcome: ShopOutcome | null = null;
  if (/^[A-Z0-9]{6,40}$/.test(orderId)) {
    // Safe to run again: the payment is taken once and the sale stored once.
    outcome = await finishShopOrder(orderId).catch(() => null);
  }
  const back = outcome?.code ? `/shop?ref=${encodeURIComponent(outcome.code)}` : "/shop";

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <span className={styles.shopName}>{shopItem.shopName}</span>
        <span className={`pill held ${styles.test}`}>Test mode: pretend money</span>
      </header>

      {!outcome?.paid ? (
        <section className={styles.done}>
          <h1 className={styles.doneTitle}>We could not find that payment</h1>
          <p className={styles.blurb}>PayPal has no finished payment under this number, so nothing was taken.</p>
          <div>
            <Link className="btn ghost" href={back}>
              Back to the shop
            </Link>
          </div>
        </section>
      ) : (
        <section className={styles.done}>
          <div>
            <span className="pill paid">Paid</span>
          </div>
          <h1 className={styles.doneTitle}>Thank you. PayPal took your payment.</h1>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>You bought</dt>
              <dd>{shopItem.name}</dd>
            </div>
            <div className={styles.row}>
              <dt>You paid</dt>
              <dd>{formatCents(outcome.amountCents ?? shopItem.priceCents)}</dd>
            </div>
            <div className={styles.row}>
              <dt>PayPal reference</dt>
              <dd>{outcome.paypalRef}</dd>
            </div>
          </dl>
          {outcome.creditedTo && (
            <p className={styles.from}>
              <i className={styles.dot} aria-hidden="true" />
              <span>
                This sale was counted for <strong>{outcome.creditedTo}</strong>. Their code was on the PayPal order, so nobody had to approve it.
              </span>
            </p>
          )}
          {!outcome.creditedTo && outcome.notCountedBecause && (
            <p className={styles.from}>
              <i className={`${styles.dot} ${styles.warn}`} aria-hidden="true" />
              <span>{outcome.notCountedBecause}</span>
            </p>
          )}
          <div>
            <Link className="btn ghost" href={back}>
              Back to the shop
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
