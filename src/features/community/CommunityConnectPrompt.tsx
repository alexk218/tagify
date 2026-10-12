import React, { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { getDisconnectedSyncProvenance } from "@/services/sync/SyncLocalState";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import { isAnotherDialogOpen } from "@/utils/openDialogs";
import { dismissCommunityConnectPrompt, isCommunityConnectPromptDismissed } from "./communityConnectPromptHistory";
import styles from "./CommunityConnectPrompt.module.css";

/** Delay after other dialogs close, so the invitation never flashes between two of them. */
const SETTLE_MS = 1000;

interface CommunityConnectPromptProps {
  /** False while Tagify is loading or showing anything that should take priority. */
  enabled: boolean;
  connected: boolean;
  onConnect: () => void;
}

/** A calm, dismissible invitation to connect for people who have never used Community from Tagify. */
export function CommunityConnectPrompt({ enabled, connected, onConnect }: CommunityConnectPromptProps) {
  // Null until the Spotify account is identified, and for the session if it can't be.
  const [accountDigest, setAccountDigest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    void getUsageAccountDigest().then((digest) => {
      if (!active) return;
      setAccountDigest(digest);
      if (digest) setDismissed(isCommunityConnectPromptDismissed(digest));
    });
    return () => { active = false; };
  }, []);

  // A declined invitation can only be remembered for a known account, so wait for one.
  const eligible = enabled && !connected && Boolean(accountDigest) && !dismissed &&
    !syncPairingService.getPending() && !getDisconnectedSyncProvenance();

  useEffect(() => {
    if (!eligible) {
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
      if (!timer) timer = setTimeout(() => setVisible(true), SETTLE_MS);
    };
    // Observe only while the invitation is waiting behind another dialog.
    const observer = new MutationObserver(tryShowing);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", tryShowing);
    tryShowing();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", tryShowing);
    };
  }, [eligible, visible]);

  if (!eligible || !visible) return null;

  const notNow = () => {
    if (accountDigest) dismissCommunityConnectPrompt(accountDigest);
    setDismissed(true);
  };

  return (
    <section className={styles.prompt} aria-labelledby="community-connect-prompt-title" aria-describedby="community-connect-prompt-description">
      <span className={styles.icon} aria-hidden="true"><Users size={18} /></span>
      <div className={styles.text}>
        <h2 id="community-connect-prompt-title" className={styles.title}>Connect to Community</h2>
        <p id="community-connect-prompt-description" className={styles.description}>
          Back up your tags and share them with friends. If someone invited you, this finishes joining them.
        </p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={notNow}>Not now</button>
        <button type="button" className={styles.primary} onClick={onConnect}>Connect</button>
      </div>
    </section>
  );
}
