import { useCallback, useMemo, useState } from "react";
import { BatchTagUpdate } from "@/types/tagData";
import { DraftTagState } from "@/features/multi-track-tagging/model/useMultiTrackTagging.types";
import {
  createResetDraftState,
  getCurrentEnergy,
  getCurrentRating,
  getEnergyDisplayValue,
  getEnergyIsSetValue,
  getRatingDisplayValue,
  hasDraftChanges,
  shouldShowEnergyClearButton,
  shouldShowRatingClearButton,
} from "@/features/multi-track-tagging/utils/multiTrackDetails.state";

interface UseMultiTrackDetailsStateOptions {
  tracks: Array<{ uri: string }>;
  trackDataMap: DraftTagState;
  multiTrackDraftTags: DraftTagState;
  lockedTrackUri: string | null;
  onSetMultiTrackDraftTags: (draftTags: DraftTagState) => void;
  onApplyBatchTagUpdates: (updates: BatchTagUpdate[]) => void | Promise<void>;
  onCalculateBatchChanges: (
    tracks: Array<{ uri: string }>,
    originalTrackDataMap: DraftTagState,
    draftTags: DraftTagState,
  ) => BatchTagUpdate[];
  onFindCommonStarRatingFromDraft: (draftTags: DraftTagState) => number | undefined;
  onFindCommonEnergyRatingFromDraft: (
    draftTags: DraftTagState,
  ) => number | undefined;
  onCancelTagging: () => void;
}

export function useMultiTrackDetailsState({
  tracks,
  trackDataMap,
  multiTrackDraftTags,
  lockedTrackUri,
  onSetMultiTrackDraftTags,
  onApplyBatchTagUpdates,
  onCalculateBatchChanges,
  onFindCommonStarRatingFromDraft,
  onFindCommonEnergyRatingFromDraft,
  onCancelTagging,
}: UseMultiTrackDetailsStateOptions) {
  const [isSaving, setIsSaving] = useState(false);
  const hasUnsavedChanges = useMemo(
    () => hasDraftChanges(tracks, trackDataMap, multiTrackDraftTags),
    [tracks, trackDataMap, multiTrackDraftTags],
  );

  const commonRating = useMemo(
    () => onFindCommonStarRatingFromDraft(multiTrackDraftTags),
    [multiTrackDraftTags, onFindCommonStarRatingFromDraft],
  );
  const commonEnergy = useMemo(
    () => onFindCommonEnergyRatingFromDraft(multiTrackDraftTags),
    [multiTrackDraftTags, onFindCommonEnergyRatingFromDraft],
  );

  const currentRating = useMemo(
    () => getCurrentRating(multiTrackDraftTags, lockedTrackUri, commonRating),
    [commonRating, lockedTrackUri, multiTrackDraftTags],
  );
  const currentEnergy = useMemo(
    () => getCurrentEnergy(multiTrackDraftTags, lockedTrackUri, commonEnergy),
    [commonEnergy, lockedTrackUri, multiTrackDraftTags],
  );

  const ratingDisplayValue = useMemo(
    () => getRatingDisplayValue(multiTrackDraftTags, lockedTrackUri, commonRating),
    [commonRating, lockedTrackUri, multiTrackDraftTags],
  );
  const energyDisplayValue = useMemo(
    () => getEnergyDisplayValue(multiTrackDraftTags, lockedTrackUri, commonEnergy),
    [commonEnergy, lockedTrackUri, multiTrackDraftTags],
  );

  const energyIsSetValue = useMemo(
    () => getEnergyIsSetValue(multiTrackDraftTags, lockedTrackUri, commonEnergy),
    [commonEnergy, lockedTrackUri, multiTrackDraftTags],
  );

  const showRatingClearButton = useMemo(
    () =>
      shouldShowRatingClearButton(
        multiTrackDraftTags,
        lockedTrackUri,
        commonRating,
      ),
    [commonRating, lockedTrackUri, multiTrackDraftTags],
  );

  const showEnergyClearButton = useMemo(
    () =>
      shouldShowEnergyClearButton(
        multiTrackDraftTags,
        lockedTrackUri,
        commonEnergy,
      ),
    [commonEnergy, lockedTrackUri, multiTrackDraftTags],
  );

  const resetDraftToOriginal = useCallback(() => {
    onSetMultiTrackDraftTags(createResetDraftState(tracks, trackDataMap));
  }, [onSetMultiTrackDraftTags, trackDataMap, tracks]);

  const handleSaveChanges = useCallback(async () => {
    if (isSaving) return;
    const changes = onCalculateBatchChanges(
      tracks,
      trackDataMap,
      multiTrackDraftTags,
    );

    if (changes.length === 0) {
      Spicetify.showNotification("No changes to save");
      return;
    }

    setIsSaving(true);
    try {
      await onApplyBatchTagUpdates(changes);
      Spicetify.showNotification(`Saved changes to ${changes.length} tracks. You can undo this bulk change in Tagify.`);
    } catch (error) {
      console.error("Tagify: bulk save failed", error);
      Spicetify.showNotification("Tagify couldn't save your bulk changes. Your draft is still here; please try again.", true);
    } finally { setIsSaving(false); }
  }, [
    isSaving,
    multiTrackDraftTags,
    onApplyBatchTagUpdates,
    onCalculateBatchChanges,
    trackDataMap,
    tracks,
  ]);

  const handleCancelChanges = useCallback(() => {
    resetDraftToOriginal();
  }, [resetDraftToOriginal]);

  const handleCancelTagging = useCallback(() => {
    if (hasUnsavedChanges) {
      if (confirm("You have unsaved changes. Are you sure you want to cancel?")) {
        resetDraftToOriginal();
        onCancelTagging();
      }
      return;
    }

    resetDraftToOriginal();
    onCancelTagging();
  }, [hasUnsavedChanges, onCancelTagging, resetDraftToOriginal]);

  return {
    isSaving,
    hasUnsavedChanges,
    currentRating,
    currentEnergy,
    ratingDisplayValue,
    energyDisplayValue,
    energyIsSetValue,
    showRatingClearButton,
    showEnergyClearButton,
    handleSaveChanges,
    handleCancelChanges,
    handleCancelTagging,
  };
}
