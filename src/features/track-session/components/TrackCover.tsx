import React, { useState } from "react";
import { toSmallSpotifyCover } from "../utils/trackCover";
import styles from "./TrackList.module.css";

interface TrackCoverProps {
  imageUrl: string | null | undefined;
}

// Album cover thumbnail for a track list row. It reads the cover URL already
// saved with the song, so it never asks Spotify for anything; the browser only
// downloads it from the image CDN once the row scrolls into view.
export const TrackCover = React.memo(function TrackCover({ imageUrl }: TrackCoverProps) {
  const src = toSmallSpotifyCover(imageUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return <span className={`${styles.trackCover} ${styles.trackCoverEmpty}`} aria-hidden="true" />;
  }

  return (
    <img
      className={styles.trackCover}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  );
});
