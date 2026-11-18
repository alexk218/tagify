import React from "react";
import type { SongDetailsProgress } from "@/features/metadata-backfill";
import styles from "./TrackList.module.css";

// While Tagify is still finding songs' lengths and release years, a thin progress bar under the
// filters says how far it has got, so a Released list with only a few years (or none yet) doesn't
// look broken. It disappears once every song has been tried. Alex picked this layout (B) on
// 2026-11-07 over a single line of text and a "% found" badge.

const count = (value: number) => value.toLocaleString();

export function SongDetailsProgressBar({ progress }: { progress: SongDetailsProgress }) {
  if (progress.waiting <= 0 || progress.total <= 0) return null;
  const done = progress.total - progress.waiting;
  const percent = Math.floor((done / progress.total) * 100);
  return (
    <div className={styles.songDetailsProgressBar} role="status">
      <div className={styles.songDetailsProgressBarLabels}>
        <span>Finding song lengths and release years</span>
        <span>{count(done)} of {count(progress.total)} songs</span>
      </div>
      <div
        className={styles.songDetailsProgressTrack}
        role="progressbar"
        aria-label="Song lengths and release years found"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.songDetailsProgressFill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
