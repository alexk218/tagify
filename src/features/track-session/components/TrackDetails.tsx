import React, { useMemo, useState } from "react";
import styles from "./TrackDetails.module.css";
import { TagTaxonomy } from "@/types/tagData";
import { formatTimestamp } from "@/utils/formatters";
import ReactStars from "react-rating-stars-component";
import { SpotifyTrack } from "@/types/SpotifyTypes";
import { Lock, LockOpen } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { normalizeCamelotKey } from "@/utils/camelotKey";
import {
  TrackDetailsTrackData,
  useTrackDetailsMetadata,
} from "@/features/track-session/hooks/useTrackDetailsMetadata";
import { useTrackNavigation } from "@/features/track-session/hooks/useTrackNavigation";
import {
  hasAnyGroupedTags,
  organizeTrackTagsByCategory,
} from "@/features/track-session/utils/trackDetails.tags";
import { buildTagAccentCssVars } from "@/features/tag-data";

interface TrackDetailsProps {
  displayedTrack: SpotifyTrack; // The track displayed in TrackDetails
  currentlyPlayingTrack: SpotifyTrack | null; // The currently playing track
  trackData: TrackDetailsTrackData;
  taxonomy: TagTaxonomy;
  onSetRating: (rating: number) => void;
  onSetEnergy: (energy: number) => void;
  onSetBpm: (bpm: number | null) => void;
  onSetCamelotKey: (camelotKey: string | null) => void;
  onRemoveTag: (tagId: string) => void;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onToggleTagIncludeOff: (tagId: string) => void;
  onPlayTrack: (uri: string) => void;
  isLocked: boolean;
  onToggleLock: () => void;
  onSwitchToCurrentTrack: (track: SpotifyTrack | null) => void;
  onUpdateBpm: (trackUri: string) => Promise<number | null>;
}

