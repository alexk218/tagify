import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { openCommunityUrlSignedIn } from "../communityWebsiteLink";
import {
  fetchNotifications,
  markNotificationsRead,
  notificationTime,
  notificationUrl,
  unreadLabel,
  type CommunityNotification,
} from "./communityNotifications";
import styles from "./NotificationBell.module.css";

/** How often the count is checked while Tagify is on screen. Opening the bell always reads again. */
const REFRESH_MS = 10 * 60_000;
/** Coming back to Spotify checks again, at most this often. */
const FOCUS_REFRESH_MS = 60_000;
const NOT_LOADED = "Notifications aren't loading right now. Try again in a moment.";

export function NotificationBell() {
  // Shown once Community has answered: older Community versions don't serve the bell's list.
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<CommunityNotification[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Entries that were new when this opening showed them keep the new look until the list closes.
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set());
  const [openedAt, setOpenedAt] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const isOpen = useRef(false);
  const lastCheck = useRef(0);

  const refreshCount = useCallback(async () => {
    lastCheck.current = Date.now();
    try {
      const page = await fetchNotifications();
      setAvailable(true);
      if (!isOpen.current) setUnread(page.unread);
    } catch {
      // Offline or signed out: the bell keeps what it showed.
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshCount();
    }, REFRESH_MS);
    const onFocus = () => {
      if (Date.now() - lastCheck.current >= FOCUS_REFRESH_MS) void refreshCount();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  /** Showing entries in the open list counts as reading them, as on the website. */
  const markShown = useCallback((shown: CommunityNotification[]) => {
    const ids = shown.filter((item) => !item.read).map((item) => item.id);
    if (!ids.length) return;
    setFresh((current) => new Set([...current, ...ids]));
    setItems((current) => current.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item)));
    markNotificationsRead(ids).then(
      (left) => { if (left !== null) setUnread(left); },
      // They stay new, so the count comes back and the next opening tries again.
      () => setItems((current) => current.map((item) => (ids.includes(item.id) ? { ...item, read: false } : item))),
    );
  }, []);

  const close = useCallback((returnFocus = false) => {
    isOpen.current = false;
    setOpen(false);
    setFresh(new Set());
    if (returnFocus) bell.current?.focus();
  }, []);

  const show = async () => {
    isOpen.current = true;
    setOpen(true);
    setOpenedAt(Date.now());
    setError("");
    setLoading(true);
    try {
      const page = await fetchNotifications();
      if (!isOpen.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setUnread(page.unread);
      markShown(page.items);
    } catch {
      if (isOpen.current) setError(NOT_LOADED);
    } finally {
      setLoading(false);
    }
  };

  const older = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await fetchNotifications(cursor);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
      if (isOpen.current) markShown(page.items);
    } catch {
      setError(NOT_LOADED);
    } finally {
      setLoading(false);
    }
  };

  // A click anywhere else closes the list, as Tagify's other menus do.
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open, close]);

  if (!available) return null;
  const label = unread > 0 ? `Notifications, ${unread} new` : "Notifications";
  return (
    <div
      ref={wrapper}
      className={styles.wrapper}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) close(true);
      }}
    >
      <button
        ref={bell}
        type="button"
        className={`${styles.bell} ${open ? styles.bellOpen : ""}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => (open ? close() : void show())}
      >
        <Bell size={15} aria-hidden="true" />
        {unread > 0 ? <span className={styles.count} aria-hidden="true">{unreadLabel(unread)}</span> : null}
      </button>
      {open && (
        <div className={styles.menu} role="dialog" aria-label="Notifications">
          <h2 className={styles.heading}>Notifications</h2>
          {error && <p className={styles.message} role="alert">{error}</p>}
          {!error && loading && !items.length && <p className={styles.message}>Loading…</p>}
          {!error && !loading && !items.length && <p className={styles.message}>No notifications yet.</p>}
          {items.length > 0 && (
            <ul className={styles.list}>
              {items.map((item) => {
                const when = notificationTime(item.createdAt, openedAt);
                const isNew = !item.read || fresh.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`${styles.entry} ${isNew ? styles.entryNew : ""}`}
                      title="Opens on tagify.fm"
                      onClick={() => {
                        close();
                        void openCommunityUrlSignedIn(notificationUrl(item.open));
                      }}
                    >
                      <span className={styles.text}>{item.text}</span>
                      {when && <time className={styles.time} dateTime={item.createdAt} title={when.full}>{when.short}</time>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {cursor && !error && (
            <button type="button" className={styles.older} onClick={() => void older()} disabled={loading}>
              Older notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}
