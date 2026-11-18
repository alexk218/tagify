import React, { useState } from "react";
import { Check, Lock, Plus, Star, X } from "lucide-react";
import { sameTagNameKey } from "@tagify/community-contracts";
import type { CommunityMatch, CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import styles from "./TaggedByOthersRows.module.css";
import { CoverPlay, usePlayerNow } from "@/components/ui";

/** Tags a song shows before "+N more": enough to see what members agree on, few enough to scan a long list. */
export const TAGS_SHOWN = 6;

/** One tag as members wrote it, with every spelling that is the same tag ("Nu Metal", "nu metal", "Nu-metal"). */
export interface MergedTag extends CommunityMatchTag {
  spellings: string[];
}

/**
 * Members' tags with the same name merged (case, spaces and hyphens ignored, as Community matches
 * names), counted together, named by the spelling most members used, most-used first. Ties keep
 * Community's order.
 */
export function mergeSameTags(tags: CommunityMatchTag[]): MergedTag[] {
  const merged = new Map<string, MergedTag & { best: number; order: number }>();
  for (const [order, tag] of tags.entries()) {
    const key = sameTagNameKey(tag.label) || `\u0000${tag.label}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...tag, paths: [...tag.paths], spellings: [tag.label], best: tag.people, order });
      continue;
    }
    existing.people += tag.people;
    existing.spellings.push(tag.label);
    for (const path of tag.paths) if (!existing.paths.includes(path)) existing.paths.push(path);
    if (tag.people > existing.best) { existing.label = tag.label; existing.best = tag.people; }
  }
  return [...merged.values()]
    .sort((a, b) => b.people - a.people || a.order - b.order)
    .map(({ best: _best, order: _order, ...tag }) => tag);
}

interface TaggedByOthersRowsProps {
  matches: CommunityMatch[];
  /** Adds this tag to the song in the member's own library (`on`), or takes it off. */
  onToggleTag: (match: CommunityMatch, tag: MergedTag, on: boolean) => Promise<void>;
  coverOf: (match: CommunityMatch) => string | undefined;
  /** Whether the member's own library has this tag (any of its spellings) on the song. */
  hasTag: (match: CommunityMatch, tag: MergedTag) => boolean;
  /** Locks the song in the editor above, as clicking a song in Tagged Tracks does. */
  onLock?: (match: CommunityMatch) => void;
  /** The song locked in the editor. */
  activeUri?: string | null;
  onPlay?: (match: CommunityMatch) => void;
  /** The member's own star rating of the song, 0 for none. */
  ratingOf?: (match: CommunityMatch) => number;
  onHide?: (match: CommunityMatch) => void;
  /** Whether a tag already on the song can be taken off here (the Community tab's card only adds). */
  canRemove?: boolean;
  /** Who tagged the song, after the artist. */
  detailOf: (match: CommunityMatch) => string;
  /**
   * Not connected to Community: the tags show but can't be added, and each song offers "Connect to add"
   * instead, which calls this.
   */
  onConnectToAdd?: () => void;
}

const keyOf = (uri: string, label: string) => `${uri}\u0000${sameTagNameKey(label) || label}`;
const peopleText = (people: number) => `${people.toLocaleString()} ${people === 1 ? "member" : "members"}`;
/** Clicks on a row's own controls don't also lock the row. */
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

/** The songs other members tagged: play one, lock it to edit, turn members' tags on or off, or hide it. */
export function TaggedByOthersRows({ matches, onToggleTag, coverOf, hasTag, onLock, activeUri = null, onPlay, ratingOf, onHide, canRemove = true, detailOf, onConnectToAdd }: TaggedByOthersRowsProps) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = usePlayerNow();

  const toggleTag = async (match: CommunityMatch, tag: MergedTag) => {
    const key = keyOf(match.track.uri, tag.label);
    if (busy) return;
    const on = !hasTag(match, tag);
    setBusy(key);
    setError(null);
    try {
      await onToggleTag(match, tag, on);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : on ? "Tagify couldn't add that tag. Please try again." : "Tagify couldn't remove that tag. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <ul className={styles.rows}>
        {matches.map((match) => {
          const uri = match.track.uri;
          const tags = mergeSameTags(match.tags);
          const open = opened.has(uri);
          const visible = open ? tags : tags.slice(0, TAGS_SHOWN);
          const hidden = tags.length - visible.length;
          const artist = match.track.artists.map((item) => item.name).join(", ");
          const toggleMore = () => setOpened((current) => {
            const next = new Set(current);
            if (next.has(uri)) next.delete(uri); else next.add(uri);
            return next;
          });
          const cover = coverOf(match);
          const active = activeUri === uri;
          const playing = player.uri === uri && player.playing;
          const rating = ratingOf?.(match) ?? 0;
          return (
            <li key={uri} className={`${styles.row} ${active ? styles.rowActive : ""} ${onLock ? styles.rowLockable : ""}`}
              onClick={onLock && !active ? () => onLock(match) : undefined}>
              {onPlay ? (
                <CoverPlay name={match.track.name} current={player.uri === uri} playing={playing} onPlay={() => onPlay(match)} size={64}>
                  {cover ? <img src={cover} alt="" /> : <span />}
                </CoverPlay>
              ) : cover ? <img src={cover} alt="" className={styles.cover} /> : <span className={styles.cover} />}
              <div className={styles.body}>
                <span className={styles.titleLine}>
                  {onLock ? (
                    <button type="button" className={`${styles.song} ${styles.songButton}`} aria-pressed={active}
                      onClick={(event) => { stop(event); if (!active) onLock(match); }}
                      aria-label={active ? `${match.track.name}, open in the editor` : `Open ${match.track.name}`}>
                      <span className={styles.songName}>{match.track.name}</span>
                    </button>
                  ) : <span className={`${styles.song} ${styles.songName}`}>{match.track.name}</span>}
                  {rating > 0 ? (
                    <span className={styles.rating} aria-label={`Your rating: ${rating} ${rating === 1 ? "star" : "stars"}`}>
                      <Star size={11} fill="currentColor" aria-hidden="true" />{rating}
                    </span>
                  ) : null}
                </span>
                <span className={styles.meta}>
                  <span className={styles.artist}>{artist}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{detailOf(match)}</span>
                </span>
                <span className={styles.tags}>
                  {onConnectToAdd ? visible.map((tag) => (
                    <span key={tag.label} className={`${styles.tag} ${styles.tagReadOnly}`} title={`Tagged ${tag.label} by ${peopleText(tag.people)}`}>
                      <span className={styles.tagName}>{tag.label}</span>
                      {tag.people > 1 ? <span className={styles.count} aria-hidden="true">{tag.people.toLocaleString()}</span> : null}
                    </span>
                  )) : visible.map((tag) => {
                    const on = hasTag(match, tag);
                    const working = busy === keyOf(uri, tag.label);
                    return (
                      <button key={tag.label} type="button" className={`${styles.tag} ${on ? styles.tagOn : ""}`} disabled={busy !== null || (on && !canRemove)}
                        aria-pressed={on} aria-busy={working || undefined}
                        aria-label={on && !canRemove ? `${tag.label} added to ${match.track.name}` : on ? `Remove ${tag.label} from ${match.track.name}` : `Add ${tag.label} to ${match.track.name}`}
                        title={`${on ? (canRemove ? "On your song. Click to remove" : "On your song") : "Click to add"} · tagged ${tag.label} by ${peopleText(tag.people)}`}
                        onClick={(event) => { stop(event); void toggleTag(match, tag); }}>
                        {on ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                        <span className={styles.tagName}>{tag.label}</span>
                        {tag.people > 1 ? <span className={styles.count} aria-hidden="true">{tag.people.toLocaleString()}</span> : null}
                      </button>
                    );
                  })}
                  {hidden > 0 || open ? (
                    <button type="button" className={styles.more} aria-expanded={open} onClick={(event) => { stop(event); toggleMore(); }}
                      aria-label={open ? `Show fewer tags for ${match.track.name}` : `Show ${hidden.toLocaleString()} more tags for ${match.track.name}`}>
                      {open ? "Show fewer" : `+${hidden.toLocaleString()} more`}
                    </button>
                  ) : null}
                  {onConnectToAdd ? (
                    <button type="button" className={styles.more} onClick={(event) => { stop(event); onConnectToAdd(); }}
                      aria-label={`Connect to Tagify Community to add these tags to ${match.track.name}`}>
                      <Lock size={11} aria-hidden="true" />Connect to add
                    </button>
                  ) : null}
                </span>
              </div>
              {onHide ? (
                <button type="button" className={styles.hide} onClick={(event) => { stop(event); onHide(match); }}
                  aria-label={`Hide ${match.track.name}`} title="Hide this song">
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </>
  );
}
