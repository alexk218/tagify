import React, { useEffect, useRef } from "react";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import styles from "./FirstSongCard.module.css";

interface FirstRunPayoffCardProps {
  taggedSongs: number;
  tag: { id: string; name: string; songs: number };
  // True once the songs with this tag are showing in the list.
  filtered: boolean;
  onShowSongs: () => void;
  onMakePlaylist: () => void;
  onDismiss: () => void;
}

const songsLabel = (count: number) => `${count} ${count === 1 ? "song" : "songs"}`;

export function FirstRunPayoffCard({ taggedSongs, tag, filtered, onShowSongs, onMakePlaylist, onDismiss }: FirstRunPayoffCardProps) {
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    recordProductInteraction("first_run_payoff_shown");
  }, []);

  const showSongs = () => {
    recordProductInteraction("first_run_payoff_reached", { payoff_action: "filter" });
    onShowSongs();
  };
  const makePlaylist = () => {
    recordProductInteraction("first_run_payoff_reached", { payoff_action: "playlist" });
    onMakePlaylist();
  };

  return (
    <section className={styles.card} aria-label="Find your tagged songs">
      <div className={styles.headerRow}>
        <h2 className={styles.title}>{songsLabel(taggedSongs)} tagged. Now find them again</h2>
        <button type="button" className={styles.dismiss} onClick={onDismiss} aria-label="Hide this tip">×</button>
      </div>
      <p className={styles.description}>
        {filtered
          ? `These are your ${tag.name} songs. Save them as a Spotify playlist, and keep tagging to grow it.`
          : `Tags turn into filters. Show every song you tagged ${tag.name}, then save them as a Spotify playlist.`}
      </p>
      <div className={styles.actions}>
        <button type="button" className={filtered ? styles.secondaryButton : styles.primaryButton} onClick={showSongs} disabled={filtered}>
          {filtered ? `Showing ${tag.name}` : `Show my ${tag.name} songs`}
        </button>
        <button type="button" className={filtered ? styles.primaryButton : styles.secondaryButton} onClick={makePlaylist}>Make a playlist</button>
      </div>
    </section>
  );
}
