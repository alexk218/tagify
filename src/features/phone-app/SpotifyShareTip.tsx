import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import Portal from "@/components/ui/Portal";
import { IPHONE_APP_QR } from "./phoneAppLinks";
import { PhoneAppQr } from "./PhoneAppPanel";
import { PHONE_TAGGING_STEPS } from "./phoneTaggingSteps";
import styles from "./SpotifyShareTip.module.css";

/** One-time popup showing how to tag Spotify songs from the iPhone share sheet. */
interface SpotifyShareTipProps {
  /** Whether this computer is connected to a Tagify account, which the iPhone app signs in with. */
  connected: boolean;
  onConnect: () => void;
  onGetApp: () => void;
  onClose: () => void;
}

export function SpotifyShareTip({ connected, onConnect, onGetApp, onClose }: SpotifyShareTipProps) {
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>(`.${styles.primary}`)?.focus();
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

  return (
    <Portal>
      <div className={styles.overlay} onClick={onClose}>
        <section
          ref={dialog}
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="spotify-share-tip-title"
          aria-describedby="spotify-share-tip-description"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <header className={styles.header}>
            <div>
              <h2 id="spotify-share-tip-title" className={styles.title}>Tag Spotify songs from your phone</h2>
              <p id="spotify-share-tip-description" className={styles.description}>
                {connected
                  ? "Playing something on Spotify on your iPhone? Tag it in a few taps. Use the same Tagify account and your tags show up here too."
                  : "Playing something on Spotify on your iPhone? Tag it in a few taps. The iPhone app works with your Tagify account, so connect this computer first and your tags show up here too."}
              </p>
            </div>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close"><X size={20} /></button>
          </header>
          <ol className={styles.steps}>
            {PHONE_TAGGING_STEPS.map(({ image, caption, alt }, index) => (
              <li key={caption} className={styles.step}>
                <img src={image} alt={alt} className={styles.shot} width={180} height={391} />
                <span className={styles.caption}><span className={styles.number}>{index + 1}.</span> {caption}</span>
              </li>
            ))}
          </ol>
          <footer className={styles.footer}>
            <div className={styles.getApp}>
              <PhoneAppQr code={IPHONE_APP_QR} label="QR code for Tagify on the App Store" size={64} />
              <p className={styles.hint}>No Tagify on your iPhone yet? Point your camera at the code.</p>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onGetApp}>Open the App Store page</button>
              {connected ? (
                <button type="button" className={styles.primary} onClick={onClose}>Got it</button>
              ) : (
                <>
                  <button type="button" className={styles.secondary} onClick={onClose}>Not now</button>
                  <button type="button" className={styles.primary} onClick={onConnect}>Connect this computer</button>
                </>
              )}
            </div>
          </footer>
        </section>
      </div>
    </Portal>
  );
}