const TrackDetails: React.FC<TrackDetailsProps> = ({
  displayedTrack,
  currentlyPlayingTrack,
  trackData,
  taxonomy,
  activeTagFilters,
  excludedTagFilters,
  onSetRating,
  onSetEnergy,
  onSetBpm,
  onSetCamelotKey,
  onRemoveTag,
  onToggleTagIncludeOff,
  onPlayTrack,
  isLocked = false,
  onToggleLock,
  onSwitchToCurrentTrack,
}: TrackDetailsProps) => {
  const artistNames = useMemo(
    () =>
      displayedTrack.artists
        ? displayedTrack.artists.map((artist) => artist.name).join(", ")
        : "",
    [displayedTrack.artists],
  );
  const {
    contextUri,
    isLoadingMetadata,
    albumCover,
    isLoadingCover,
    trackMetadata,
    isRefreshingAudioFeatures,
    handleRefreshAudioFeatures,
  } = useTrackDetailsMetadata({
    displayedTrack,
    artistNames,
    trackData,
    onSetBpm,
    onSetCamelotKey,
  });
  const { navigateToAlbum, navigateToArtist, navigateToContext } =
    useTrackNavigation({
      displayedTrack,
      contextUri,
      sourceContext: trackMetadata.sourceContext,
    });
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [editBpmValue, setEditBpmValue] = useState<string>("");

  const handleBpmClick = () => {
    setIsEditingBpm(true);
    // initialize input field with current BPM value
    const currentBpm = trackData.bpm || trackMetadata.bpm;
    setEditBpmValue(currentBpm ? currentBpm.toString() : "");
  };

  const handleBpmSave = () => {
    const numericValue = parseInt(editBpmValue.trim());
    if (editBpmValue.trim() === "") {
      onSetBpm(null);
    } else if (isNaN(numericValue) || numericValue < 1 || numericValue > 300) {
      Spicetify.showNotification("BPM must be between 1 and 300", true);
      return;
    } else {
      onSetBpm(numericValue);
    }

    setIsEditingBpm(false);
  };

  const handleBpmCancel = () => {
    setIsEditingBpm(false);
    setEditBpmValue("");
  };

  const handleBpmKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBpmSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleBpmCancel();
    }
  };

  const handleBpmSaveMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent input blur
    handleBpmSave();
  };

  const handleBpmCancelMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent input blur
    handleBpmCancel();
  };

  const handlePlayTrack = () => {
    if (displayedTrack.uri) {
      onPlayTrack(displayedTrack.uri);
    }
  };
  const groupedTags = useMemo(
    () => organizeTrackTagsByCategory(taxonomy, trackData.tagIds),
    [taxonomy, trackData.tagIds],
  );
  const customAccentsById = taxonomy.customAccentsById;
  const hasGroupedTags = useMemo(() => hasAnyGroupedTags(groupedTags), [groupedTags]);

  const handleRemoveEnergy = () => {
    onSetEnergy(0);
  };

  const handleEnergyInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    onSetEnergy(value);
  };

  const handleEnergyClick = (e: React.MouseEvent<HTMLInputElement>) => {
    // Get the clicked position and calculate the corresponding energy value
    const sliderElement = e.currentTarget;
    const rect = sliderElement.getBoundingClientRect();
    const clickPosition = e.clientX - rect.left;
    const sliderWidth = rect.width;
    const percentage = clickPosition / sliderWidth;

    // Calculate energy value (1-10)
    const min = 1;
    const max = 10;
    let energy = Math.round(min + percentage * (max - min));

    energy = Math.max(min, Math.min(max, energy));

    onSetEnergy(energy);
  };

  return (
    <div className={styles.container}>
      <div className={styles.lockControlContainer}>
        {isLocked &&
          currentlyPlayingTrack &&
          currentlyPlayingTrack.uri !== displayedTrack.uri && (
            <button
              className={styles.switchTrackButton}
              onClick={() => {
                onSwitchToCurrentTrack(currentlyPlayingTrack);
              }}
              title="Switch to currently playing track"
            >
              <span className={styles.buttonIcon}></span>
              Switch to current
            </button>
          )}

        <button
          className={`${styles.lockButton} ${
            isLocked ? styles.locked : styles.unlocked
          }`}
          onClick={onToggleLock}
          title={
            isLocked
              ? "Unlock to follow currently playing track"
              : "Lock to this track"
          }
        >
          {isLocked ? (
            <Lock size={16} strokeWidth={1.25} absoluteStrokeWidth />
          ) : (
            <LockOpen size={16} strokeWidth={1.25} absoluteStrokeWidth />
          )}
        </button>
      </div>
      <div className={styles.contentLayout}>
        {/* Left side - Track info with album art */}
        <div className={styles.trackInfoContainer}>
          {/* Wrap album cover and warning in a column container */}
          <div className={styles.albumSection}>
            <div className={styles.albumCoverContainer}>
              <div
                className={styles.albumCoverClickable}
                onClick={() => navigateToAlbum()}
                title={
                  displayedTrack.uri?.startsWith("spotify:local:")
                    ? "Go to Local Files"
                    : "Go to album"
                }
              >
                {isLoadingCover ? (
                  <div className={styles.albumCoverPlaceholder}>
                    <div className={styles.albumCoverLoading}></div>
                  </div>
                ) : albumCover ? (
                  <img
                    src={albumCover}
                    alt={`${displayedTrack.album?.name || "Album"} cover`}
                    className={styles.albumCover}
                  />
                ) : (
                  <div className={styles.albumCoverPlaceholder}>
                    <span className={styles.albumCoverIcon}>♫</span>
                  </div>
                )}
              </div>
              <button
                className={styles.playButton}
                onClick={handlePlayTrack}
                title={"Play this track"}
              >
                {"Play"}
              </button>
            </div>
          </div>

          <div className={styles.trackInfo}>
            <h2
              className={styles.trackTitle}
              onClick={() => navigateToAlbum()}
              title={
                displayedTrack.uri?.startsWith("spotify:local:")
                  ? "Go to Local Files"
                  : "Go to album"
              }
            >
              {displayedTrack.name || "Unknown Track"}
              {displayedTrack.uri?.startsWith("spotify:local:") && (
                <span
                  style={{ fontSize: "0.8em", opacity: 0.7, marginLeft: "6px" }}
                >
                  (Local)
                </span>
              )}
            </h2>
            <p className={styles.trackArtist}>
              {displayedTrack.artists && displayedTrack.artists.length > 0
                ? displayedTrack.artists.map((artist, idx, arr) => (
                    <React.Fragment key={idx}>
                      <span
                        className={`${styles.clickableArtist}`}
                        onClick={() => navigateToArtist(artist.name)}
                        title={`Go to ${artist.name}`}
                      >
                        {artist.name}
                      </span>
                      {idx < arr.length - 1 && ", "}
                    </React.Fragment>
                  ))
                : "Unknown Artist"}
            </p>
            <p className={styles.trackAlbum}>
              {displayedTrack.album?.name || "Unknown Album"}
            </p>

            {/* New Track Metadata Section */}
            <div className={styles.trackMetadata}>
              {isLoadingMetadata ? (
                <div className={styles.metadataLoading}>Loading details...</div>
              ) : (
                <>
                  <div className={styles.metadataGrid}>
                    {trackMetadata.releaseDate && (
                      <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Released:</span>
                        <span className={styles.metadataValue}>
                          {trackMetadata.releaseDate}
                        </span>
                      </div>
                    )}

                    {trackMetadata.trackLength && (
                      <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Length:</span>
                        <span className={styles.metadataValue}>
                          {trackMetadata.trackLength}
                        </span>
                      </div>
                    )}

                    <div className={styles.metadataItem}>
                      <span className={styles.metadataLabel}>BPM:</span>
                      <div className={styles.bpmContainer}>
                        {isEditingBpm ? (
                          <div className={styles.bpmEditContainer}>
                            <input
                              type="number"
                              value={editBpmValue}
                              onChange={(e) => setEditBpmValue(e.target.value)}
                              onKeyDown={handleBpmKeyDown}
                              onBlur={handleBpmCancel}
                              className={styles.bpmEditInput}
                              placeholder="Enter BPM"
                              min="1"
                              max="300"
                              autoFocus
                            />
                            <button
                              className={styles.bpmSaveButton}
                              onMouseDown={handleBpmSaveMouseDown}
                              title="Save BPM"
                            >
                              ✓
                            </button>
                            <button
                              className={styles.bpmCancelButton}
                              onMouseDown={handleBpmCancelMouseDown}
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className={styles.bpmDisplayContainer}>
                            <span
                              className={`${styles.metadataValue} ${styles.editableBpm}`}
                              onClick={handleBpmClick}
                              title="Click to edit BPM"
                            >
                              {trackData.bpm || trackMetadata.bpm || "Unknown"}
                            </span>

                            {!displayedTrack.uri.startsWith(
                              "spotify:local:"
                            ) && (
                              <button
                                className={styles.bpmRefreshButton}
                                onClick={handleRefreshAudioFeatures}
                                disabled={isRefreshingAudioFeatures}
                                title="Fetch latest BPM and key from Spotify"
                              >
                                {isRefreshingAudioFeatures ? (
                                  <span className={styles.refreshSpinner}>
                                    ⟳
                                  </span>
                                ) : (
                                  "↻"
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={styles.metadataItem}>
                      <span className={styles.metadataLabel}>Key:</span>
                      <span className={styles.metadataValue}>
                        {normalizeCamelotKey(trackData.camelotKey) ||
                          trackMetadata.camelotKey ||
                          "Unknown"}
                      </span>
                    </div>

                    {trackMetadata.playCount !== null && (
                      <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Plays:</span>
                        <span className={styles.metadataValue}>
                          {trackMetadata.playCount.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Separate div for source context, so it can take up full width of container */}
                  {trackMetadata.sourceContext && (
                    <div className={styles.metadataContext}>
                      <span className={styles.metadataLabel}>
                        Playing from:
                      </span>{" "}
                      <span
                        className={`${styles.metadataValue} ${styles.contextLink}`}
                        onClick={() => navigateToContext()}
                        title="Go to source"
                      >
                        {trackMetadata.sourceContext}
                      </span>
                    </div>
                  )}
                  {/* Spotify genre tags */}
                  {/* {trackMetadata.genres.length > 0 && (
                    <div className={styles.metadataGenres}>
                      <span className={styles.metadataLabel}>Genres:</span>{" "}
                      <div className={styles.genreTags}>
                        {trackMetadata.genres.map((genre, index) => (
                          <span key={index} className={styles.genreTag}>
                            {genre}
                          </span>
                        ))}
                      </div>
                    </div>
                  )} */}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right side - Controls and metadata */}
        <div className={styles.controlsContainer}>
          {/* Rating */}
          <div className={styles.controlSection}>
            <label className={styles.label}>
              Rating: {trackData.rating > 0 ? trackData.rating : ""}
            </label>
            <div className={styles.ratingContainer}>
              <div className={styles.stars} key={`stars-${trackData.rating}`}>
                <ReactStars
                  count={5}
                  value={trackData.rating || 0}
                  onChange={(newRating: number) => onSetRating(newRating)}
                  size={24}
                  isHalf={true}
                  emptyIcon={<FontAwesomeIcon icon={faStar} />}
                  halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                  fullIcon={<FontAwesomeIcon icon={faStar} />}
                  activeColor="#ffd700"
                  color="var(--spice-button-disabled)"
                />
              </div>

              {trackData.rating > 0 && (
                <button
                  className={styles.clearButton}
                  onClick={() => onSetRating(0)}
                  aria-label="Clear rating"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Energy Level */}
          <div className={styles.controlSection}>
            <label className={styles.label}>
              Energy:
              {trackData.energy > 0 && (
                <span className={styles.energyValue}>{trackData.energy}</span>
              )}
            </label>
            <div className={styles.energyContainer}>
              <input
                type="range"
                min="1"
                max="10"
                value={trackData.energy || 5}
                data-is-set={trackData.energy > 0 ? "true" : "false"}
                className={`${styles.energySlider} ${
                  trackData.energy === 0 ? styles.energySliderUnset : ""
                }`}
                onChange={handleEnergyInput}
                onClick={handleEnergyClick}
                onDoubleClick={() => {
                  // Clear on double click
                  onSetEnergy(0);
                }}
              />
              {trackData.energy > 0 && (
                <button
                  className={styles.clearButton}
                  onClick={handleRemoveEnergy}
                  aria-label="Clear energy rating"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* TAGS SECTION */}
      <div className={styles.tagsSection}>
        {/* Timestamp metadata */}
        {(trackData.dateCreated || trackData.dateModified) && (
          <div className={styles.timestampMetadata}>
            <div className={styles.timestampRow}>
              {trackData.dateCreated && (
                <div
                  className={styles.timestampItem}
                  title={
                    "Created: " +
                    new Date(trackData.dateCreated).toLocaleString()
                  }
                >
                  <span className={styles.timestampLabel}>Tagged:</span>
                  <span className={styles.timestampValue}>
                    {formatTimestamp(trackData.dateCreated, true)}
                  </span>
                </div>
              )}
              {trackData.dateModified && (
                <div
                  className={styles.timestampItem}
                  title={
                    "Last updated: " +
                    new Date(trackData.dateModified).toLocaleString()
                  }
                >
                  <span className={styles.timestampLabel}>Updated:</span>
                  <span className={styles.timestampValue}>
                    {formatTimestamp(trackData.dateModified, true)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        {!hasGroupedTags ? (
          <p className={styles.noTags}>No tags applied</p>
        ) : (
          <div className={styles.tagCategories}>
            {/* Filter categories to only show those with tags */}
            {Object.entries(groupedTags)
              .filter(([, categoryData]) => {
                // Check if this category has any subcategories with tags
                return Object.values(categoryData.subcategories).some(
                  (subcategory) => subcategory.tags.length > 0
                );
              })
              .sort(([, a], [, b]) => a.categoryOrder - b.categoryOrder)
              .map(([categoryId, category]) => (
                <div key={categoryId} className={styles.tagCategory}>
                  <h4 className={styles.categoryName}>
                    {category.categoryName}
                  </h4>

                  {/* Only show subcategories that have tags */}
                  {Object.entries(category.subcategories)
                    .filter(([, subcategory]) => subcategory.tags.length > 0)
                    .sort(
                      ([, a], [, b]) => a.subcategoryOrder - b.subcategoryOrder
                    )
                    .map(([subcategoryId, subcategory]) => (
                      <div
                        key={subcategoryId}
                        className={styles.tagSubcategory}
                      >
                        <h5 className={styles.subcategoryName}>
                          {subcategory.subcategoryName}
                        </h5>

                        <div className={styles.tagList}>
                          {subcategory.tags.map((tag) => {
                            const fullTagId = tag.id;

                            return (
                              <div
                                key={tag.id}
                                className={`${styles.tagItem} ${
                                  tag.accentId ? styles.tagItemAccented : ""
                                } ${
                                  activeTagFilters.includes(fullTagId)
                                    ? styles.tagFilter
                                    : ""
                                } ${
                                  excludedTagFilters.includes(fullTagId)
                                    ? styles.tagExcluded
                                    : ""
                                }`}
                                onClick={() => onToggleTagIncludeOff(fullTagId)}
                                title={
                                  activeTagFilters.includes(fullTagId)
                                    ? `Click to remove filter for "${tag.name}"`
                                    : excludedTagFilters.includes(fullTagId)
                                    ? `Click to move "${tag.name}" into the selected include group`
                                    : `Click to include "${tag.name}"`
                                }
                                style={buildTagAccentCssVars(
                                  tag.accentId,
                                  customAccentsById,
                                )}
                              >
                                <span className={styles.tagName}>
                                  {tag.name}
                                </span>
                                <button
                                  className={styles.removeTag}
                                  title={`Click to delete this tag`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveTag(tag.id);
                                  }}
                                  aria-label={`Remove tag ${tag.name}`}
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackDetails;
