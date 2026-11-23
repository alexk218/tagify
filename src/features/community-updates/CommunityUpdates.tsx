import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Megaphone, Star, X } from "lucide-react";
import Portal from "@/components/ui/Portal";
import { COMMUNITY_PAGES_ORIGIN, openCommunityUrl } from "@/features/community/communityLinks";
import {
  canOfferRatingSharing,
  fetchRatingSharing,
  RATING_SHARING_COPY,
  ratingSharingErrorMessage,
  recordRatingSharingAsked,
  saveRatingSharing,
} from "@/features/community/communityRatingSharing";
import { COMMUNITY_UPDATE_INTERVAL_MS, communityUpdateService, type CommunityUpdate } from "./communityUpdateService";
import { isAnotherDialogOpen } from "@/utils/openDialogs";
import styles from "./CommunityUpdates.module.css";

const WEB_LINK = /(https:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** A notice line with its https links clickable; they open in the browser. Other text stays as written. */
export function NoticeText({ text }: { text: string }) {
  const parts = text.split(WEB_LINK);
  return <>{parts.map((part, index) => index % 2 === 1
    ? <a key={index} href={part} className={styles.link} onClick={(event) => { event.preventDefault(); openCommunityUrl(part); }}>{part}</a>
    : <React.Fragment key={index}>{part}</React.Fragment>)}</>;
}

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
      if (document.visibilityState !== "visible" || isAnotherDialogOpen()) {
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
          <ul>{update.changes.map((change, index) => <li key={index}><NoticeText text={change} /></li>)}</ul>
          {update.action === "share_ratings" ? <ShareRatingsAction /> : null}
        </article>)}
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.secondary} onClick={() => { openCommunityUrl(COMMUNITY_PAGES_ORIGIN); onClose(); }}>Open Community <ExternalLink size={15} aria-hidden="true" /></button>
        <button type="button" className={styles.primary} onClick={onClose}>Got it</button>
      </footer>
    </section>
  </div>;
}

/**
 * The notice's own "Share my ratings" button, so turning sharing on is one
 * click rather than directions to a settings page. It appears only for a
 * member with a public profile who hasn't answered, and only when Community
 * can say so; otherwise the notice reads as before.
 */
function ShareRatingsAction() {
  const [offered, setOffered] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void fetchRatingSharing().then((sharing) => {
      if (!mounted.current || !canOfferRatingSharing(sharing)) return;
      setOffered(true);
      recordRatingSharingAsked("notice");
    });
    return () => { mounted.current = false; };
  }, []);

  if (saved) {
    return <p className={styles.actionResult} role="status"><Star size={15} aria-hidden="true" /> <span>{RATING_SHARING_COPY.shared} {RATING_SHARING_COPY.changeLater}</span></p>;
  }
  if (!offered) return null;

  const share = async () => {
    setSaving(true);
    setError("");
    try {
      await saveRatingSharing(true, "notice");
      if (mounted.current) setSaved(true);
    } catch (nextError) {
      if (mounted.current) setError(ratingSharingErrorMessage(nextError));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return <div className={styles.action}>
    <button type="button" className={styles.primary} onClick={() => void share()} disabled={saving}><Star size={15} aria-hidden="true" /> {saving ? "Saving…" : RATING_SHARING_COPY.share}</button>
    {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
  </div>;
}
