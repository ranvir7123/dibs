// /shop?ref=<code>: the small shop Dibs hosts for the sales demo. One
// product, paid with PayPal. "ref" is the worker's tracked link code; it is
// put on the PayPal order so PayPal itself proves who brought the sale. Lane A.
import type { Metadata } from "next";
import { formatCents } from "@/contract/money";
import { cleanCode, shopItem, whoseCode } from "@/money/shop";
import styles from "./shop.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${shopItem.name} | ${shopItem.shopName}` };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ShopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const typed = first(params.ref)?.trim() || null;
  const code = cleanCode(typed);
  const paid = first(params.paid);
  const owner = await whoseCode(code);
  // Only a code that belongs to an open job is put on the order.
  const codeToSend = owner?.jobOpen ? owner.code : null;

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <span className={styles.shopName}>{shopItem.shopName}</span>
        <span className={`pill held ${styles.test}`}>Test mode: pretend money</span>
      </header>

      <section className={styles.card}>
        <div className={styles.picture} role="img" aria-label={shopItem.name}>
          <span className={styles.pictureTag}>Made by hand</span>
        </div>

        <div className={styles.body}>
          <div>
            <h1 className={styles.name}>{shopItem.name}</h1>
          </div>
          <p className={styles.blurb}>{shopItem.blurb}</p>
          <div>
            <div className={styles.price}>{formatCents(shopItem.priceCents)}</div>
            <p className={styles.priceNote}>One scarf. Nothing is posted: this is a demo shop.</p>
          </div>

          {owner?.jobOpen && (
            <p className={styles.from}>
              <i className={styles.dot} aria-hidden="true" />
              <span>
                You came here through <strong>{owner.workerName}</strong>&rsquo;s link. If you buy, PayPal tells Dibs and they earn from this sale.
              </span>
            </p>
          )}
          {owner && !owner.jobOpen && (
            <p className={styles.from}>
              <i className={`${styles.dot} ${styles.warn}`} aria-hidden="true" />
              <span>
                This link is from <strong>{owner.workerName}</strong>, but their job has ended. You can still buy; nobody earns from it.
              </span>
            </p>
          )}
          {typed && !owner && (
            <p className={styles.from}>
              <i className={`${styles.dot} ${styles.warn}`} aria-hidden="true" />
              <span>The link you followed is not one we know. You can still buy; nobody earns from it.</span>
            </p>
          )}

          {paid === "cancelled" && <p className={`${styles.notice} ${styles.wait}`}>You left PayPal before paying. Nothing was taken.</p>}
          {paid === "failed" && <p className={`${styles.notice} ${styles.stop}`}>PayPal could not take the payment, so nothing was taken. Please try again.</p>}

          <form className={styles.pay} action="/api/paypal/shop/start" method="post">
            {codeToSend && <input type="hidden" name="ref" value={codeToSend} />}
            <button className={`btn main-b ${styles.payBtn}`} type="submit">
              Pay {formatCents(shopItem.priceCents)} with PayPal
            </button>
            <p className={styles.small}>You pay on PayPal&rsquo;s own page with a PayPal test account, then come back here.</p>
          </form>
        </div>
      </section>
    </main>
  );
}
