import React, { useState, useEffect } from "react";
import styles from "./MultiTrackDetails.module.css";
import { BatchTagUpdate, TrackTag } from "@/hooks/data/useTagData";
import { DraftTagState } from "@/hooks/data/useMultiTrackTagging";
import ReactStars from "react-rating-stars-component";
import { Lock, Tag } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";

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
  onFindTagName: (
    categoryId: string,
    subCategoryId: string,
    tagId: string
  ) => string;
  onToggleCommonTagDraft: (
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => void;
  onToggleTagForSpecificTrackDraft: (
    trackUri: string,
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => void;
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Check for changes whenever draft tags update
  useEffect(() => {
    let hasAnyChanges = false;

    for (const track of tracks) {
      const originalTrackData = trackDataMap[track.uri] || {
        tags: [],
        rating: 0,
        energy: 0,
      };
      const draftTrackData = multiTrackDraftTags[track.uri] || {
        tags: [],
        rating: 0,
        energy: 0,
      };

      if (
        originalTrackData.tags.length !== draftTrackData.tags.length ||
        originalTrackData.rating !== draftTrackData.rating ||
        originalTrackData.energy !== draftTrackData.energy
      ) {
        hasAnyChanges = true;
        break;
      }

      // Check if all original tags exist in draft
      const hasAllOriginal = originalTrackData.tags.every((origTag) =>
        draftTrackData.tags.some(
          (draftTag) =>
            draftTag.categoryId === origTag.categoryId &&
            draftTag.subcategoryId === origTag.subcategoryId &&
            draftTag.tagId === origTag.tagId
        )
      );

      if (!hasAllOriginal) {
        hasAnyChanges = true;
        break;
      }
    }

    setHasUnsavedChanges(hasAnyChanges);
  }, [multiTrackDraftTags, trackDataMap, tracks]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // check for Ctrl+S or Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();

        if (hasUnsavedChanges) {
          handleSaveChanges();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [hasUnsavedChanges]);

  const commonTags = onFindCommonTagsFromDraft(multiTrackDraftTags).sort(
    (a, b) => {
      const nameA = onFindTagName(a.categoryId, a.subcategoryId, a.tagId);
      const nameB = onFindTagName(b.categoryId, b.subcategoryId, b.tagId);
      return nameA.localeCompare(nameB);
    }
  );

  const isCommonTag = (tag: TrackTag) => {
    return commonTags.some(
      (commonTag) =>
        commonTag.categoryId === tag.categoryId &&
        commonTag.subcategoryId === tag.subcategoryId &&
        commonTag.tagId === tag.tagId
    );
  };

  // Handle common tag removal in draft state
  const handleRemoveCommonTagsClick = (tag: TrackTag) => {
    onToggleCommonTagDraft(tag.categoryId, tag.subcategoryId, tag.tagId);
  };

  // Handle individual track tag click in draft state
  const handleRemoveSpecificTagClick = (
    trackUri: string,
    tag: TrackTag,
    e: React.MouseEvent
  ) => {
    e.stopPropagation(); // Prevent track locking when clicking on tags
    onToggleTagForSpecificTrackDraft(
      trackUri,
      tag.categoryId,
      tag.subcategoryId,
      tag.tagId
    );
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

  // Save changes - apply all draft changes
  const handleSaveChanges = () => {
    // Calculate what changed
    const changes = onCalculateBatchChanges(
      tracks,
      trackDataMap,
      multiTrackDraftTags
    );
    if (changes.length === 0) {
      Spicetify.showNotification("No changes to save");
      return;
    }

    onApplyBatchTagUpdates(changes);
    Spicetify.showNotification(`Saved changes to ${changes.length} tracks`);
  };

  // Cancel changes - reset to original state
  const handleCancelChanges = () => {
    const resetDraft: DraftTagState = {};
    tracks.forEach((track) => {
      const originalData = trackDataMap[track.uri] || {
        tags: [],
        rating: 0,
        energy: 0,
      };
      resetDraft[track.uri] = {
        tags: [...originalData.tags],
        rating: originalData.rating,
        energy: originalData.energy,
      };
    });
    onSetMultiTrackDraftTags(resetDraft);
    setHasUnsavedChanges(false);
  };

  // Handle cancel with confirmation if there are unsaved changes
  const handleCancelTagging = () => {
    if (hasUnsavedChanges) {
      if (
        confirm("You have unsaved changes. Are you sure you want to cancel?")
      ) {
        const resetDraft: DraftTagState = {};
        tracks.forEach((track) => {
          const originalData = trackDataMap[track.uri] || {
            tags: [],
            rating: 0,
            energy: 0,
          };
          resetDraft[track.uri] = {
            tags: [...originalData.tags],
            rating: originalData.rating,
            energy: originalData.energy,
          };
        });
        onSetMultiTrackDraftTags(resetDraft);
        setHasUnsavedChanges(false);

        onCancelTagging();
      }
    } else {
      const resetDraft: DraftTagState = {};
      tracks.forEach((track) => {
        const originalData = trackDataMap[track.uri] || {
          tags: [],
          rating: 0,
          energy: 0,
        };
        resetDraft[track.uri] = {
          tags: [...originalData.tags],
          rating: originalData.rating,
          energy: originalData.energy,
        };
      });
      onSetMultiTrackDraftTags(resetDraft);
      setHasUnsavedChanges(false);
      onCancelTagging();
    }
  };

  const commonRating = onFindCommonStarRatingFromDraft(multiTrackDraftTags);
  const commonEnergy = onFindCommonEnergyRatingFromDraft(multiTrackDraftTags);

  const getRatingDisplayValue = () => {
    if (lockedTrackUri) {
      const lockedTrackRating =
        multiTrackDraftTags[lockedTrackUri]?.rating || 0;
      return lockedTrackRating > 0 ? lockedTrackRating : "None";
    } else {
      return commonRating !== undefined ? commonRating : "Mixed";
    }
  };

  const getEnergyDisplayValue = () => {
    if (lockedTrackUri) {
      const lockedTrackEnergy =
        multiTrackDraftTags[lockedTrackUri]?.energy || 0;
      return lockedTrackEnergy > 0 ? lockedTrackEnergy : "None";
    } else {
      if (commonEnergy !== undefined && commonEnergy > 0) {
        return commonEnergy;
      } else if (commonEnergy === undefined) {
        return "Mixed";
      } else {
        return "None";
      }
    }
  };

  const getCurrentRating = () => {
    if (lockedTrackUri) {
      return multiTrackDraftTags[lockedTrackUri]?.rating || 0;
    } else {
      return onFindCommonStarRatingFromDraft(multiTrackDraftTags) || 0;
    }
  };

  const getCurrentEnergy = () => {
    if (lockedTrackUri) {
      return multiTrackDraftTags[lockedTrackUri]?.energy || 0;
    } else {
      return onFindCommonEnergyRatingFromDraft(multiTrackDraftTags) || 0;
    }
  };

  const shouldShowRatingClearButton = () => {
    const currentRating = lockedTrackUri
      ? multiTrackDraftTags[lockedTrackUri]?.rating || 0
      : onFindCommonStarRatingFromDraft(multiTrackDraftTags);

    return currentRating !== undefined && currentRating > 0;
  };

  const shouldShowEnergyClearButton = () => {
    const currentEnergy = lockedTrackUri
      ? multiTrackDraftTags[lockedTrackUri]?.energy || 0
      : onFindCommonEnergyRatingFromDraft(multiTrackDraftTags);

    return currentEnergy !== undefined && currentEnergy > 0;
  };

  // For the energy slider's data-is-set attribute
  const getEnergyIsSetValue = () => {
    if (lockedTrackUri) {
      const lockedTrackEnergy =
        multiTrackDraftTags[lockedTrackUri]?.energy || 0;
      return lockedTrackEnergy > 0 ? "true" : "false";
    } else {
      return commonEnergy !== undefined && commonEnergy > 0 ? "true" : "false";
    }
  };

  const currentEnergy = getCurrentEnergy();

  return (
    <div className={styles.container}>
      {/* HEADER */}
      <div className={styles.headerSection}>
        <div className={styles.header}>
          <h2 className={styles.title}>Bulk Tagging</h2>
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
              Rating: {getRatingDisplayValue()}
            </label>
            <div className={styles.ratingContainer}>
              <div></div> {/* empty left column */}
              <div className={styles.stars}>
                <ReactStars
                  key={`stars-${
                    lockedTrackUri || "bulk"
                  }-${getCurrentRating()}`}
                  count={5}
                  value={getCurrentRating()}
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
                  !shouldShowRatingClearButton() ? styles.hidden : ""
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
                {getEnergyDisplayValue()}
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
                data-is-set={getEnergyIsSetValue()}
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
                  !shouldShowEnergyClearButton() ? styles.hidden : ""
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
                  {onFindTagName(tag.categoryId, tag.subcategoryId, tag.tagId)}
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
                  {(trackData?.tags || []).length > 0 ? (
                    // TODO: refactor this
                    <div className={styles.tagList}>
                      {trackData.tags
                        .slice()
                        .sort((a, b) => {
                          const nameA = onFindTagName(
                            a.categoryId,
                            a.subcategoryId,
                            a.tagId
                          );
                          const nameB = onFindTagName(
                            b.categoryId,
                            b.subcategoryId,
                            b.tagId
                          );
                          return nameA.localeCompare(nameB);
                        })
                        .map((tag, index) => (
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
                            {onFindTagName(
                              tag.categoryId,
                              tag.subcategoryId,
                              tag.tagId
                            )}
                          </div>
                        ))}
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
