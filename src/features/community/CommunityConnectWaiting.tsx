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
  /** What to do on the page; defaults to the email steps. */
  steps?: string[];
  /** "Back" when the member came from signing in inside Tagify. */
  cancelLabel?: string;
  onCancel: () => void;
}

const EMAIL_STEPS = ["Enter your email on the page that opened", "Type the code we email you"];

/**
 * While Community waits for the member to sign in on the page that opened: what to do there, and
 * that Tagify finishes by itself. The computer's code travels in the link, so nobody types it.
 */
export function CommunityConnectWaiting({ pairing, heading = "Finish in your browser", description, steps = EMAIL_STEPS, cancelLabel = "Cancel", onCancel }: CommunityConnectWaitingProps) {
  const { pending, starting, error } = pairing;
  const failedToStart = !pending && !starting && Boolean(error);
  const entry = pairing.entry ?? "community";

  return (
    <div className={styles.waiting}>
      <div className={styles.main}>
        <h3 className={styles.heading}>{heading}</h3>
        {description ? <p className={styles.description}>{description}</p> : null}
        <ol className={styles.steps}>
          {steps.map((step, index) => <li key={step}><span className={styles.number} aria-hidden="true">{index + 1}</span>{step}</li>)}
        </ol>
        {failedToStart ? (
          <p className={styles.error} role="alert">{error}</p>
        ) : (
          <p className={styles.status} role="status">
            <Loader2 size={14} className={styles.spinner} aria-hidden="true" />
            {starting && !pending ? "Opening the page in your browser…" : "Waiting for you to finish in your browser…"}
          </p>
        )}
        {error && !failedToStart ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <div className={styles.side}>
        <div className={styles.actions}>
          {failedToStart ? (
            <button type="button" className={styles.primary} onClick={() => void communityPairing.start(entry)}>Try again</button>
          ) : (
            <button type="button" className={styles.primary} disabled={!pending} onClick={() => pending && openCommunityUrl(pending.verificationUri)}>
              <ExternalLink size={14} aria-hidden="true" /> Open the page again
            </button>
          )}
          <button type="button" className={styles.secondary} onClick={onCancel}>{cancelLabel}</button>
        </div>
      </div>
      <p className={styles.note}>New here? The same steps create your free Tagify account. It&apos;s not your Spotify login. You can close this window: Tagify finishes connecting by itself.</p>
    </div>
  );
}
