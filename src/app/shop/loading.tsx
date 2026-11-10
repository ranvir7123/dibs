// Shown while the shop page is being put together. Lane A.
import styles from "./shop.module.css";

export default function ShopLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Loading the shop">
      <header className={styles.top}>
        <span className={styles.ghostBlock} style={{ width: 180, height: 32 }} />
        <span className={styles.ghostBlock} style={{ width: 170, height: 30, borderRadius: 999 }} />
      </header>
      <section className={styles.card}>
        <div className={styles.ghostBlock} style={{ minHeight: 220, borderRadius: 0 }} />
        <div className={styles.body}>
          <span className={styles.ghostBlock} style={{ width: "70%", height: 30 }} />
          <span className={styles.ghostBlock} style={{ width: "100%", height: 44 }} />
          <span className={styles.ghostBlock} style={{ width: 120, height: 36 }} />
          <span className={styles.ghostBlock} style={{ width: "100%", height: 48, borderRadius: 999, marginTop: "auto" }} />
        </div>
      </section>
    </main>
  );
}
