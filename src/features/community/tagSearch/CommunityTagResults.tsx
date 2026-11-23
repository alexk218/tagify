import React, { useEffect, useRef, useState } from "react";
import { CoverPlay, usePlayerNow } from "@/components/ui";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { flushLikedSaveCredits, queueLikedSaveCredit } from "../communityLikedSaveCredits";
import { LockedSongs } from "../taggedByOthers/LockedSongs";
import { recordCommunityTeaserConnectClicked, recordCommunityTeaserViewed } from "../taggedByOthers/communityTeaserPreview";
import { useCommunityTagSearch, type CommunityTagSearchState } from "./useCommunityTagSearch";
import { TAG_SEARCH_MAX_TAGS, type TagSearchMatch, type TagSearchSong } from "./tagSearchClient";
import styles from "./CommunityTagResults.module.css";
import { ALL_HIDDEN_LOCK, useSharingLockReason } from "@/features/community/sharingLockReason";

/** Songs shown before the lock, for people who aren't connected or don't share their tags (Alex's pick 2A). */
export const SONGS_BEFORE_LOCK = 5;

const count = (value: number) => value.toLocaleString();

/** "Deep House", "Deep House or Techno", "Deep House, Techno and Minimal". */
export function tagsText(tags: readonly string[], match: TagSearchMatch): string {
  const word = match === "all" ? "and" : "or";
  if (tags.length <= 1) return tags[0] ?? "";
  return `${tags.slice(0, -1).join(", ")} ${word} ${tags[tags.length - 1]}`;
}

export function foundText(total: number, tags: readonly string[], match: TagSearchMatch, capped = false): string {
  if (capped) return `${count(total)}+ songs tagged ${tagsText(tags, match)}`;
  return `${total === 1 ? "1 song" : `${count(total)} songs`} tagged ${tagsText(tags, match)}`;
}


interface CommunityTagResultsProps {
  /** The active filter's tag names, as the member wrote them. */
  tags: readonly string[];
  match: TagSearchMatch;
  search: CommunityTagSearchState;
  onPlay: (uri: string) => void;
  /** Not connected: "Create account or sign in". */
  onConnect: () => void;
  /** Connected but not sharing their tags: the existing sharing window. */
  onShare: () => void;
  /** The member's Liked Songs in Spotify. */
  likedSongs?: LikedSongs;
  /** A song was just saved to Liked Songs from here: the member who tagged it gets credit on Community. */
  onSaved?: (uri: string, tags: readonly string[]) => void;
  /** Shown as its own tab or view, which already names it: no heading. */
  bare?: boolean;
}

export interface LikedSongs {
  contain(uris: string[]): Promise<boolean[]>;
  save(uri: string): Promise<void>;
  remove(uri: string): Promise<void>;
}

const spotifyLikedSongs: LikedSongs = {
  contain: (uris) => spotifyApiService.likedSongsContain(uris),
  save: (uri) => spotifyApiService.saveToLikedSongs([uri]),
  remove: (uri) => spotifyApiService.removeFromLikedSongs([uri]),
};

const creditSave = (uri: string, tags: readonly string[]) => {
  const connection = getDesktopSyncConfiguration();
  if (!connection) return;
  queueLikedSaveCredit(connection.accountId, uri, tags);
  void flushLikedSaveCredits(connection, (path, options) => (window.TagifySync || syncRuntime).communityRequest(path, options));
};

/** Which shown songs are in the member's Liked Songs; a song saved or removed here updates at once. */
function useLikedSongs(uris: readonly string[], likedSongs: LikedSongs) {
  const [liked, setLiked] = useState<ReadonlySet<string>>(() => new Set());
  // Songs saved or removed here: Spotify's answer to an earlier check never undoes them.
  const changedHere = useRef(new Set<string>());
  const key = uris.join(" ");
  useEffect(() => {
    if (!uris.length) return;
    let live = true;
    likedSongs.contain([...uris]).then((flags) => {
      if (!live) return;
      setLiked((current) => {
        const next = new Set(current);
        uris.forEach((uri, index) => {
          if (changedHere.current.has(uri)) return;
          if (flags[index]) next.add(uri); else next.delete(uri);
        });
        return next;
      });
    }, () => { /* Unknown: every heart starts empty, and saving checks again. */ });
    return () => { live = false; };
  }, [key, likedSongs]);
  const mark = (uri: string, saved: boolean) => {
    changedHere.current.add(uri);
    setLiked((current) => {
      const next = new Set(current);
      if (saved) next.add(uri); else next.delete(uri);
      return next;
    });
  };
  return { liked, mark };
}

