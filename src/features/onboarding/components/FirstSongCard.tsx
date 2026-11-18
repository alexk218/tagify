import React, { useEffect, useRef, useState } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { findCommunityMatches, type CommunityMatch, type CommunityMatchTag } from "../services/communityMatches";
import { PAYOFF_MIN_TAGGED } from "../services/firstRun";
import { CommunityMatches } from "./CommunityMatches";
// eslint-disable-next-line css-modules/no-unused-class -- shared by the first-song card and its payoff
import styles from "./FirstSongCard.module.css";

/** Liked Songs read at once: three are shown, and the whole page goes to the members' check. */
const SUGGESTION_COUNT = 6;
const SHOWN_COUNT = 3;
const SHOWN_DAY_KEY = "tagify:first-run-shown-day";

interface FirstSongCardProps {
  // The song Spotify is playing or last played, when there is one.
  currentTrack: SpotifyTrack | null;
  /** Opens a song in the tag picker, for tags beyond the one-click ones. */
  onPick: (uri: string) => void;
  /** A few of the member's own tags, each added to a song with one click. */
  quickTags: { id: string; name: string }[];
  tagIdsOf: (uri: string) => readonly string[];
  onQuickTag: (track: SpotifyTrack, tagId: string, add: boolean) => Promise<void>;
  /** Songs tagged so far, for "1 of 3 tagged". */
  taggedSongs: number;
  /** Adds members' tags to a song; without it the card doesn't ask Community about the songs. */
  onAddMembersTags?: (match: CommunityMatch, tags: CommunityMatchTag[], source: "tag" | "all") => Promise<void>;
  /** Opens the Community view, where the whole library is checked; without it the line isn't shown. */
  onSeeAllMembersTags?: () => void;
}

type MembersMatches = { status: "checking" } | { status: "ready"; matches: CommunityMatch[] };
type Suggestions = { status: "loading" } | { status: "ready"; tracks: SpotifyTrack[] } | { status: "unavailable" };
type Source = "liked" | "playing";

const matchesBucket = (count: number) => (count === 0 ? "0" : count < 5 ? "1-4" : count < 15 ? "5-14" : "15+");
const artistNames = (track: SpotifyTrack) => track.artists.map((artist) => artist.name).join(", ");
// Spotify's player gives desktop image IDs; the Liked Songs list gives web addresses.
const coverOf = (track: SpotifyTrack) => {
  // The playing song carries no album images, so ask Spotify's player for that song's cover.
  const playerItem = (Spicetify.Player?.data as { item?: { uri?: string; metadata?: { image_url?: string } } } | undefined)?.item;
  const url = track.album?.images?.[0]?.url ??
    (playerItem?.uri === track.uri ? playerItem.metadata?.image_url : undefined) ?? "";
  if (url.startsWith("spotify:image:")) return `https://i.scdn.co/image/${url.slice("spotify:image:".length)}`;
  return url.startsWith("https://") ? url : undefined;
};

/** The card stays until a first song is tagged, so it is reported at most once a day on this device. */
function recordShown(likedSongs: number, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(SHOWN_DAY_KEY) === day) return;
    localStorage.setItem(SHOWN_DAY_KEY, day);
  } catch { /* Reporting without the reminder only risks a repeat count. */ }
  recordProductInteraction("first_run_shown", { liked_songs: likedSongs > 0 ? "1+" : "0" });
}

