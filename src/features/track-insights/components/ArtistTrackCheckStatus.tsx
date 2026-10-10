import React from "react";
import { Info } from "lucide-react";
import type { ArtistTrackInsights } from "../hooks/useArtistTrackInsights";
import styles from "./ArtistTrackCheckStatus.module.css";

/** One library-wide note while some tracks still need their artists checked. */
export function ArtistTrackCheckStatus({ artist }: { artist: ArtistTrackInsights }) {
  if (!artist.pendingCount) return null;
  const paused = artist.blockedUntil > Date.now();

  return (
    <div className={styles.notice} role="status">
      <Info className={styles.icon} size={15} aria-hidden="true" />
      <div className={styles.text}>
        <span className={styles.message}>
          {artist.isChecking
            ? "Updating artist summaries…"
            : paused
              ? "Track checking paused. Wait a moment, then try again."
              : `${artist.pendingCount.toLocaleString()} of your tracks haven't been checked for artists yet.`}
        </span>
        <span className={styles.help}>
          {artist.isChecking
            ? "You can keep browsing. Checking stops when you leave Artists."
            : "Summaries update as you use Tagify. Check up to 250 more tracks now."}
        </span>
      </div>
      {!artist.isChecking ? (
        <button type="button" className={styles.button} disabled={paused} onClick={artist.retry}>
          Check more tracks
        </button>
      ) : null}
    </div>
  );
}
