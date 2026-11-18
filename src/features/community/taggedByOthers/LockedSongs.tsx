import React from "react";
import { Lock } from "lucide-react";
import type { CommunityMatch } from "@/features/onboarding/services/communityMatches";
import styles from "./LockedSongs.module.css";
import { mergeSameTags } from "./TaggedByOthersRows";

/** Locked songs shown as a preview before the call to share tags. */
export const PREVIEW_ROWS = 3;

interface LockedSongsProps {
  /** The songs past the usable ones, in the list's order. */
  matches: CommunityMatch[];
  /** Every song found, for "see all N". */
  total: number;
  coverOf: (match: CommunityMatch) => string | undefined;
  /** Opens the existing "Share your tags" window. */
  onShare: () => void;
  /** Replaces "N more songs tagged by others", for a preview that holds only some of the songs. */
  countText?: string;
  /** The line under the count; null for none. */
  pitch?: string | null;
  actionLabel?: string;
}

const count = (value: number) => value.toLocaleString();

/**
 * The rest of the songs other members tagged, locked until the member shares their own tags on
 * Community: the first few show which of their songs these are and how many tags wait on each, never
 * the tags themselves.
 */
export function LockedSongs({
  matches, total, coverOf, onShare, countText,
  pitch = "Others get to see your tags in return.", actionLabel = `Share your tags on Community to see all ${count(total)}`,
}: LockedSongsProps) {
  if (!matches.length && !countText) return null;
  const rows = matches.slice(0, PREVIEW_ROWS);
  return (
    <div className={styles.locked}>
      {rows.length ? <ul className={styles.rows} aria-label="Locked songs">
        {rows.map((match) => {
          const cover = coverOf(match);
          // Counted as the usable rows show them: one tag however many spellings members used.
          const tags = mergeSameTags(match.tags).length;
          return (
            <li key={match.track.uri} className={styles.row}>
              {cover ? <img src={cover} alt="" className={styles.cover} /> : <span className={styles.cover} />}
              <span className={styles.body}>
                <span className={styles.songName}>{match.track.name}</span>
                <span className={styles.meta}>{match.track.artists.map((artist) => artist.name).join(", ")}</span>
                <span className={styles.lockedTags}>
                  <Lock size={12} aria-hidden="true" />
                  {tags === 1 ? "1 tag from others" : `${count(tags)} tags from others`}
                </span>
              </span>
            </li>
          );
        })}
      </ul> : null}
      <div className={styles.footer}>
        <span className={styles.count}>
          <Lock size={14} aria-hidden="true" />
          {countText ?? `${matches.length === 1 ? "1 more song" : `${count(matches.length)} more songs`} tagged by others`}
        </span>
        {pitch ? <span className={styles.pitch}>{pitch}</span> : null}
        <button type="button" className={styles.action} onClick={onShare}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
