import { useCallback, useEffect, useRef, useState } from "react";
import type { UserTrackAddedEvent } from "@/features/tag-data";
import { usePromptHistory } from "@/features/onboarding/hooks/usePromptHistory";
import { LEGACY_PROMPT_OWNER_KEY } from "@/features/onboarding/services/promptHistory";
import { recordDiscoveryAnswer } from "../services/tagifyUsage";

export interface DiscoverySurveyState {
  hasCompletedSurvey: boolean;
  hasDismissedSurvey?: boolean;
  surveyVersion: string;
  completedAt?: string;
  source?: string;
  otherDetails?: string;
  skipCount?: number;
  lastSkippedAt?: string;
  taggedSongUris?: string[];
}

export interface UseDiscoverySurveyReturn {
  shouldShowSurvey: boolean;
  completeSurvey: (source: string, otherDetails?: string) => void;
  skipSurvey: () => void;
  skipCount: number;
}

const SURVEY_STORAGE_KEY = "tagify:discoverySurvey";
const SONG_THRESHOLD = 5;

function readSurveyState(currentVersion: string, storageKey = SURVEY_STORAGE_KEY, accountDigest: string | null = null): DiscoverySurveyState {
  try {
    const ownedLegacy = accountDigest && localStorage.getItem(LEGACY_PROMPT_OWNER_KEY) === accountDigest
      ? localStorage.getItem(SURVEY_STORAGE_KEY) : null;
    const raw = localStorage.getItem(storageKey) || ownedLegacy;
    if (raw) {
      const saved = JSON.parse(raw) as DiscoverySurveyState;
      if (saved && typeof saved === "object") return {
        ...saved,
        taggedSongUris: Array.isArray(saved.taggedSongUris)
          ? [...new Set(saved.taggedSongUris.filter((uri) => typeof uri === "string"))].slice(0, SONG_THRESHOLD)
          : [],
      };
    }
  } catch { /* A fresh milestone can still be tracked if saved state is unavailable. */ }
  return { hasCompletedSurvey: false, surveyVersion: currentVersion, taggedSongUris: [] };
}

function saveState(state: DiscoverySurveyState, storageKey: string) {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { /* Keep the current session usable if Spotify blocks local storage. */ }
}

export function useDiscoverySurvey(
  currentVersion: string,
  { lastUserTrackAddedEvent = null, canShowSurvey = true }: {
    lastUserTrackAddedEvent?: UserTrackAddedEvent | null;
    canShowSurvey?: boolean;
  } = {},
): UseDiscoverySurveyReturn {
  const promptHistory = usePromptHistory();
  const storageKey = promptHistory.accountDigest ? `${SURVEY_STORAGE_KEY}:${promptHistory.accountDigest}` : SURVEY_STORAGE_KEY;
  const [savedState, setSavedState] = useState(() => ({ storageKey, state: readSurveyState(currentVersion, storageKey, promptHistory.accountDigest) }));
  const state = savedState.storageKey === storageKey ? savedState.state : readSurveyState(currentVersion, storageKey, promptHistory.accountDigest);
  const setState = useCallback((next: DiscoverySurveyState) => setSavedState({ storageKey, state: next }), [storageKey]);
  const lastHandledEvent = useRef<UserTrackAddedEvent | null>(null);
  const pendingTrackUris = useRef<string[]>([]);
  const skipCount = state.skipCount ?? 0;
  const dismissed = promptHistory.discoverySurveyDismissed || state.hasCompletedSurvey || state.hasDismissedSurvey || skipCount > 0;

  useEffect(() => {
    if (lastUserTrackAddedEvent && lastHandledEvent.current !== lastUserTrackAddedEvent) {
      lastHandledEvent.current = lastUserTrackAddedEvent;
      pendingTrackUris.current = [...new Set([...pendingTrackUris.current, ...(lastUserTrackAddedEvent.trackUris ?? [])])].slice(0, SONG_THRESHOLD);
    }
    // Keep the milestone intact while Spotify resolves the account at startup.
    if (!promptHistory.accountDigest && !promptHistory.ready) return;
    if (!pendingTrackUris.current.length) return;
    const addedUris = pendingTrackUris.current;
    pendingTrackUris.current = [];
    if (dismissed || (state.taggedSongUris?.length ?? 0) >= SONG_THRESHOLD) return;
    const taggedSongUris = [...new Set([
      ...(state.taggedSongUris ?? []), ...addedUris,
    ])].slice(0, SONG_THRESHOLD);
    if (taggedSongUris.length === state.taggedSongUris?.length) return;
    const next = { ...state, taggedSongUris };
    saveState(next, storageKey);
    setState(next);
  }, [dismissed, lastUserTrackAddedEvent, state, storageKey, setState, promptHistory.accountDigest, promptHistory.ready]);

  const completeSurvey = (source: string, otherDetails?: string): void => {
    const next: DiscoverySurveyState = {
      ...state, hasCompletedSurvey: true, surveyVersion: currentVersion,
      completedAt: new Date().toISOString(), source, otherDetails, skipCount,
    };
    saveState(next, storageKey);
    setState(next);
    promptHistory.markSeen("discoverySurveyDismissed");
    void recordDiscoveryAnswer(currentVersion, { source, otherDetails }, promptHistory.accountDigest);
  };

  const skipSurvey = (): void => {
    const next: DiscoverySurveyState = {
      ...state, hasDismissedSurvey: true, surveyVersion: currentVersion,
      skipCount: skipCount + 1, lastSkippedAt: new Date().toISOString(),
    };
    saveState(next, storageKey);
    setState(next);
    promptHistory.markSeen("discoverySurveyDismissed");
  };

  return {
    shouldShowSurvey: Boolean(promptHistory.ready && canShowSurvey && !dismissed && (state.taggedSongUris?.length ?? 0) >= SONG_THRESHOLD),
    completeSurvey, skipSurvey, skipCount,
  };
}
