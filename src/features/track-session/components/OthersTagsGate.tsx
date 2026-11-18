import React from "react";
import { Globe, Lock } from "lucide-react";
import styles from "./OthersTagsGate.module.css";

interface OthersTagsGateProps {
  /** Opens the existing sharing choice (or, with `ask="connect"`, connecting to Community). */
  onShare: () => void;
  onClose: () => void;
  /** "connect": for someone not connected to Community, who connects first; the request to share otherwise. */
  ask?: "share" | "connect";
}

/**
 * Opened from a row's "N others" by a member who doesn't share their tags on Community: every tag and
 * one-tap add wait until they share theirs. The first tags stay on the row for everyone.
 */
export function OthersTagsGate({ onShare, onClose, ask = "share" }: OthersTagsGateProps) {
  const connect = ask === "connect";
  return (
    <div className={styles.gate} role="group" aria-label="Other members' tags">
      <p className={styles.text}>
        <Lock size={14} aria-hidden="true" className={styles.icon} />
        <span>{connect
          ? "Connect to Tagify Community to add the tags others gave this song."
          : "Share your tags on Community to see every tag others gave this song and add them in one tap."}</span>
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.share} onClick={onShare}>
          {connect ? "Connect" : <><Globe size={14} aria-hidden="true" />Share my tags</>}
        </button>
        <button type="button" className={styles.later} onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}
