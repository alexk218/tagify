import { useEffect, useRef } from "react";
import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { spotifyAccountKey, throwIfSpotifyRequestStopped } from "@/services/SpotifyRequests";
import { spotifyService } from "@/services/SpotifyService";
import { storageService } from "@/services/storage";
import type { TrackData } from "@/types/tagData";
import { normalizeReleaseDate, songDurationMs } from "@/utils/songDetails";

// Length and release year filters need each tagged song's length and its
// album's release date. Spotify's desktop app gives both in one GraphQL
// getTrack read (verified in SPOTIFY_ENDPOINT_POLICY.md; no Web API). Reads
// run in the background under their own hourly allowance, newest edits
// first, and stop at Spotify's first request to wait. Only these details are
// written: tags, ratings and dateModified are never touched, so Last Updated
// ordering stays the same.

export const SONG_DETAILS_FEATURE = "song-details";
/** Background reads this fill may make in an hour (SpotifyBackgroundPolicy keeps at most 200). */
export const SONG_DETAILS_HOURLY_READS = 150;
export const MAX_SONG_DETAILS_ATTEMPTS = 3;
/** A song Tagify gave up on gets one more try this long after its last one: Spotify may know it by then. */
export const SONG_DETAILS_RETRY_AFTER_MS = 30 * 24 * 60 * 60_000;
const SAVE_EVERY = 25;
const RUN_INTERVAL_MS = 10 * 60_000;
const FIRST_RUN_DELAY_MS = 30_000;

export interface SongDetailsFillResult {
  updated: number;
  reads: number;
  remaining: number;
  stopped?: "budget" | "paused" | "account" | "cancelled";
}

export function needsSongDetails(uri: string, track: TrackData, now = Date.now()): boolean {
  if (!uri.startsWith("spotify:track:")) return false;
  if (songDurationMs(track.durationMs) !== null && normalizeReleaseDate(track.releaseDate) !== null) return false;
  if ((track.songDetailsAttempts ?? 0) < MAX_SONG_DETAILS_ATTEMPTS) return true;
  // Given up for now: try again a month after the last try. Songs given up on before Tagify kept
  // that date have none, so they get their next try now.
  const checkedAt = track.songDetailsCheckedAt;
  return typeof checkedAt !== "number" || now - checkedAt >= SONG_DETAILS_RETRY_AFTER_MS;
}

/** The track with any newly found details; undefined when nothing changed. */
export function withSongDetails(
  track: TrackData,
  details: { durationMs?: unknown; releaseDate?: unknown } | null,
  now = Date.now(),
): TrackData | undefined {
  const next: TrackData = { ...track };
  const durationMs = songDurationMs(details?.durationMs);
  const date = normalizeReleaseDate(details?.releaseDate);
  if (songDurationMs(next.durationMs) === null && durationMs !== null) next.durationMs = durationMs;
  if (normalizeReleaseDate(next.releaseDate) === null && date !== null) next.releaseDate = date;
  if (songDurationMs(next.durationMs) === null || normalizeReleaseDate(next.releaseDate) === null) {
    next.songDetailsAttempts = (next.songDetailsAttempts ?? 0) + 1;
    next.songDetailsCheckedAt = now;
  } else {
    delete next.songDetailsAttempts;
    delete next.songDetailsCheckedAt;
  }
  const changed = next.durationMs !== track.durationMs || next.releaseDate !== track.releaseDate ||
    next.songDetailsAttempts !== track.songDetailsAttempts || next.songDetailsCheckedAt !== track.songDetailsCheckedAt;
  return changed ? next : undefined;
}

export interface RunSongDetailsFillOptions {
  paceMs?: number;
  isCurrent?: () => boolean;
  /** Called after each batch of found details is saved, so they show up without waiting for the whole run. */
  onSaved?: () => void;
}

export async function runSongDetailsFill({ paceMs = 2_000, isCurrent = () => true, onSaved }: RunSongDetailsFillOptions = {}): Promise<SongDetailsFillResult> {
  if (!storageService.isReady()) await storageService.initialize();
  const account = spotifyAccountKey();
  const tagData = await storageService.loadAll();
  if (!tagData) return { updated: 0, reads: 0, remaining: 0 };

  const candidates = Object.entries(tagData.tracks)
    .filter(([uri, track]) => needsSongDetails(uri, track))
    .sort(([, a], [, b]) => (b.dateModified ?? 0) - (a.dateModified ?? 0));
  const result: SongDetailsFillResult = { updated: 0, reads: 0, remaining: candidates.length };
  let pending = new Map<string, TrackData>();
  const save = async () => {
    if (!pending.size) return;
    const batch = pending;
    pending = new Map();
    // Applies only these fields on top of the current saved record, so edits made meanwhile are kept.
    await storageService.saveTracks(batch, tagData.tracks, { keepConcurrentChanges: true });
    result.updated += batch.size;
    if (isCurrent()) onSaved?.();
  };

  try {
    for (const [uri, track] of candidates) {
      if (!isCurrent()) { result.stopped = "cancelled"; break; }
      if (spotifyAccountKey() !== account) { result.stopped = "account"; break; }
      if (!spotifyBackgroundPolicy.reserve(SONG_DETAILS_FEATURE, uri, SONG_DETAILS_HOURLY_READS)) {
        result.stopped = spotifyBackgroundPolicy.retryAt() > Date.now() ? "paused" : "budget";
        break;
      }
      let details: { durationMs?: unknown; releaseDate?: unknown } | null = null;
      let answered = true;
      try {
        const info = await spotifyService.getTrack(uri, undefined, "background", SONG_DETAILS_FEATURE);
        details = info ? { durationMs: info.duration_ms, releaseDate: info.releaseDate } : null;
      } catch (error) {
        throwIfSpotifyRequestStopped(error);
        // A failed read (network, timeout) says nothing about the song, so it
        // doesn't use up one of the song's tries; a later run reads it again.
        answered = false;
        console.warn(`[SongDetails] Lookup failed for ${uri}:`, error);
      }
      result.reads += 1;
      result.remaining -= 1;
      if (spotifyAccountKey() !== account) { result.stopped = "account"; break; }
      const next = answered ? withSongDetails(track, details) : undefined;
      if (next) pending.set(uri, next);
      if (pending.size >= SAVE_EVERY) await save();
      if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
  } catch (error) {
    // Spotify asked Tagify to wait, or the request was stopped: keep what was found.
    result.stopped = "paused";
    if ((error as { name?: string })?.name !== "AbortError") console.warn("[SongDetails] Paused:", error);
  } finally {
    if (spotifyAccountKey() === account) await save();
  }
  return result;
}

/**
 * Fills in song lengths and release dates in the background while Tagify is
 * open, a little at a time, and calls onUpdated after each batch it saves.
 */
export function useSongDetailsFill({ enabled, onUpdated }: { enabled: boolean; onUpdated: () => void }): void {
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;
    const run = async () => {
      if (running || !active) return;
      running = true;
      try {
        await runSongDetailsFill({ isCurrent: () => active, onSaved: () => onUpdatedRef.current() });
      } catch (error) {
        console.error("[SongDetails] Fill failed:", error);
      } finally {
        running = false;
      }
    };
    const first = setTimeout(() => void run(), FIRST_RUN_DELAY_MS);
    const interval = setInterval(() => void run(), RUN_INTERVAL_MS);
    return () => {
      active = false;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [enabled]);
}
