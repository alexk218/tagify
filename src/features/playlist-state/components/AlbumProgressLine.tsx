import React, { useMemo } from "react";
import { useAlbumTrackTotals } from "../hooks/useAlbumTrackTotals";
import { describeAlbumProgress, getAlbumProgress } from "../utils/albumTrackSummary";
import AlbumProgressBar from "./AlbumProgressBar";
import styles from "./AlbumProgressLine.module.css";

interface AlbumProgressLineProps {
  albumUri: string;
  taggedTrackCount: number;
  /** The album length saved with the user's own album rating or tags, if any. */
  knownTrackCount?: number | null;
}

const NO_ALBUMS_TO_LOOK_UP: string[] = [];

function isTrackTotal(value: number | null | undefined): value is number {
  return typeof value === "number" && value > 0;
}

/** A one-line summary of how much of a track's album has been rated or tagged. */
const AlbumProgressLine: React.FC<AlbumProgressLineProps> = ({
  albumUri,
  taggedTrackCount,
  knownTrackCount,
}) => {
  const albumUrisToLookUp = useMemo(
    () => (isTrackTotal(knownTrackCount) ? NO_ALBUMS_TO_LOOK_UP : [albumUri]),
    [albumUri, knownTrackCount],
  );
  const albumTrackTotals = useAlbumTrackTotals(albumUrisToLookUp);
  const totalTrackCount = isTrackTotal(knownTrackCount)
    ? knownTrackCount
    : (albumTrackTotals[albumUri] ?? null);
  const progress = getAlbumProgress(taggedTrackCount, totalTrackCount);

  // Singles are covered by the track's own rating, and an unknown album with
  // nothing tagged has nothing to report yet.
  if (
    progress.totalTrackCount === 1 ||
    (progress.totalTrackCount === null && progress.taggedTrackCount === 0)
  ) {
    return null;
  }

  const description = describeAlbumProgress(
    progress.taggedTrackCount,
    progress.totalTrackCount,
  );

  return (
    <div className={styles.line} title={`Album progress: ${description}`}>
      {progress.totalTrackCount !== null ? (
        <span className={styles.bar}>
          <AlbumProgressBar progress={progress} label="Album progress" />
        </span>
      ) : null}
      <span
        className={`${styles.text} ${progress.isComplete ? styles.complete : ""}`}
      >
        {progress.totalTrackCount !== null
          ? `${progress.taggedTrackCount}/${progress.totalTrackCount} tracks`
          : description}
      </span>
    </div>
  );
};

export default AlbumProgressLine;