/**
 * Songs other members tagged with the track list's active tags: play one or save it to Liked Songs.
 * People who aren't connected, or don't share their tags, see the first few and how many there are,
 * with the rest behind "Create account or sign in" or "Share your tags".
 */
export function CommunityTagResults({ tags, match, search, onPlay, onConnect, onShare, likedSongs = spotifyLikedSongs, onSaved = creditSave, bare = false }: CommunityTagResultsProps) {
  const allHidden = useSharingLockReason() === "all-hidden";
  const player = usePlayerNow();
  const { phase, songs, total, locked } = search;
  const shown = locked ? songs.slice(0, SONGS_BEFORE_LOCK) : songs;
  const more = total - shown.length;
  const { liked, mark } = useLikedSongs(shown.map((song) => song.uri), likedSongs);
  const teaser = phase === "done" && !!locked && total > 0;
  useEffect(() => { if (teaser) recordCommunityTeaserViewed("tag_search", total); }, [teaser, total]);

  // Nothing to say when Community has no search (old Community, switched off) or found nothing.
  if (phase === "idle" || (phase === "failed" && (search.failure === "not-available" || search.failure === "paused"))) return null;
  if (phase === "done" && total === 0) return null;

  return (
    <section className={`${styles.section} ${bare ? styles.bare : ""}`} aria-labelledby="community-tag-results-title" aria-busy={phase === "loading" || undefined}>
      <div className={styles.titleRow}>
        <h3 id="community-tag-results-title" className={bare ? styles.visuallyHidden : styles.title}>
          On Community
        </h3>
        <p className={styles.found}>
          {phase === "loading" ? `Looking for songs tagged ${tagsText(tags, match)}…`
            : phase === "failed" ? (search.failure === "busy" ? "Community is busy. Try again in a minute." : "Community couldn't be reached. Try again later.")
              : foundText(total, tags, match, search.capped)}
        </p>
      </div>
      {shown.length ? (
        <ul className={styles.shelf}>
          {shown.map((song) => (
            <SongRow key={song.uri} song={song} searched={tags} current={player.uri === song.uri} playing={player.uri === song.uri && player.playing}
              onPlay={() => onPlay(song.uri)} saved={liked.has(song.uri)}
              onSavedChange={(saved) => mark(song.uri, saved)} likedSongs={likedSongs} onSaved={() => onSaved(song.uri, tags)} />
          ))}
        </ul>
      ) : null}
      {teaser ? (
        <LockedSongs matches={[]} total={total} coverOf={() => undefined}
          onShare={() => { if (locked === "connect") { recordCommunityTeaserConnectClicked("tag_search"); onConnect(); } else onShare(); }}
          countText={more > 0 ? `${search.capped ? "More" : more === 1 ? "1 more song" : `${count(more)} more songs`} on Community` : "See every song tagged this way"}
          pitch={locked === "share" ? allHidden ? ALL_HIDDEN_LOCK : "Others get to see your tags in return." : null}
          actionLabel={locked === "connect" ? `Create account or sign in to see all ${count(total)}${search.capped ? "+" : ""}` : `${allHidden ? "Show some of your tags" : "Share your tags on Community"} to see all ${count(total)}${search.capped ? "+" : ""}`} />
      ) : null}
      {search.hasMore ? (
        <button type="button" className={styles.more} onClick={search.loadMore} disabled={search.loadingMore}>
          {search.loadingMore ? "Loading…" : (search.capped ? "Show more" : `Show more (${count(more)} more)`)}
        </button>
      ) : null}
    </section>
  );
}

/** Tag pills under each cover; more than this and the tile grows past its neighbours. */
const TAGS_ON_TILE = 4;

