"use client";
// Shown when the shop page breaks (for example the database cannot be reached). Lane A.
import styles from "./shop.module.css";

export default function ShopError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className={styles.page}>
      <section className={styles.done}>
        <h1 className={styles.doneTitle}>The shop could not open</h1>
        <p className={styles.blurb}>Something went wrong on our side. Nothing was taken from you.</p>
        <div>
          <button className="btn main-b" type="button" onClick={() => retry()}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
