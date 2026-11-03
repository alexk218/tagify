import React, { useEffect, useRef, useState } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { findCommunityMatches, type CommunityMatch, type CommunityMatchTag } from "../services/communityMatches";
import { CommunityMatches } from "./CommunityMatches";
import styles from "./FirstSongCard.module.css";

const SUGGESTION_COUNT = 6;
const SHOWN_DAY_KEY = "tagify:first-run-shown-day";

interface FirstSongCardProps {
  // The song Spotify is playing or last played, when there is one.
  currentTrack: SpotifyTrack | null;
  onPick: (uri: string) => void;
  /** "What do you listen to?" on a fresh install, below the songs to pick from. */
  tastePacks?: React.ReactNode;
  /** Adds members' tags to a song; without it the card doesn't ask Community about the songs. */
  onAddMembersTags?: (match: CommunityMatch, tags: CommunityMatchTag[], source: "tag" | "all") => Promise<void>;
}

type MembersMatches = { status: "checking" } | { status: "ready"; matches: CommunityMatch[] };

const matchesBucket = (count: number) => (count === 0 ? "0" : count < 5 ? "1-4" : count < 15 ? "5-14" : "15+");

type Suggestions = { status: "loading" } | { status: "ready"; tracks: SpotifyTrack[] } | { status: "unavailable" };

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

// "What do you listen to?" is reported once per Spotify session, however often the card is drawn again.
let tastePacksReported = false;

export function FirstSongCard({ currentTrack, onPick, tastePacks, onAddMembersTags }: FirstSongCardProps) {
  const [suggestions, setSuggestions] = useState<Suggestions>({ status: "loading" });
  const [members, setMembers] = useState<MembersMatches>({ status: "checking" });
  const reported = useRef(false);
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

  const showsTastePacks = !!tastePacks;
  useEffect(() => {
    if (!showsTastePacks || tastePacksReported) return;
    tastePacksReported = true;
    recordProductInteraction("taste_packs_shown");
  }, [showsTastePacks]);

  const pick = (uri: string, source: "liked" | "playing") => {
    recordProductInteraction("first_run_song_picked", { first_run_source: source });
    onPick(uri);
  };

  const matches = members.status === "ready" ? members.matches : [];
  const addMembersTags = async (match: CommunityMatch, tags: CommunityMatchTag[], source: "tag" | "all") => {
    await onAddMembersTags?.(match, tags, source);
    recordProductInteraction("first_run_members_tag_added", { members_add: source });
  };
  const membersSection = matches.length > 0 && onAddMembersTags && (
    <CommunityMatches matches={matches} onAdd={addMembersTags} coverOf={(match) => coverOf(match.track)} />
  );

  return (
    <section className={styles.card} aria-label="Tag your first song">
      <div className={styles.header}>
        <h2 className={styles.title}>Tag your first song</h2>
        <p className={styles.description}>
          Tags like a mood, genre or moment let you find the right songs later and turn them into playlists.
        </p>
      </div>
      {membersSection}
      {suggestions.status === "loading" && (
        <div className={styles.list} aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className={styles.skeleton} />)}
        </div>
      )}
      {liked.length > 0 && (
        <div className={styles.list}>
          <span className={styles.listLabel}>From your Liked Songs</span>
          {liked.map((track) => (
            <button key={track.uri} type="button" className={styles.row} onClick={() => pick(track.uri, "liked")}>
              {coverOf(track) ? <img src={coverOf(track)} alt="" className={styles.rowCover} /> : <span className={styles.rowCover} />}
              <span className={styles.songText}>
                <span className={styles.songName}>{track.name}</span>
                <span className={styles.songArtist}>{artistNames(track)}</span>
              </span>
              <span className={styles.secondary}>Tag</span>
            </button>
          ))}
        </div>
      )}
      {fallback && playing && (
        <button type="button" className={styles.playing} onClick={() => pick(playing.uri, "playing")}>
          {coverOf(playing) ? <img src={coverOf(playing)} alt="" className={styles.playingCover} /> : <span className={styles.playingCover} />}
          <span className={styles.songText}>
            <span className={styles.eyebrow}>From Spotify</span>
            <span className={styles.songName}>{playing.name}</span>
            <span className={styles.songArtist}>{artistNames(playing)}</span>
          </span>
          <span className={styles.primary}>Tag this song</span>
        </button>
      )}
      <p className={styles.footer}>
        {fallback && !playing
          ? "Play any song in Spotify and it appears here, ready to tag."
          : "Or play any song in Spotify to tag it instead."}
      </p>
      {tastePacks && (
        <div className={styles.tastePacks} role="group" aria-labelledby="tagify-taste-packs-label">
          <p className={styles.tastePacksLabel} id="tagify-taste-packs-label">
            <strong>What do you listen to?</strong> Pick the music you're into, and we'll add tags for it to Genre & Style.
          </p>
          {tastePacks}
        </div>
      )}
    </section>
  );
}