/** "Tag your first song": three songs, each tagged right here with one click, until the payoff. */
export function FirstSongCard({
  currentTrack, onPick, quickTags, tagIdsOf, onQuickTag, taggedSongs, onAddMembersTags, onSeeAllMembersTags,
}: FirstSongCardProps) {
  const [suggestions, setSuggestions] = useState<Suggestions>({ status: "loading" });
  const [members, setMembers] = useState<MembersMatches>({ status: "checking" });
  const [busyUri, setBusyUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reported = useRef(false);
  const pickedReported = useRef(new Set<string>());
  const asksMembers = useRef(!!onAddMembersTags);

  useEffect(() => {
    const controller = new AbortController();
    spotifyApiService.getTaggingQueuePage(null, 0, controller.signal)
      .then((page) => {
        const songs = page.tracks.filter((track) => track.uri.startsWith("spotify:track:"));
        setSuggestions({ status: "ready", tracks: songs.slice(0, SUGGESTION_COUNT) });
        if (!asksMembers.current || !songs.length) { setMembers({ status: "ready", matches: [] }); return; }
        // Liked Songs asked anonymously, newest first; further pages are read only while too few
        // songs carry tags several members agree on.
        let nextOffset = page.nextOffset;
        const loadMore = async () => {
          if (nextOffset === null) return null;
          const more = await spotifyApiService.getTaggingQueuePage(null, nextOffset, controller.signal);
          nextOffset = more.nextOffset;
          return more.tracks.filter((track) => track.uri.startsWith("spotify:track:"));
        };
        return findCommunityMatches(songs, { loadMore, signal: controller.signal }).then((matches) => {
          if (controller.signal.aborted) return;
          setMembers({ status: "ready", matches });
          recordProductInteraction("first_run_members_checked", { members_matches: matchesBucket(matches.length) });
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSuggestions((current) => (current.status === "loading" ? { status: "unavailable" } : current));
        setMembers({ status: "ready", matches: [] });
      });
    return () => controller.abort();
  }, []);

  const liked = suggestions.status === "ready" ? suggestions.tracks : [];
  const playing = currentTrack?.uri.startsWith("spotify:track:") ? currentTrack : null;
  const fallback = suggestions.status !== "loading" && liked.length === 0;

  useEffect(() => {
    if (suggestions.status === "loading" || reported.current) return;
    reported.current = true;
    recordShown(liked.length);
  }, [suggestions.status, liked.length]);

  // A song counts as picked once: when it is first tagged here or opened in the tag picker.
  const reportPicked = (uri: string, source: Source) => {
    if (pickedReported.current.has(uri)) return;
    pickedReported.current.add(uri);
    recordProductInteraction("first_run_song_picked", { first_run_source: source });
  };
  const open = (uri: string, source: Source) => {
    reportPicked(uri, source);
    onPick(uri);
  };
  const toggle = async (track: SpotifyTrack, tagId: string, source: Source) => {
    if (busyUri) return;
    const on = tagIdsOf(track.uri).includes(tagId);
    setBusyUri(track.uri);
    setError(null);
    try {
      await onQuickTag(track, tagId, !on);
      if (!on) reportPicked(track.uri, source);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Tagify couldn't add that tag. Please try again.");
    } finally {
      setBusyUri(null);
    }
  };

  const matches = members.status === "ready" ? members.matches : [];
  const addMembersTags = async (match: CommunityMatch, tags: CommunityMatchTag[], source: "tag" | "all") => {
    await onAddMembersTags?.(match, tags, source);
    recordProductInteraction("first_run_members_tag_added", { members_add: source });
  };
  const membersSection = matches.length > 0 && onAddMembersTags && (
    <CommunityMatches matches={matches} onAdd={addMembersTags} coverOf={(match) => coverOf(match.track)} />
  );

  const songRow = (track: SpotifyTrack, source: Source) => (
    <div key={track.uri} className={styles.tagRow}>
      {coverOf(track) ? <img src={coverOf(track)} alt="" className={styles.rowCover} /> : <span className={styles.rowCover} />}
      <span className={styles.songText}>
        {source === "playing" ? <span className={styles.eyebrow}>From Spotify</span> : null}
        <span className={styles.songName}>{track.name}</span>
        <span className={styles.songArtist}>{artistNames(track)}</span>
      </span>
      <div className={styles.chips} role="group" aria-label={`Tags for ${track.name}`}>
        {quickTags.map((tag) => {
          const on = tagIdsOf(track.uri).includes(tag.id);
          return (
            <button key={tag.id} type="button" aria-pressed={on} className={`${styles.chip} ${on ? styles.chipOn : ""}`}
              disabled={busyUri === track.uri} onClick={() => void toggle(track, tag.id, source)}>
              {tag.name}
            </button>
          );
        })}
        <button type="button" className={styles.moreChip} onClick={() => open(track.uri, source)}>More tags</button>
      </div>
    </div>
  );

  return (
    <section className={styles.card} aria-label="Tag your first song">
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Tag your first song</h2>
        <span className={styles.progress} aria-live="polite">{Math.min(taggedSongs, PAYOFF_MIN_TAGGED)} of {PAYOFF_MIN_TAGGED} tagged</span>
      </div>
      {membersSection}
      {membersSection && onSeeAllMembersTags && (
        <p className={styles.seeAll}>
          Members may have tagged more of your library. <button type="button" className={styles.seeAllLink} onClick={onSeeAllMembersTags}>See all</button>
        </p>
      )}
      {suggestions.status === "loading" && (
        <div className={styles.list} aria-busy="true">
          {Array.from({ length: SHOWN_COUNT }, (_, index) => <div key={index} className={styles.skeleton} />)}
        </div>
      )}
      {liked.length > 0 && <div className={styles.list}>{liked.slice(0, SHOWN_COUNT).map((track) => songRow(track, "liked"))}</div>}
      {fallback && playing && <div className={styles.list}>{songRow(playing, "playing")}</div>}
      {fallback && !playing && <p className={styles.footer}>Play any song in Spotify and it appears here, ready to tag.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
