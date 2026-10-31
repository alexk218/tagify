import React, { useEffect, useRef, useState } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import styles from "./FirstSongCard.module.css";

const SUGGESTION_COUNT = 6;
const SHOWN_DAY_KEY = "tagify:first-run-shown-day";

interface FirstSongCardProps {
  // The song Spotify is playing or last played, when there is one.
  currentTrack: SpotifyTrack | null;
  onPick: (uri: string) => void;
}

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

export function FirstSongCard({ currentTrack, onPick }: FirstSongCardProps) {
  const [suggestions, setSuggestions] = useState<Suggestions>({ status: "loading" });
  const reported = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    spotifyApiService.getTaggingQueuePage(null, 0, controller.signal)
      .then((page) => setSuggestions({
        status: "ready",
        tracks: page.tracks.filter((track) => track.uri.startsWith("spotify:track:")).slice(0, SUGGESTION_COUNT),
      }))
      .catch(() => { if (!controller.signal.aborted) setSuggestions({ status: "unavailable" }); });
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

  const pick = (uri: string, source: "liked" | "playing") => {
    recordProductInteraction("first_run_song_picked", { first_run_source: source });
    onPick(uri);
  };

  return (
    <section className={styles.card} aria-label="Tag your first song">
      <div className={styles.header}>
        <h2 className={styles.title}>Tag your first song</h2>
        <p className={styles.description}>
          Tags like a mood, genre or moment let you find the right songs later and turn them into playlists.
        </p>
      </div>
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
    </section>
  );
}