function SongRow({ song, searched, current, playing, onPlay, saved, onSavedChange, likedSongs, onSaved }: {
  song: TagSearchSong;
  searched: readonly string[];
  current: boolean;
  playing: boolean;
  onPlay: () => void;
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  likedSongs: LikedSongs;
  onSaved: () => void;
}) {
  const name = song.title ?? "Song on Spotify";
  const isSearched = (tag: string) => searched.some((wanted) => wanted.toLowerCase() === tag.toLowerCase());
  const tags = song.tags.slice(0, TAGS_ON_TILE);
  return (
    <li className={styles.tile}>
      <CoverPlay name={name} current={current} playing={playing} onPlay={onPlay} size={148}>
        {song.imageUrl ? <img src={song.imageUrl} alt="" /> : <span />}
      </CoverPlay>
      <div className={styles.tileText}>
        <div className={styles.tileName}>
          <span className={`${styles.tileTitle} ${current ? styles.current : ""}`}>{name}</span>
          <span className={styles.tileLine}>{song.artists.join(", ")}</span>
          <span className={styles.tileLine}>{count(song.people)} {song.people === 1 ? "member" : "members"}</span>
        </div>
        <SaveToLikedSongs uri={song.uri} name={name} saved={saved} onSavedChange={onSavedChange} likedSongs={likedSongs} onSaved={onSaved} />
      </div>
      {tags.length ? (
        <span className={styles.tilePills} aria-label={`Tags: ${song.tags.join(", ")}`}>
          {tags.map((tag) => <span key={tag} className={`${styles.tilePill} ${isSearched(tag) ? styles.tilePillOn : ""}`}>{tag}</span>)}
        </span>
      ) : null}
    </li>
  );
}

/** Spotify's own Liked Songs icons, so the control reads the same as on Spotify's song rows. */
const LIKED_ICON = { add: "plus-alt", added: "check-alt-fill" } as const;
const FALLBACK_ICON: Record<string, string> = {
  "plus-alt": '<path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/><path d="M11.75 8a.75.75 0 0 1-.75.75H8.75V11a.75.75 0 0 1-1.5 0V8.75H5a.75.75 0 0 1 0-1.5h2.25V5a.75.75 0 0 1 1.5 0v2.25H11a.75.75 0 0 1 .75.75z"/>',
  "check-alt-fill": '<path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm11.748-1.97a.75.75 0 0 0-1.06-1.06l-4.47 4.47-1.405-1.406a.75.75 0 1 0-1.061 1.06l2.466 2.467 5.53-5.53z"/>',
};
const spotifyIcon = (name: string) => (typeof Spicetify !== "undefined" && (Spicetify.SVGIcons as Record<string, string> | undefined)?.[name]) || FALLBACK_ICON[name] || "";

function SaveToLikedSongs({ uri, name, saved, onSavedChange, likedSongs, onSaved }: {
  uri: string;
  name: string;
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  likedSongs: LikedSongs;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const saving = !saved;
    onSavedChange(saving);
    try {
      if (saving) {
        await likedSongs.save(uri);
        onSaved();
        Spicetify.showNotification(`Added ${name} to Liked Songs`);
      } else {
        await likedSongs.remove(uri);
        Spicetify.showNotification(`Removed ${name} from Liked Songs`);
      }
    } catch {
      onSavedChange(!saving);
      Spicetify.showNotification(saving ? `Spotify couldn't add ${name} to Liked Songs. Please try again.` : `Spotify couldn't remove ${name} from Liked Songs. Please try again.`, true);
    } finally {
      setBusy(false);
    }
  };
  const label = saved ? "Remove from Liked Songs" : "Add to Liked Songs";
  return (
    <button type="button" className={`${styles.like} ${saved ? styles.liked : ""}`} aria-pressed={saved} aria-label={`${label}: ${name}`} title={label}
      onClick={() => void toggle()} disabled={busy}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"
        dangerouslySetInnerHTML={{ __html: spotifyIcon(saved ? LIKED_ICON.added : LIKED_ICON.add) }} />
    </button>
  );
}

/** The track list's tag filter as a Community search: every included tag, "all" only for one AND group. */
export function tagSearchQuery(clauses: readonly { tagIds: string[]; operator: string }[], nameOf: (tagId: string) => string): { tags: string[]; match: TagSearchMatch } {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const clause of clauses) for (const id of clause.tagIds) {
    const name = nameOf(id).trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    tags.push(name);
  }
  const match: TagSearchMatch = clauses.length === 1 && clauses[0].operator === "AND" && tags.length > 1 ? "all" : "any";
  return { tags: tags.slice(0, TAG_SEARCH_MAX_TAGS), match };
}

/** "On Community" for the track list: asks Community while a tag filter is on. */
export function CommunityTagSearch({ search: given, ...props }: Omit<CommunityTagResultsProps, "search"> & { viewer: string; search?: CommunityTagSearchState }) {
  return given ? <CommunityTagResults {...props} search={given} /> : <AskCommunity {...props} />;
}

function AskCommunity({ tags, match, viewer, ...rest }: Omit<CommunityTagResultsProps, "search"> & { viewer: string }) {
  const search = useCommunityTagSearch({ tags, match, enabled: tags.length > 0, viewer });
  return <CommunityTagResults tags={tags} match={match} search={search} {...rest} />;
}
