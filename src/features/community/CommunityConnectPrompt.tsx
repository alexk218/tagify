import React, { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { startupRecoverySettled } from "@/services/sync/SyncInstallRecovery";
import { getDisconnectedSyncProvenance, hasCommunityLibraryOnThisComputer } from "@/services/sync/SyncLocalState";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import { isAnotherDialogOpen } from "@/utils/openDialogs";
import {
  dismissCommunityConnectPrompt,
  isCommunityConnectPromptDismissed,
  isCommunityReconnectPromptSnoozed,
  snoozeCommunityReconnectPrompt,
} from "./communityConnectPromptHistory";
import { recordCommunityConnectPromptDismissed, recordCommunityConnectPromptShown } from "./communityConnectAnalytics";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the publish invitation
import styles from "./CommunityConnectPrompt.module.css";

/** Delay after other dialogs close, so the invitation never flashes between two of them. */
const SETTLE_MS = 1000;

type PromptKind = "connect" | "reconnect";

const COPY: Record<PromptKind, { title: string; description: string; action: string }> = {
  connect: {
    title: "Back up your tags and use them on your phone",
    description: "Everything you've tagged here comes with you. Nothing is public unless you choose.",
    action: "Create account or sign in",
  },
  reconnect: {
    title: "Reconnect this computer",
    description: "Tagify on this computer lost its connection to your Tagify account, so your tags aren't being backed up. Reconnect to pick up where you left off.",
    action: "Reconnect",
  },
};

interface CommunityConnectPromptProps {
  /** False while Tagify is loading or showing anything that should take priority. */
  enabled: boolean;
  connected: boolean;
  onConnect: () => void;
}

/**
 * A calm invitation to connect for people who have never used Community from Tagify, or a
 * reminder to reconnect when this computer lost a connection it used to have.
 */
export function CommunityConnectPrompt({ enabled, connected, onConnect }: CommunityConnectPromptProps) {
  // Null until the Spotify account is identified, and for the session if it can't be.
  const [accountDigest, setAccountDigest] = useState<string | null>(null);
  // Null until launch-time reconnection has finished, so a restored connection never sees the card.
  const [kind, setKind] = useState<PromptKind | null>(null);
  const [hidden, setHidden] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [digest] = await Promise.all([getUsageAccountDigest(), startupRecoverySettled()]);
      const nextKind: PromptKind = (await hasCommunityLibraryOnThisComputer()) ? "reconnect" : "connect";
      if (!active) return;
      setAccountDigest(digest);
      setKind(nextKind);
      if (digest) {
        setHidden(nextKind === "reconnect"
          ? isCommunityReconnectPromptSnoozed(digest)
          : isCommunityConnectPromptDismissed(digest));
      }
    })();
    return () => { active = false; };
  }, []);

  // A declined invitation can only be remembered for a known account, so wait for one.
  const eligible = enabled && !connected && Boolean(accountDigest) && kind !== null && !hidden &&
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

  const shown = eligible && visible;
  // These measure the invitation to new members; the reconnect reminder is a different question.
  useEffect(() => {
    if (shown && kind === "connect" && accountDigest) recordCommunityConnectPromptShown(accountDigest);
  }, [shown, kind, accountDigest]);

  if (!shown || !kind) return null;

  const notNow = () => {
    if (kind === "reconnect") {
      if (accountDigest) snoozeCommunityReconnectPrompt(accountDigest);
    } else {
      if (accountDigest) dismissCommunityConnectPrompt(accountDigest);
      recordCommunityConnectPromptDismissed();
    }
    setHidden(true);
  };
  const copy = COPY[kind];

  return (
    <section className={`${styles.prompt} ${styles.connect}`} aria-labelledby="community-connect-prompt-title" aria-describedby="community-connect-prompt-description">
      <span className={styles.icon} aria-hidden="true"><Users size={18} /></span>
      <div className={styles.text}>
        <h2 id="community-connect-prompt-title" className={styles.title}>{copy.title}</h2>
        <p id="community-connect-prompt-description" className={styles.description}>{copy.description}</p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={notNow}>Not now</button>
        <button type="button" className={styles.primary} onClick={onConnect}>{copy.action}</button>
      </div>
    </section>
  );
}
