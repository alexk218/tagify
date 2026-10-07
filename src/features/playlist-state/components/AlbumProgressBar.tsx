import React from "react";
import type { AlbumProgress } from "../utils/albumTrackSummary";
import styles from "./AlbumProgressBar.module.css";

interface AlbumProgressBarProps {
  progress: AlbumProgress;
  label: string;
  size?: "compact" | "large";
}

const AlbumProgressBar: React.FC<AlbumProgressBarProps> = ({
  progress,
  label,
  size = "compact",
}) => {
  if (progress.ratio === null || progress.totalTrackCount === null) {
    return null;
  }

  return (
    <div
      className={`${styles.track} ${size === "large" ? styles.large : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={progress.totalTrackCount}
      aria-valuenow={progress.taggedTrackCount}
      aria-valuetext={`${progress.taggedTrackCount} of ${progress.totalTrackCount} tracks`}
    >
      <div
        className={`${styles.fill} ${progress.isComplete ? styles.complete : ""}`}
        style={{ width: `${Math.round(progress.ratio * 1000) / 10}%` }}
      />
    </div>
  );
};

export default AlbumProgressBar;
