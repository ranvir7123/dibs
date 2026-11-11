/**
 * The states every screen needs besides "here is the data": nothing here yet,
 * still loading, and a message in plain words.
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** Nothing here yet, with one thing to do next. */
export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="ic">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

/** A short message. "warn" for not ready yet, "stop" for went wrong, "ok" for good news. */
export function Notice({ kind = "info", title, children }: { kind?: "info" | "warn" | "stop" | "ok"; title?: string; children: ReactNode }) {
  const icon: IconName = kind === "ok" ? "ok" : kind === "info" ? "clock" : "warn";
  return (
    <div className={kind === "info" ? "notice" : `notice ${kind}`} role={kind === "stop" ? "alert" : "status"}>
      <Icon name={icon} />
      <p>
        {title ? <b>{title}</b> : null}
        {children}
      </p>
    </div>
  );
}

/** A grey block the size of the thing that is loading. */
export function Sk({ w, h, round = false }: { w: number | string; h?: number; round?: boolean }) {
  return <span className={round ? "sk round" : "sk"} style={{ width: w, height: h ?? 14 }} />;
}

/** The board while it loads: the heading, the tabs and six job cards, as grey blocks. */
export function BoardSkeleton() {
  return (
    <div aria-busy="true">
      <p className="hide" role="status">
        Loading
      </p>
      <div className="hero" aria-hidden="true">
        <div>
          <Sk w="min(460px, 90%)" h={52} />
          <div style={{ marginTop: 16 }}>
            <Sk w="min(520px, 100%)" h={20} />
          </div>
        </div>
        <div className="nums">
          <Sk w={204} h={126} />
          <Sk w={204} h={126} />
        </div>
      </div>
      <div className="board-top" aria-hidden="true">
        <Sk w="min(560px, 100%)" h={48} round />
        <Sk w={120} h={32} round />
      </div>
      <div className="jobs" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div className="job" key={n}>
            <div className="job-top">
              <Sk w={40} h={40} round />
              <Sk w="45%" h={20} />
            </div>
            <Sk w="85%" h={28} />
            <Sk w="100%" h={148} />
            <Sk w="100%" h={8} round />
            <Sk w="100%" h={48} round />
          </div>
        ))}
      </div>
    </div>
  );
}
