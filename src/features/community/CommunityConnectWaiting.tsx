import React from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { openCommunityUrl } from "./communityLinks";
import { communityPairing, type CommunityPairingState } from "./communityPairing";
import styles from "./CommunityConnectWaiting.module.css";

interface CommunityConnectWaitingProps {
  pairing: CommunityPairingState;
  heading?: string;
  /** What connecting is for, when the way in needs saying. */
  description?: string;
  onCancel: () => void;
}

/**
 * While Community waits for the member to approve this computer in the browser: what to do there,
 * the code, and that Tagify finishes by itself.
 */
export function CommunityConnectWaiting({ pairing, heading = "Finish in your browser", description, onCancel }: CommunityConnectWaitingProps) {
  const { pending, starting, error } = pairing;
  const failedToStart = !pending && !starting && Boolean(error);
  const entry = pairing.entry ?? "community";

  return (
    <div className={styles.waiting}>
      <div className={styles.main}>
        <h3 className={styles.heading}>{heading}</h3>
        {description ? <p className={styles.description}>{description}</p> : null}
        <ol className={styles.steps}>
          <li><span className={styles.number} aria-hidden="true">1</span>Sign in or create your free Community account</li>
          <li><span className={styles.number} aria-hidden="true">2</span>Press Connect on the page that opened</li>
        </ol>
        {failedToStart ? (
          <p className={styles.error} role="alert">{error}</p>
        ) : (
          <p className={styles.status} role="status">
            <Loader2 size={14} className={styles.spinner} aria-hidden="true" />
            {starting && !pending ? "Opening Community in your browser…" : "Waiting for you to approve…"}
          </p>
        )}
        {error && !failedToStart ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <div className={styles.side}>
        <div className={styles.code}>
          <span>Your code</span>
          <strong>{pending?.userCode ?? "····-····"}</strong>
        </div>
        <div className={styles.actions}>
          {failedToStart ? (
            <button type="button" className={styles.primary} onClick={() => void communityPairing.start(entry)}>Try again</button>
          ) : (
            <button type="button" className={styles.primary} disabled={!pending} onClick={() => pending && openCommunityUrl(pending.verificationUri)}>
              <ExternalLink size={14} aria-hidden="true" /> Open the page again
            </button>
          )}
          <button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button>
        </div>
      </div>
      <p className={styles.note}>You can close this window. Tagify finishes connecting as soon as you approve.</p>
    </div>
  );
}
