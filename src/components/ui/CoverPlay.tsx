import React from "react";
import { Pause, Play } from "lucide-react";
import styles from "./CoverPlay.module.css";

interface CoverPlayProps {
  /** The cover image (or its empty placeholder). */
  children: React.ReactNode;
  /** The song's name, for the button's label. */
  name: string;
  /** Spotify has this song loaded (playing or paused). */
  current: boolean;
  /** It is playing right now. */
  playing: boolean;
  /** Starts the song; pressing Play on the loaded song pauses or resumes it instead. */
  onPlay: () => void;
  /** Cover size in pixels; the bar spans its width. */
  size?: number;
}

/**
 * A song's cover with Play in a bar under it, as everywhere on Tagify Community (Alex, 2026-11-17:
 * "It should look like the one that's on the community. Like it's a black bar with the play button on it").
 */
export function CoverPlay({ children, name, current, playing, onPlay, size = 48 }: CoverPlayProps) {
  const label = `${playing ? "Pause" : "Play"} ${name}`;
  return (
    <div className={styles.media} style={{ width: size }}>
      <div className={styles.art} style={{ height: size }}>{children}</div>
      <button type="button" className={`${styles.play} ${current ? styles.current : ""}`} aria-label={label} title={playing ? "Pause" : "Play"}
        onClick={(event) => {
          event.stopPropagation();
          if (current) {
            try { Spicetify.Player.togglePlay(); } catch { /* Spotify catches up on the next press. */ }
            return;
          }
          onPlay();
        }}>
        {playing ? <Pause size={14} fill="currentColor" aria-hidden="true" /> : <Play size={14} fill="currentColor" aria-hidden="true" />}
      </button>
    </div>
  );
}
