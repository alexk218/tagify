import { useCallback, useEffect, useRef } from "react";
import {
  markTipDone,
  markTipShown,
  updateFirstRunTips,
  useFirstRunTipsState,
  type CoreTipId,
  type FirstRunTipId,
} from "../firstRunTips";

export interface FirstRunTipsInput {
  /** Tips wait for loading and every other prompt (`canShowOptionalPrompts`) and for the song list. */
  enabled: boolean;
  /** A song is in track details (playing or locked), so the tag picker and Manage Tags are on screen. */
  songShowing: boolean;
  /** A song is locked in track details: someone clicked one in the list. */
  songLocked: boolean;
  /** Songs with tags in the library. */
  taggedSongs: number;
  /** Songs with a rating or an energy in the library. */
  ratedSongs: number;
  /** Manage Tags is open. */
  tagManagerOpen: boolean;
  /** The Tagged by others tab is part of the song list. */
  othersTab: boolean;
}

export interface FirstRunTips {
  /** The one tour tip to show now, if any. */
  tip: CoreTipId | null;
  shown: (tip: FirstRunTipId) => void;
  gotIt: (tip: FirstRunTipId) => void;
  skip: (tip: FirstRunTipId) => void;
  /** The person did what the tip asks. */
  acted: (tip: FirstRunTipId) => void;
}

/**
 * The first-run tour (docs/ONBOARDING_FIRST_RUN_PLAN_2026-11.md, section 10), one tip after another:
 * play a song (1b, only when nothing plays), rate the playing song (1), tag it with its tag buttons
 * (2), Manage Tags (3), the Tagged Tracks list (4), and Tagged by others last (5). Each shows once per device; doing the thing or
 * "Got it" finishes it, and the next one follows straight away.
 */
export function useFirstRunTips({ enabled, songShowing, songLocked, taggedSongs, ratedSongs, tagManagerOpen, othersTab }: FirstRunTipsInput): FirstRunTips {
  const state = useFirstRunTipsState();
  // After "Show tips again", songs tagged before it don't count as doing the thing.
  const newlyTagged = Math.max(0, taggedSongs - (state.baseline ?? 0));

  useEffect(() => {
    if (state.again && state.baseline === undefined) updateFirstRunTips((current) => ({ ...current, baseline: taggedSongs }));
  }, [state.again, state.baseline, taggedSongs]);
  const waitingForBaseline = state.again && state.baseline === undefined;

  // Doing the thing finishes the tip, whether or not it was on screen.
  useEffect(() => {
    if (songShowing) updateFirstRunTips((current) => markTipDone(current, "play", "action"));
  }, [songShowing]);
  useEffect(() => {
    if (!waitingForBaseline && newlyTagged > 0) updateFirstRunTips((current) => markTipDone(markTipDone(current, "play", "action"), "tag", "action"));
  }, [waitingForBaseline, newlyTagged]);
  // Rating or energy given while the app is open finishes the rating tip.
  const ratedAtStart = useRef(ratedSongs);
  useEffect(() => {
    if (ratedSongs > ratedAtStart.current) updateFirstRunTips((current) => markTipDone(current, "rate", "action"));
  }, [ratedSongs]);
  useEffect(() => {
    if (tagManagerOpen) updateFirstRunTips((current) => markTipDone(current, "manage", "action"));
  }, [tagManagerOpen]);
  useEffect(() => {
    if (songLocked) updateFirstRunTips((current) => markTipDone(current, "tagged", "action"));
  }, [songLocked]);

  // The rest of the tour follows tip 1 only where tips started (or were asked for again), so a
  // library from before the tips never gets it.
  const started = state.again || state.shown.includes("play") || state.shown.includes("rate") || state.shown.includes("tag");
  let tip: CoreTipId | null = null;
  if (!state.skipped && !waitingForBaseline) {
    // A new person (nothing tagged yet) with a song showing: rating first (Alex, 2026-11-20: "2B: Rating first"), then the tag buttons.
    // A library that already has tagged songs (from before the tips) skips the tour, even for the one
    // render before the effect above marks its tag tip done.
    const nothingTagged = newlyTagged === 0;
    if (!state.done.tag && nothingTagged && songShowing) tip = state.done.rate ? "tag" : "rate";
    else if (!state.done.tag && nothingTagged && !state.done.play) tip = "play";
    else if (started) {
      // Rating, Manage Tags (and the tag buttons) need a song in track details; after "Got it" on "Play any song"
      // the list tips go ahead, and those two come once a song plays. Tagged by others is always last.
      const tour: Array<[CoreTipId, boolean]> = [
        ["rate", songShowing],
        ["manage", songShowing],
        ["tagged", true],
        ["others", othersTab],
      ];
      tip = tour.find(([id, ready]) => ready && !state.done[id])?.[0] ?? null;
    }
  }

  const shown = useCallback((id: FirstRunTipId) => updateFirstRunTips((current) => markTipShown(current, id)), []);
  const gotIt = useCallback((id: FirstRunTipId) => updateFirstRunTips((current) => markTipDone(current, id, "got_it")), []);
  const skip = useCallback((id: FirstRunTipId) => updateFirstRunTips((current) => markTipDone(current, id, "skipped")), []);
  const acted = useCallback((id: FirstRunTipId) => updateFirstRunTips((current) => markTipDone(current, id, "action")), []);

  return { tip: enabled ? tip : null, shown, gotIt, skip, acted };
}

