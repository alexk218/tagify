import { useCallback, useEffect, useMemo, useState } from "react";
import { COMMUNITY_UPDATES_CHECKED_EVENT, communityUpdateService } from "@/features/community-updates/communityUpdateService";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { countSongsFirstTaggedInYear } from "@/features/library-stats/model/libraryStats";
import type { TagDataStructure } from "@/types/tagData";
import { isAnotherDialogOpen } from "@/utils/openDialogs";
import { recordRewindPromptOpened, recordRewindPromptShown } from "./rewindAnalytics";
import { answerRewindPrompt, isRewindPromptAnswered, isRewindPromptSeason, REWIND_MIN_SONGS, REWIND_YEAR } from "./rewindPromptRules";

/** Delay after other dialogs close, so the prompt never flashes between two of them. */
const SETTLE_MS = 1000;
/** How often an open Tagify rechecks the date, so the prompt starts and ends without a restart. */
const CLOCK_MS = 10 * 60 * 1000;

export interface RewindPromptState {
  /**
   * The prompt applies to this account, or may once Community's feed has answered. The Community
   * invitations wait while this holds, so two banners never stack or swap places.
   */
  holdsPlace: boolean;
  /** The prompt is on screen. */
  shown: boolean;
  /** Songs first tagged this year, counted on this device. */
  songs: number;
  /** "Not now": the prompt is never shown again for this account on this device. */
  dismiss: () => void;
  /** The button was pressed: counted, and the prompt is never shown again. */
  open: () => void;
}

function readFeed() {
  return { open: communityUpdateService.isRewindOpen(REWIND_YEAR), checked: communityUpdateService.hasChecked() };
}

/**
 * When "Your Rewind 2026 is ready" may show: between noon UTC on December 8 and the end of
 * December 31, only once Community's update feed (which every Tagify already reads) says Rewind is
 * open, only for a year of at least 20 songs, and only until it is answered. The number is counted
 * here; nothing about the library is sent.
 */
export function useRewindPrompt({ enabled, tracks }: { enabled: boolean; tracks: TagDataStructure["tracks"] }): RewindPromptState {
  // Null until the Spotify account is identified, and for the session if it can't be.
  const [accountDigest, setAccountDigest] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [visible, setVisible] = useState(false);
  const [inSeason, setInSeason] = useState(() => isRewindPromptSeason(Date.now()));
  const [feed, setFeed] = useState(readFeed);

  useEffect(() => {
    let active = true;
    void getUsageAccountDigest().then((digest) => {
      if (!active) return;
      setAccountDigest(digest);
      if (digest) setAnswered(isRewindPromptAnswered(digest));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const read = () => {
      setInSeason(isRewindPromptSeason(Date.now()));
      setFeed(readFeed());
    };
    const clock = setInterval(read, CLOCK_MS);
    window.addEventListener(COMMUNITY_UPDATES_CHECKED_EVENT, read);
    read();
    return () => {
      clearInterval(clock);
      window.removeEventListener(COMMUNITY_UPDATES_CHECKED_EVENT, read);
    };
  }, []);

  const candidate = inSeason && Boolean(accountDigest) && !answered && (feed.open || !feed.checked);
  // The library is only counted while the prompt could show.
  const songs = useMemo(() => (candidate ? countSongsFirstTaggedInYear(tracks, REWIND_YEAR) : 0), [candidate, tracks]);
  const holdsPlace = candidate && songs >= REWIND_MIN_SONGS;
  const waiting = holdsPlace && feed.open && enabled;

  useEffect(() => {
    if (!waiting) {
      setVisible(false);
      return;
    }
    if (visible) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryShowing = () => {
      if (document.visibilityState !== "visible" || isAnotherDialogOpen()) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (!timer) timer = setTimeout(() => setVisible(true), SETTLE_MS);
    };
    // Observe only while the prompt is waiting behind another dialog.
    const observer = new MutationObserver(tryShowing);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", tryShowing);
    tryShowing();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", tryShowing);
    };
  }, [waiting, visible]);

  const shown = waiting && visible;
  useEffect(() => {
    if (shown && accountDigest) recordRewindPromptShown(accountDigest);
  }, [shown, accountDigest]);

  const answer = useCallback(() => {
    if (accountDigest) answerRewindPrompt(accountDigest);
    setAnswered(true);
  }, [accountDigest]);
  const openRewind = useCallback(() => {
    recordRewindPromptOpened();
    answer();
  }, [answer]);

  return { holdsPlace, shown, songs, dismiss: answer, open: openRewind };
}
