import { trackEditHistory, draftTracks } from "@/services/TrackEditHistory";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SpotifyTrack } from "@/types/SpotifyTypes";
import { BatchTagUpdate, TrackTag } from "@/types/tagData";
import {
  calculateBatchChanges as calculateBatchChangesForDraft,
  createDraftTagState,
  findCommonEnergyRatingFromDraft as findCommonEnergyRatingFromDraftState,
  findCommonStarRatingFromDraft as findCommonStarRatingFromDraftState,
  findCommonTagsFromDraft as findCommonTagsFromDraftState,
  rebaseDraftTagState,
  toggleEnergyRatingDraftState,
  toggleStarRatingDraftState,
  toggleTagForAllTracksDraft,
  toggleTagForTrackDraft,
} from "@/features/multi-track-tagging/utils/multiTrackTagging.draft";
import {
  DraftTagState,
  UseMultiTrackTaggingOptions,
} from "@/features/multi-track-tagging/model/useMultiTrackTagging.types";

export function useMultiTrackTagging({ tagData }: UseMultiTrackTaggingOptions) {
  const latestTracksRef = useRef(tagData.tracks);
  latestTracksRef.current = tagData.tracks;
  const [isMultiTagging, setIsMultiTagging] = useState(false);
  const [lockedMultiTrackUri, setLockedMultiTrackUri] = useState<string | null>(
    null,
  );
  const [multiTrackDraftTags, setMultiTrackDraftTags] =
    useState<DraftTagState | null>(null);
  const [multiTagTracks, setMultiTagTracks] = useState<SpotifyTrack[]>([]);
  const draftBaselineRef = useRef<DraftTagState>({});
  const draftSelectionKeyRef = useRef<string | null>(null);

  const multiTrackUriSelectionKey = useMemo(
    () => JSON.stringify([...new Set(multiTagTracks.map((track) => track.uri))].sort()),
    [multiTagTracks],
  );

  const multiTrackUris = useMemo(() => {
    if (!multiTrackUriSelectionKey) {
      return [];
    }

    try {
      return JSON.parse(multiTrackUriSelectionKey) as string[];
    } catch {
      return [];
    }
  }, [multiTrackUriSelectionKey]);

  useLayoutEffect(() => {
    if (!isMultiTagging || multiTrackUris.length === 0) {
      draftSelectionKeyRef.current = null;
      draftBaselineRef.current = {};
      setMultiTrackDraftTags(null);
      return;
    }

    const latest = createDraftTagState(multiTrackUris, latestTracksRef.current);
    if (draftSelectionKeyRef.current !== multiTrackUriSelectionKey) {
      draftSelectionKeyRef.current = multiTrackUriSelectionKey;
      draftBaselineRef.current = latest;
      setMultiTrackDraftTags(latest);
      return;
    }

    const previousBaseline = draftBaselineRef.current;
    draftBaselineRef.current = latest;
    setMultiTrackDraftTags((current) =>
      current ? rebaseDraftTagState(previousBaseline, current, latest) : latest,
    );
  }, [isMultiTagging, multiTrackUriSelectionKey, multiTrackUris, tagData.tracks]);

  const recordDraft = useCallback((before: DraftTagState, after: DraftTagState) => {
    trackEditHistory.record(trackEditHistory.capture("bulk", multiTagTracks.map(track => track.uri)), draftTracks(before), draftTracks(after), "draft");
  }, [multiTagTracks]);

  const findCommonTagsFromDraft = useCallback(
    (draftTags: DraftTagState): TrackTag[] => findCommonTagsFromDraftState(draftTags),
    [],
  );

  const findCommonStarRatingFromDraft = useCallback(
    (draftTags: DraftTagState): number | undefined =>
      findCommonStarRatingFromDraftState(draftTags),
    [],
  );

  const findCommonEnergyRatingFromDraft = useCallback(
    (draftTags: DraftTagState): number | undefined =>
      findCommonEnergyRatingFromDraftState(draftTags),
    [],
  );

  const toggleTagMultiTrackDraft = useCallback(
    (tagId: string) => {
      if (trackEditHistory.getSnapshot().busy) return;
      if (!isMultiTagging) {
        console.warn("toggleTag called when not in multi-tagging mode");
        return;
      }

      const currentDraft = multiTrackDraftTags ?? {};
      const nextDraft = lockedMultiTrackUri
        ? toggleTagForTrackDraft(currentDraft, lockedMultiTrackUri, tagId)
        : toggleTagForAllTracksDraft(currentDraft, multiTagTracks, tagId);

      recordDraft(currentDraft, nextDraft);
      setMultiTrackDraftTags(nextDraft);
    },
    [isMultiTagging, lockedMultiTrackUri, multiTagTracks, multiTrackDraftTags, recordDraft],
  );

  const calculateBatchChanges = useCallback(
    (
      tracks: Array<{ uri: string }>,
      originalTrackDataMap: DraftTagState,
      draftTags: DraftTagState,
    ): BatchTagUpdate[] =>
      calculateBatchChangesForDraft(tracks, originalTrackDataMap, draftTags),
    [],
  );

  const toggleTagForSpecificTrackDraft = useCallback(
    (trackUri: string, tagId: string) => {
      if (trackEditHistory.getSnapshot().busy) return;
      if (!multiTrackDraftTags) {
        return;
      }

      const next = toggleTagForTrackDraft(multiTrackDraftTags, trackUri, tagId);
      recordDraft(multiTrackDraftTags ?? {}, next);
      setMultiTrackDraftTags(next);
    },
    [multiTrackDraftTags, recordDraft],
  );

  const toggleCommonTagDraft = useCallback(
    (tagId: string) => {
      if (trackEditHistory.getSnapshot().busy) return;
      if (!isMultiTagging || !multiTrackDraftTags) {
        console.warn("toggleCommonTag called when not in multi-tagging mode");
        return;
      }

      const next = toggleTagForAllTracksDraft(multiTrackDraftTags, multiTagTracks, tagId);
      recordDraft(multiTrackDraftTags ?? {}, next);
      setMultiTrackDraftTags(next);
    },
    [isMultiTagging, multiTagTracks, multiTrackDraftTags, recordDraft],
  );

  const toggleStarRatingDraft = useCallback(
    (rating: number) => {
      if (trackEditHistory.getSnapshot().busy) return;
      if (!isMultiTagging) {
        console.warn("toggleStarRating called when not in multi-tagging mode");
        return;
      }

      const next = toggleStarRatingDraftState(
          multiTrackDraftTags ?? {},
          multiTagTracks,
          rating,
          lockedMultiTrackUri,
        );
      recordDraft(multiTrackDraftTags ?? {}, next);
      setMultiTrackDraftTags(next);
    },
    [isMultiTagging, lockedMultiTrackUri, multiTagTracks, multiTrackDraftTags, recordDraft],
  );

  const toggleEnergyRatingDraft = useCallback(
    (energy: number) => {
      if (trackEditHistory.getSnapshot().busy) return;
      if (!isMultiTagging || !multiTrackDraftTags) {
        console.warn(
          "toggleEnergyRating called when not in multi-tagging mode",
        );
        return;
      }

      const next = toggleEnergyRatingDraftState(
          multiTrackDraftTags,
          multiTagTracks,
          energy,
          lockedMultiTrackUri,
        );
      recordDraft(multiTrackDraftTags ?? {}, next);
      setMultiTrackDraftTags(next);
    },
    [isMultiTagging, lockedMultiTrackUri, multiTagTracks, multiTrackDraftTags, recordDraft],
  );

  const cancelMultiTagging = () => {
    trackEditHistory.discardDraft();
    setMultiTagTracks([]);
    setIsMultiTagging(false);
    setLockedMultiTrackUri(null);
    setMultiTrackDraftTags(null);

    if (Spicetify?.Platform?.History?.push) {
      Spicetify.Platform.History.push("/tagify");
    }
  };

  const selectedTagsForSelector = useMemo((): TrackTag[] | null => {
    if (!isMultiTagging) {
      return null;
    }

    if (lockedMultiTrackUri) {
      return multiTrackDraftTags?.[lockedMultiTrackUri]?.tagIds ?? [];
    }

    return findCommonTagsFromDraftState(multiTrackDraftTags ?? {});
  }, [isMultiTagging, lockedMultiTrackUri, multiTrackDraftTags]);

  return {
    isMultiTagging,
    lockedMultiTrackUri,
    multiTagTracks,
    multiTrackDraftTags,

    setIsMultiTagging,
    setMultiTagTracks,
    setLockedMultiTrackUri,
    setMultiTrackDraftTags: (draft: DraftTagState) => { trackEditHistory.discardDraft(); setMultiTrackDraftTags(draft); },
    replaceMultiTrackDraft: setMultiTrackDraftTags,
    toggleTagMultiTrackDraft,
    toggleStarRatingDraft,
    toggleEnergyRatingDraft,
    cancelMultiTagging,
    toggleCommonTagDraft,
    toggleTagForSpecificTrackDraft,
    calculateBatchChanges,

    selectedTagsForSelector,
    findCommonTagsFromDraft,
    findCommonStarRatingFromDraft,
    findCommonEnergyRatingFromDraft,
  };
}
