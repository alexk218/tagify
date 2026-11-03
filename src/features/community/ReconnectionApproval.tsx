import React, { useEffect, useState } from "react";
import { ExternalLink, Link2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  askToReconnectAgain,
  getReconnectionState,
  RECONNECTION_EVENT,
  type ReconnectionState,
} from "@/services/sync/SyncInstallRecovery";
import { openCommunityUrl } from "./communityLinks";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the Cloud Sync dialog
import styles from "./CloudSyncModal.module.css";

/** The reconnection waiting for the member's approval on Community, kept current. */
export function useReconnectionState(): ReconnectionState | null {
  const [state, setState] = useState(getReconnectionState);
  useEffect(() => {
    const update = () => setState(getReconnectionState());
    window.addEventListener(RECONNECTION_EVENT, update);
    update();
    return () => window.removeEventListener(RECONNECTION_EVENT, update);
  }, []);
  return state;
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Cloud Sync's view of a reconnection: the code to check while approving on
 * Community, or how the request ended and what to do next.
 */
export function ReconnectionPanel({ state, busy, onLinkWithNewCode }: {
  state: ReconnectionState;
  busy: boolean;
  onLinkWithNewCode: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const askAgain = async () => {
    setAsking(true);
    await askToReconnectAgain();
    setAsking(false);
  };
  const linkButton = <button type="button" className={styles.secondary} disabled={busy} onClick={onLinkWithNewCode}><Link2 size={15} /> Link with a new code</button>;

  if (state.status === "waiting") {
    return <>
      <div className={styles.reconnectRequired}><ShieldCheck /><div><strong>Approve reconnecting this computer</strong><span>A Spotify update signed Tagify out of Community</span></div></div>
      <div className={styles.code}><span>Check that Community shows this code</span><strong>{state.userCode}</strong></div>
      <p>Approve on Tagify Community while you're signed in there. Tagify reconnects by itself as soon as you do. This request expires at {formatTime(state.expiresAt)}.</p>
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => openCommunityUrl(state.approvalUrl)}><ExternalLink size={15} /> Open approval page</button></div>
    </>;
  }

  const ended = {
    declined: {
      title: "Reconnecting wasn't approved",
      text: "Community turned this request down. If you chose “This wasn't me” by mistake, ask again. Your library stays on this computer either way.",
    },
    expired: {
      title: "The request expired",
      text: "Nobody approved it within 10 minutes. Ask again, and approve it on Community while Tagify is open.",
    },
    "rate-limited": {
      title: "Too many requests for now",
      text: state.status === "rate-limited"
        ? `You can ask again after ${formatTime(state.retryAt)}, or link this computer with a new code now.`
        : "",
    },
    unavailable: {
      title: "Couldn't reconnect automatically",
      text: "Link this computer with a new code from Community instead. Your library stays on this computer.",
    },
  }[state.status];
  const canAskAgain = state.status === "declined" || state.status === "expired";

  return <>
    <div className={styles.warning} role="status"><ShieldAlert /><span><strong>{ended.title}.</strong> {ended.text}</span></div>
    <div className={styles.actions}>
      {canAskAgain ? <button type="button" className={styles.primary} disabled={asking || busy} onClick={() => void askAgain()}><RefreshCw size={15} /> {asking ? "Asking…" : "Ask again"}</button> : null}
      {linkButton}
    </div>
  </>;
}

