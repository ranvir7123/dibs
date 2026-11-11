/**
 * The icons from the approved drawing, plus a few in the same style for the
 * screens the drawing does not show. IconSprite is put on the page once (in
 * the root layout); Icon then points at one of its shapes by name.
 */

export type IconName =
  | "home" | "jobs" | "plus" | "list" | "wallet" | "people" | "gear" | "eye" | "heart" | "chat" | "share" | "tap"
  | "ok" | "no" | "warn" | "shield" | "clock" | "down" | "up" | "play" | "flag" | "lock" | "spark"
  | "link" | "upload" | "copy" | "back" | "right" | "user" | "file" | "tick";

export function Icon({ name, fill = false }: { name: IconName; fill?: boolean }) {
  return (
    <svg className={fill ? "i f" : "i"} aria-hidden="true" focusable="false">
      <use href={`#${name}`} />
    </svg>
  );
}

export function IconSprite() {
  return (
    <svg className="icons" width="0" height="0" aria-hidden="true">
      <defs>
        {/* from the drawing */}
        <symbol id="home" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" /></symbol>
        <symbol id="jobs" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></symbol>
        <symbol id="plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
        <symbol id="list" viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></symbol>
        <symbol id="wallet" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12.5h2M3 10h18" /></symbol>
        <symbol id="people" viewBox="0 0 24 24"><circle cx="9" cy="9" r="3" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M16 6.5a3 3 0 0 1 0 5.5M21 19c0-2.3-1.4-4-3.5-4.7" /></symbol>
        <symbol id="gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></symbol>
        <symbol id="eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></symbol>
        <symbol id="heart" viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" /></symbol>
        <symbol id="chat" viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H6a2 2 0 0 1-2-2z" /></symbol>
        <symbol id="share" viewBox="0 0 24 24"><path d="M13 5l7 6-7 6v-4c-5 0-8 1.500-10 5 0-6 3-10 10-10.500z" /></symbol>
        <symbol id="tap" viewBox="0 0 24 24"><path d="M9 11V5.500a1.500 1.500 0 0 1 3 0V11l5 1.200a2 2 0 0 1 1.500 2.300l-.8 4a2 2 0 0 1-2 1.500h-4.500a2 2 0 0 1-1.600-.8L6 15l1-1a1.500 1.500 0 0 1 2 0z" /></symbol>
        <symbol id="ok" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8 12.500l2.800 2.800L16 9.800" /></symbol>
        <symbol id="no" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></symbol>
        <symbol id="warn" viewBox="0 0 24 24"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></symbol>
        <symbol id="shield" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.500-3.200 7.800-8 9-4.800-1.200-8-4.500-8-9V6z" /><path d="M8.500 12l2.500 2.500 4.500-5" /></symbol>
        <symbol id="clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></symbol>
        <symbol id="down" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></symbol>
        <symbol id="up" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></symbol>
        <symbol id="play" viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></symbol>
        <symbol id="flag" viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></symbol>
        <symbol id="lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></symbol>
        <symbol id="spark" viewBox="0 0 24 24"><path d="M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800z" /></symbol>
        {/* added by lane C, same line weight and corners */}
        <symbol id="link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></symbol>
        <symbol id="upload" viewBox="0 0 24 24"><path d="M12 16V5M7 10l5-5 5 5M5 19h14" /></symbol>
        <symbol id="copy" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></symbol>
        <symbol id="back" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></symbol>
        <symbol id="right" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></symbol>
        <symbol id="user" viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.500" /><path d="M5 20c0-3.500 3-6 7-6s7 2.500 7 6" /></symbol>
        <symbol id="file" viewBox="0 0 24 24"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /></symbol>
        <symbol id="tick" viewBox="0 0 24 24"><path d="M5 12.500l4.500 4.500L19 7.500" /></symbol>
      </defs>
    </svg>
  );
}
