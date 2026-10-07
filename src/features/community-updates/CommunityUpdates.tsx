import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Megaphone, X } from "lucide-react";
import Portal from "@/components/ui/Portal";
import { COMMUNITY_ORIGIN, openCommunityUrl } from "@/features/community/communityLinks";
import { COMMUNITY_UPDATE_INTERVAL_MS, communityUpdateService, type CommunityUpdate } from "./communityUpdateService";
import styles from "./CommunityUpdates.module.css";

export function CommunityUpdates({ enabled }: { enabled: boolean }) {
  const [updates, setUpdates] = useState<CommunityUpdate[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const next = await communityUpdateService.check();
      if (active) setUpdates(next);
    };
    const startup = setTimeout(() => void check(), 3000);
    const interval = setInterval(() => void check(), COMMUNITY_UPDATE_INTERVAL_MS);
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      clearTimeout(startup);
      clearInterval(interval);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  useEffect(() => {
    if (!enabled || updates.length === 0) {
      setVisible(false);
      return;
    }
    if (visible) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryShowing = () => {
      const otherDialog = document.querySelector('[role="dialog"], [aria-modal="true"], .GenericModal, .tagify-portal > *');
      if (document.visibilityState !== "visible" || otherDialog) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (!timer) timer = setTimeout(() => setVisible(true), 1000);
    };
    // Observe only while a notice is waiting behind another dialog.
    const observer = new MutationObserver(tryShowing);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", tryShowing);
    tryShowing();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", tryShowing);
    };
  }, [enabled, updates, visible]);

  const dismiss = useCallback(() => {
    communityUpdateService.dismiss(updates);
    setUpdates([]);
    setVisible(false);
  }, [updates]);

  return enabled && visible && updates.length > 0
    ? <Portal><CommunityUpdateDialog updates={updates} onClose={dismiss} /></Portal>
    : null;
}

function CommunityUpdateDialog({ updates, onClose }: { updates: CommunityUpdate[]; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    if (event.key !== "Tab") return;
    const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons?.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <div className={styles.overlay} onClick={onClose}>
    <section ref={dialog} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="community-updates-title" aria-describedby="community-updates-intro" onClick={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
      <header className={styles.header}>
        <div className={styles.heading}><Megaphone size={22} aria-hidden="true" /><div><p>Community website</p><h2 id="community-updates-title">What's new in Community</h2></div></div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close Community updates"><X size={20} /></button>
      </header>
      <div className={styles.body}>
        <p id="community-updates-intro" className={styles.intro}>Here are the latest changes you can use on Community.</p>
        {updates.map((update) => <article className={styles.release} key={update.revision}>
          <time dateTime={update.publishedAt}>{new Date(update.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</time>
          <h3>{update.title}</h3>
          <ul>{update.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
        </article>)}
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.secondary} onClick={() => { openCommunityUrl(COMMUNITY_ORIGIN); onClose(); }}>Open Community <ExternalLink size={15} aria-hidden="true" /></button>
        <button type="button" className={styles.primary} onClick={onClose}>Got it</button>
      </footer>
    </section>
  </div>;
}
