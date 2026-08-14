import React, { useMemo } from "react";
import styles from "./MultiTrackDetails.module.css";
import { BatchTagUpdate } from "@/types/tagData";
import { TrackTag } from "@/types/tagData";
import { DraftTagState } from "@/features/multi-track-tagging/model/useMultiTrackTagging.types";
import ReactStars from "react-rating-stars-component";
import { Lightbulb, Lock, Tag } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { useMultiTrackDetailsState } from "@/features/multi-track-tagging/hooks/useMultiTrackDetailsState";
import { useMultiTrackKeyboardShortcuts } from "@/features/multi-track-tagging/hooks/useMultiTrackKeyboardShortcuts";
import {
  isCommonTrackTag,
  sortTrackTagsByName,
} from "@/features/multi-track-tagging/utils/multiTrackDetails.state";

interface MultiTrackDetailsProps {
  tracks: Array<{
    uri: string;
    name: string;
    artists: { name: string }[];
    album: { name: string };
  }>;
  trackDataMap: DraftTagState;
  onCancelTagging: () => void;
  onPlayTrack: (uri: string) => void;
  lockedTrackUri: string | null;
  onLockTrack: (uri: string | null) => void;
  multiTrackDraftTags: DraftTagState;
  onSetMultiTrackDraftTags: (draftTags: DraftTagState) => void;
  onApplyBatchTagUpdates: (updates: BatchTagUpdate[]) => void;
  onFindCommonTagsFromDraft: (draftTags: DraftTagState) => TrackTag[];
  onFindCommonStarRatingFromDraft: (
    draftTags: DraftTagState
  ) => number | undefined;
  onFindCommonEnergyRatingFromDraft: (
    draftTags: DraftTagState
  ) => number | undefined;
  onToggleStarRatingDraft: (rating: number) => void;
  onToggleEnergyRatingDraft: (energy: number) => void;
  onFindTagName: (tagId: string) => string;
  onToggleCommonTagDraft: (tagId: string) => void;
  onToggleTagForSpecificTrackDraft: (trackUri: string, tagId: string) => void;
  onCalculateBatchChanges: (
    tracks: Array<{ uri: string }>,
    originalTrackDataMap: DraftTagState,
    draftTags: DraftTagState
  ) => BatchTagUpdate[];
}

