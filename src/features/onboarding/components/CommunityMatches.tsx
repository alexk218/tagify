import React, { useState } from "react";
import { Check, Plus } from "lucide-react";
import type { CommunityMatch, CommunityMatchTag } from "../services/communityMatches";
import styles from "./CommunityMatches.module.css";

interface CommunityMatchesProps {
  matches: CommunityMatch[];
  /** Adds these members' tags to the song in the member's own library. */
  onAdd: (match: CommunityMatch, tags: CommunityMatchTag[], source: "tag" | "all") => Promise<void>;
  coverOf: (match: CommunityMatch) => string | undefined;
}

const songsText = (count: number) => `${count} of your ${count === 1 ? "song" : "songs"}`;
const peopleText = (people: number) => `${people} ${people === 1 ? "member" : "members"}`;
const keyOf = (uri: string, label: string) => `${uri}\u0000${label.toLocaleLowerCase()}`;

/** "Members already tagged N of your songs": other members' tags on the new member's Liked Songs, one tap to add. */
export function CommunityMatches({ matches, onAdd, coverOf }: CommunityMatchesProps) {
  return (
    <section className={styles.section} aria-label="Songs members already tagged">
      <div className={styles.header}>
        <span className={styles.heading}>Members already tagged {songsText(matches.length)}</span>
        <span className={styles.help}>Add the tags that fit. You can change them anytime.</span>
      </div>
      <CommunityMatchRows matches={matches} onAdd={onAdd} coverOf={coverOf} />
    </section>
  );
}

interface CommunityMatchRowsProps extends CommunityMatchesProps {
  /** Whether the member's own library already has this tag on the song. */
  hasTag?: (match: CommunityMatch, tag: CommunityMatchTag) => boolean;
  /** Opens the song's details; with it, the song's name and artist are one button. */
  onOpen?: (match: CommunityMatch) => void;
  /** A quiet line under the song's tags, such as who tagged it. */
  detailOf?: (match: CommunityMatch) => string | null;
}

/** The songs with other members' tags, shared by the first run and the Community view. */
export function CommunityMatchRows({ matches, onAdd, coverOf, hasTag, onOpen, detailOf }: CommunityMatchRowsProps) {
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const isOn = (match: CommunityMatch, tag: CommunityMatchTag) => added.has(keyOf(match.track.uri, tag.label)) || !!hasTag?.(match, tag);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (items: { match: CommunityMatch; tags: CommunityMatchTag[] }[], source: "tag" | "all") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      for (const { match, tags } of items) {
        const missing = tags.filter((tag) => !isOn(match, tag));
        if (!missing.length) continue;
        await onAdd(match, missing, source);
        setAdded((current) => new Set([...current, ...missing.map((tag) => keyOf(match.track.uri, tag.label))]));
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Tagify couldn't add those tags. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const allAdded = (match: CommunityMatch) => match.tags.every((tag) => isOn(match, tag));

  return (
    <>
      <ul className={styles.rows}>
        {matches.map((match) => (
          <li key={match.track.uri} className={styles.row}>
            {coverOf(match) ? <img src={coverOf(match)} alt="" className={styles.cover} /> : <span className={styles.cover} />}
            {onOpen ? (
              <button type="button" className={`${styles.song} ${styles.songButton}`} onClick={() => onOpen(match)}
                aria-label={`Open ${match.track.name}`}>
                <span className={styles.songName}>{match.track.name}</span>
                <span className={styles.songArtist}>{match.track.artists.map((artist) => artist.name).join(", ")}</span>
              </button>
            ) : (
              <span className={styles.song}>
                <span className={styles.songName}>{match.track.name}</span>
                <span className={styles.songArtist}>{match.track.artists.map((artist) => artist.name).join(", ")}</span>
              </span>
            )}
            <span className={styles.tags}>
              {match.tags.map((tag) => {
                const isAdded = isOn(match, tag);
                return (
                  <button key={tag.label} type="button" className={styles.tag} disabled={busy || isAdded}
                    aria-label={isAdded ? `${tag.label} added to ${match.track.name}` : `Add ${tag.label} to ${match.track.name}`}
                    title={`Tagged ${tag.label} by ${peopleText(tag.people)}`}
                    onClick={() => void add([{ match, tags: [tag] }], "tag")}>
                    {isAdded ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                    <span className={styles.tagName}>{tag.label}</span>
                  </button>
                );
              })}
            </span>
            {detailOf?.(match) ? <span className={styles.detail}>{detailOf(match)}</span> : null}
            {match.tags.length > 1 && (
              <button type="button" className={styles.addAll} disabled={busy || allAdded(match)}
                onClick={() => void add([{ match, tags: match.tags }], "all")}>
                {allAdded(match) ? "Added" : "Add all"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </>
  );
}
