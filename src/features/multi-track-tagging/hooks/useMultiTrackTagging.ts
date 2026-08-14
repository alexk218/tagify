import { useCallback, useEffect, useMemo, useState } from "react";
import { SpotifyTrack } from "@/types/SpotifyTypes";
import { BatchTagUpdate, TrackTag } from "@/types/tagData";
import {
  calculateBatchChanges as calculateBatchChangesForDraft,
  createDraftTagState,
  findCommonEnergyRatingFromDraft as findCommonEnergyRatingFromDraftState,
  findCommonStarRatingFromDraft as findCommonStarRatingFromDraftState,
  findCommonTagsFromDraft as findCommonTagsFromDraftState,
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
  const [isMultiTagging, setIsMultiTagging] = useState(false);
  const [lockedMultiTrackUri, setLockedMultiTrackUri] = useState<string | null>(
    null,
  );
  const [multiTrackDraftTags, setMultiTrackDraftTags] =
    useState<DraftTagState | null>(null);
  const [multiTagTracks, setMultiTagTracks] = useState<SpotifyTrack[]>([]);

  const multiTrackUriSelectionKey = useMemo(
    () => JSON.stringify(multiTagTracks.map((track) => track.uri)),
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

  useEffect(() => {
    if (isMultiTagging && multiTrackUris.length > 0) {
      setMultiTrackDraftTags(createDraftTagState(multiTrackUris, tagData.tracks));
      return;
    }

    if (!isMultiTagging) {
      setMultiTrackDraftTags(null);
    }
  }, [isMultiTagging, multiTrackUris, tagData.tracks]);

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
      if (!isMultiTagging) {
        console.warn("toggleTag called when not in multi-tagging mode");
        return;
      }

      const currentDraft = multiTrackDraftTags ?? {};
      const nextDraft = lockedMultiTrackUri
        ? toggleTagForTrackDraft(currentDraft, lockedMultiTrackUri, tagId)
        : toggleTagForAllTracksDraft(currentDraft, multiTagTracks, tagId);

      setMultiTrackDraftTags(nextDraft);
    },
    [isMultiTagging, lockedMultiTrackUri, multiTagTracks, multiTrackDraftTags],
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
      if (!multiTrackDraftTags) {
        return;
      }

      setMultiTrackDraftTags(
        toggleTagForTrackDraft(multiTrackDraftTags, trackUri, tagId),
      );
    },
    [multiTrackDraftTags],
  );

  const toggleCommonTagDraft = useCallback(
    (tagId: string) => {
      if (!isMultiTagging || !multiTrackDraftTags) {
        console.warn("toggleCommonTag called when not in multi-tagging mode");
        return;
      }

      setMultiTrackDraftTags(
        toggleTagForAllTracksDraft(multiTrackDraftTags, multiTagTracks, tagId),
      );
    },
    [isMultiTagging, multiTagTracks, multiTrackDraftTags],
  );

  const toggleStarRatingDraft = useCallback(
    (rating: number) => {
      if (!isMultiTagging) {
        console.warn("toggleStarRating called when not in multi-tagging mode");
        return;
      }

      setMultiTrackDraftTags(
        toggleStarRatingDraftState(
          multiTrackDraftTags ?? {},
          multiTagTracks,
          rating,
          lockedMultiTrackUri,
        ),
      );
    },
    [isMultiTagging, lockedMultiTrackUri, multiTagTracks, multiTrackDraftTags],
  );

  const toggleEnergyRatingDraft = useCallback(
    (energy: number) => {
      if (!isMultiTagging || !multiTrackDraftTags) {
        console.warn(
          "toggleEnergyRating called when not in multi-tagging mode",
        );
        return;
      }

      setMultiTrackDraftTags(
        toggleEnergyRatingDraftState(
          multiTrackDraftTags,
          multiTagTracks,
          energy,
          lockedMultiTrackUri,
        ),
      );
    },
    [isMultiTagging, lockedMultiTrackUri, multiTagTracks, multiTrackDraftTags],
  );

  const cancelMultiTagging = () => {
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
    setMultiTrackDraftTags,
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
