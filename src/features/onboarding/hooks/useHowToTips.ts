import { useCallback, useEffect, useState } from "react";
import {
  markTipDone,
  updateFirstRunTips,
  useFirstRunTipsState,
  type HowToTipId,
} from "../firstRunTips";
import { HOW_TO_PLAYLIST_MADE, playlistMadeWithTips, tipsStartedAt } from "../howToTips";

/** The first session's first minute is for the tour only. */
export const HOW_TO_WAIT_MS = 60_000;
/** The playlist tip waits until one tag is on this many songs, so a filter has something to show. */
export const HOW_TO_PLAYLIST_SONGS = 5;

export interface HowToTipsInput {
  /** Same as the tour: loading and every other prompt are out of the way, and the song list is open. */
  enabled: boolean;
  /** A tour tip is waiting or on screen; it always goes first. */
  coreTipPending: boolean;
  /** The most songs any one tag is on. */
  mostSongsOnOneTag: number;
  smartPlaylists: number;
}

/**
 * Later tips (docs/ONBOARDING_FIRST_RUN_PLAN_2026-11.md, 10.2): after the tour, each once per device,
 * at the moment it helps: a playlist from tags once 5 songs share a tag, Smart Playlists after the first
 * playlist (rating is part of the tour). Doing the thing finishes a tip whether or not it was
 * on screen. They share the tour's saved state, so Skip tips and Show tips again cover them.
 */
export function useHowToTips(input: HowToTipsInput): HowToTipId | null {
  const state = useFirstRunTipsState();
  const [playlistMade, setPlaylistMade] = useState(playlistMadeWithTips);
  const [startedAt] = useState(() => tipsStartedAt());
  const [waited, setWaited] = useState(() => Date.now() - startedAt >= HOW_TO_WAIT_MS);

  useEffect(() => {
    const made = () => setPlaylistMade(true);
    window.addEventListener(HOW_TO_PLAYLIST_MADE, made);
    return () => window.removeEventListener(HOW_TO_PLAYLIST_MADE, made);
  }, []);

  useEffect(() => {
    if (waited) return undefined;
    const timer = window.setTimeout(() => setWaited(true), Math.max(0, startedAt + HOW_TO_WAIT_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [waited, startedAt]);

  const finish = useCallback((tip: HowToTipId) => updateFirstRunTips((current) => markTipDone(current, tip, "action")), []);
  const { smartPlaylists } = input;
  useEffect(() => { if (playlistMade) finish("playlist"); }, [playlistMade, finish]);
  useEffect(() => { if (smartPlaylists > 0) finish("smart"); }, [smartPlaylists, finish]);

  if (!input.enabled || input.coreTipPending || !waited || state.skipped) return null;
  // Like the tour, only where the tips started (or were asked for again), so a library from before
  // the tips gets none.
  if (!state.again && !state.shown.includes("play") && !state.shown.includes("rate") && !state.shown.includes("tag")) return null;
  const ready: Record<HowToTipId, boolean> = {
    // What the library holds, not songs tagged since: a filter needs songs to show either way.
    playlist: input.mostSongsOnOneTag >= HOW_TO_PLAYLIST_SONGS,
    smart: playlistMade,
  };
  return (Object.keys(ready) as HowToTipId[]).find((tip) => ready[tip] && !state.done[tip]) ?? null;
}