const MultiTrackDetails: React.FC<MultiTrackDetailsProps> = ({
  tracks,
  trackDataMap,
  onCancelTagging,
  onPlayTrack,
  lockedTrackUri,
  onLockTrack,
  multiTrackDraftTags,
  onSetMultiTrackDraftTags,
  onApplyBatchTagUpdates,
  onFindCommonTagsFromDraft,
  onFindCommonStarRatingFromDraft,
  onFindCommonEnergyRatingFromDraft,
  onToggleStarRatingDraft,
  onToggleEnergyRatingDraft,
  onFindTagName,
  onToggleCommonTagDraft,
  onToggleTagForSpecificTrackDraft,
  onCalculateBatchChanges,
}) => {
  const {
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
  } = useMultiTrackDetailsState({
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
  });

  useMultiTrackKeyboardShortcuts({
    hasUnsavedChanges,
    onSaveChanges: handleSaveChanges,
    onToggleStarRatingDraft,
    onToggleEnergyRatingDraft,
  });

  const commonTags = useMemo(
    () =>
      sortTrackTagsByName(
        onFindCommonTagsFromDraft(multiTrackDraftTags),
        onFindTagName,
      ),
    [multiTrackDraftTags, onFindCommonTagsFromDraft, onFindTagName],
  );

  const isCommonTag = (tag: TrackTag) => isCommonTrackTag(commonTags, tag);

  // Handle common tag removal in draft state
  const handleRemoveCommonTagsClick = (tag: TrackTag) => {
    onToggleCommonTagDraft(tag);
  };

  // Handle individual track tag click in draft state
  const handleRemoveSpecificTagClick = (
    trackUri: string,
    tag: TrackTag,
    e: React.MouseEvent
  ) => {
    e.stopPropagation(); // Prevent track locking when clicking on tags
    onToggleTagForSpecificTrackDraft(trackUri, tag);
  };

  // Handle track click
  const handleTrackClick = (uri: string, e: React.MouseEvent) => {
    // Don't trigger when clicking on play button or tags
    if (
      (e.target as HTMLElement).closest(`.${styles.playButton}`) ||
      (e.target as HTMLElement).closest(`.${styles.tagItem}`)
    ) {
      return;
    }

    // If already locked on this track, unlock it
    if (lockedTrackUri === uri) {
      onLockTrack(null);
    } else {
      onLockTrack(uri);
    }
  };

  const handleBulkStarRatingClick = (rating: number) => {
    onToggleStarRatingDraft(rating);
  };

  const handleBulkEnergyClick = (energy: number) => {
    onToggleEnergyRatingDraft(energy);
  };

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <div className={styles.container}>
      {/* HEADER */}
      <div className={styles.headerSection}>
        <div className={styles.header}>
          <h2 className={styles.title}>Bulk Tagging</h2>
          <div className={styles.helpTooltip}>
            ?
            <div className={styles.tooltipContent}>
              <div className={styles.tooltipHeader}>
                <Lightbulb size={14} />
                <span>Keyboard Shortcuts</span>
              </div>

              <div className={styles.shortcutList}>
                <div className={styles.shortcutItem}>
                  <span className={styles.shortcutLabel}>Save Changes</span>
                  <div className={styles.shortcutKeys}>
                    {isMac ? (
                      <>
                        <kbd>⌘</kbd>
                        <kbd>⇧</kbd>
                        <kbd>S</kbd>
                      </>
                    ) : (
                      <>
                        <kbd>Ctrl</kbd>
                        <kbd>Shift</kbd>
                        <kbd>S</kbd>
                      </>
                    )}
                  </div>
                </div>

                <div className={styles.shortcutItem}>
                  <span className={styles.shortcutLabel}>Star Rating</span>
                  <div className={styles.shortcutKeys}>
                    <kbd>1</kbd>
                    <span className={styles.keyDivider}>–</span>
                    <kbd>0</kbd>
                  </div>
                </div>

                <div className={styles.shortcutItem}>
                  <span className={styles.shortcutLabel}>Energy Rating</span>
                  <div className={styles.shortcutKeys}>
                    <kbd>⇧</kbd>
                    <kbd>1</kbd>
                    <span className={styles.keyDivider}>–</span>
                    <kbd>⇧</kbd>
                    <kbd>0</kbd>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={styles.summary}>
            <span className={styles.trackCount}>
              {tracks.length} tracks selected
            </span>
            {hasUnsavedChanges && (
              <span className={styles.unsavedIndicator}>• Unsaved changes</span>
            )}
            <div className={styles.actionButtons}>
              <button
                className={styles.saveButton}
                onClick={handleSaveChanges}
                disabled={!hasUnsavedChanges}
                title={`Save Changes (${isMac ? "⌘⇧S" : "Ctrl+Shift+S"})`}
              >
                Save Changes
              </button>
              <button
                className={styles.discardButton}
                onClick={handleCancelChanges}
                disabled={!hasUnsavedChanges}
              >
                Discard
              </button>
              <button
                className={styles.cancelButton}
                onClick={handleCancelTagging}
              >
                {"Cancel Bulk Tagging"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RATING CONTROLS */}
      <div className={styles.controlsWithContextSection}>
        <div className={styles.controlsContainer}>
          {/* Star rating control */}
          <div className={styles.controlSection}>
            <label className={styles.label}>
              Rating: {ratingDisplayValue}
            </label>
            <div className={styles.ratingContainer}>
              <div></div> {/* empty left column */}
              <div className={styles.stars}>
                <ReactStars
                  key={`stars-${
                    lockedTrackUri || "bulk"
                  }-${currentRating}`}
                  count={5}
                  value={currentRating}
                  onChange={(newRating: number) =>
                    handleBulkStarRatingClick(newRating)
                  }
                  size={30}
                  isHalf={true}
                  emptyIcon={<FontAwesomeIcon icon={faStar} />}
                  halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                  fullIcon={<FontAwesomeIcon icon={faStar} />}
                  activeColor="#ffd700"
                  color="var(--spice-button-disabled)"
                />
              </div>
              <button
                className={`${styles.clearButton} ${
                  !showRatingClearButton ? styles.hidden : ""
                }`}
                onClick={() => handleBulkStarRatingClick(0)}
                aria-label={
                  lockedTrackUri ? "Clear track rating" : "Clear all ratings"
                }
              >
                Clear
              </button>
            </div>
          </div>

          {/* Energy control */}
          <div className={styles.controlSection}>
            <label className={styles.label}>
              Energy:{" "}
              <span className={styles.energyValue}>
                {energyDisplayValue}
              </span>
            </label>
            <div className={styles.energyContainer}>
              <div></div> {/* empty left column */}
              <input
                key={`energy-${lockedTrackUri || "bulk"}`}
                type="range"
                min="1"
                max="10"
                value={currentEnergy || 5}
                data-is-set={energyIsSetValue}
                className={`${styles.energySlider} ${
                  currentEnergy === 0 ? styles.energySliderUnset : ""
                }`}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  handleBulkEnergyClick(value);
                }}
                onClick={(e) => {
                  const shouldSetValue = currentEnergy === 0;
                  if (shouldSetValue) {
                    const value = parseInt(
                      (e.target as HTMLInputElement).value
                    );
                    handleBulkEnergyClick(value);
                  }
                }}
                onDoubleClick={() => handleBulkEnergyClick(0)}
              />
              <button
                className={`${styles.clearButton} ${
                  !showEnergyClearButton ? styles.hidden : ""
                }`}
                onClick={() => handleBulkEnergyClick(0)}
                aria-label={
                  lockedTrackUri
                    ? "Clear track energy rating"
                    : "Clear all energy ratings"
                }
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className={styles.contextBar}>
          <div className={styles.contextContent}>
            {lockedTrackUri ? (
              <>
                <Lock size={14} />
                <span>Changes apply to locked track only</span>
              </>
            ) : (
              <>
                <Tag size={14} />
                <span>Changes apply to all {tracks.length} tracks</span>
              </>
            )}
          </div>
        </div>
        <div className={styles.commonTagsSection}>
          <h3 className={styles.sectionTitle}>Common Tags</h3>
          {commonTags.length > 0 ? (
            <div className={styles.tagList}>
              {commonTags.map((tag, index) => (
                <div
                  key={index}
                  className={styles.tagItem}
                  onClick={() => handleRemoveCommonTagsClick(tag)}
                  title="Click to remove this tag from all tracks"
                >
                  {onFindTagName(tag)}
                  <span className={styles.removeTagIcon}>×</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.noTags}>No common tags</p>
          )}
        </div>
      </div>

      <div className={styles.trackListContainer}>
        <h3 className={styles.sectionTitle}>Selected Tracks</h3>
        <div className={styles.trackList}>
          {tracks.map((track) => {
            const trackData = multiTrackDraftTags[track.uri];
            const hasRating = (trackData?.rating ?? 0) > 0;
            const hasEnergy = (trackData?.energy ?? 0) > 0;

            return (
              <div
                key={track.uri}
                className={`${styles.trackItem} ${
                  lockedTrackUri === track.uri ? styles.lockedTrack : ""
                }`}
                onClick={(e) => handleTrackClick(track.uri, e)}
              >
                <div className={styles.lockColumn}>
                  {lockedTrackUri === track.uri && (
                    <Lock size={16} strokeWidth={1.25} absoluteStrokeWidth />
                  )}
                </div>
                <div className={styles.trackInfo}>
                  <span className={styles.trackName} title={track.name}>
                    {track.name}
                  </span>
                  <span className={styles.trackArtist}>
                    {track.artists.map((artist) => artist.name).join(", ")}
                  </span>
                </div>

                <div className={styles.trackTagsInline}>
                  {(trackData?.tagIds || []).length > 0 ? (
                    <div className={styles.tagList}>
                      {sortTrackTagsByName(trackData.tagIds, onFindTagName).map(
                        (tag, index) => (
                          <div
                            key={index}
                            className={`${styles.tagItem} ${
                              isCommonTag(tag) ? styles.commonTagHighlight : ""
                            }`}
                            onClick={(e) =>
                              handleRemoveSpecificTagClick(track.uri, tag, e)
                            }
                            title="Click to remove this tag from this track"
                          >
                            {onFindTagName(tag)}
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <span className={styles.noTags}>No tags</span>
                  )}
                </div>
                <div className={styles.trackRatingSection}>
                  {hasEnergy && (
                    <div className={styles.trackItemEnergy}>
                      <span
                        key={`energy-${track.uri}-${trackData.energy}`}
                        title={`Energy: ${trackData.energy}`}
                      >
                        {trackData.energy}
                      </span>
                    </div>
                  )}
                  {hasRating && (
                    <div className={styles.trackItemRating}>
                      <ReactStars
                        key={`stars-${track.uri}-${trackData.rating}`}
                        count={5}
                        value={trackData.rating}
                        edit={false}
                        size={16}
                        isHalf={true}
                        emptyIcon={<FontAwesomeIcon icon={faStar} />}
                        halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                        fullIcon={<FontAwesomeIcon icon={faStar} />}
                        activeColor="#ffd700"
                        color="var(--spice-button-disabled)"
                      />
                    </div>
                  )}
                </div>
                <button
                  className={styles.playButton}
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent event bubbling
                    onPlayTrack(track.uri);
                  }}
                  title={"Play this track"}
                >
                  {"Play"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.instructions}>
        <p>
          Apply tags to{" "}
          {lockedTrackUri ? "the locked track" : "all selected tracks"} using
          the tag selector below.{" "}
          {hasUnsavedChanges && "Remember to save your changes!"}
        </p>
        <p>
          {lockedTrackUri
            ? "Click the locked track again to unlock it."
            : "Click any track to lock tagging to that track only."}
        </p>
      </div>
    </div>
  );
};

export default MultiTrackDetails;
