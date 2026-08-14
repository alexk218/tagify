import React, { useMemo, useState } from "react";
import { ListPlus, RefreshCw, X } from "lucide-react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import {
  PlaylistData,
  PlaylistTrackApplyMode,
  TagTaxonomy,
} from "@/types/tagData";
import {
  buildResolvedTagLookup,
  compareResolvedTagsByTaxonomyOrder,
} from "@/utils/tagTaxonomy";
import { formatTimestamp } from "@/utils/formatters";
import {
  buildTagAccentCssVars,
  type PlaylistMetadata,
} from "@/features/tag-data";
import styles from "./PlaylistDetails.module.css";

interface PlaylistDetailsProps {
  playlistUri: string;
  playlistData?: PlaylistData;
  playlistMetadata?: PlaylistMetadata | null;
  taxonomy: TagTaxonomy;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onSetRating: (rating: number) => void;
  onSetEnergy: (energy: number) => void;
  onRemoveTag: (tagId: string) => void;
  onToggleTagIncludeOff: (tagId: string) => void;
  onOpenPlaylist: (playlistUri: string) => void;
  onRefreshMetadata: (playlistUri: string) => void;
  onApplyTagsToTracks: (
    playlistUri: string,
    applyMode: PlaylistTrackApplyMode,
  ) => Promise<void>;
  isApplyingTagsToTracks: boolean;
}

const PlaylistDetails: React.FC<PlaylistDetailsProps> = ({
  playlistUri,
  playlistData,
  playlistMetadata,
  taxonomy,
  activeTagFilters,
  excludedTagFilters,
  onSetRating,
  onSetEnergy,
  onRemoveTag,
  onToggleTagIncludeOff,
  onOpenPlaylist,
  onRefreshMetadata,
  onApplyTagsToTracks,
  isApplyingTagsToTracks,
}) => {
  const [showApplyOptions, setShowApplyOptions] = useState(false);
  const resolvedLookup = useMemo(() => buildResolvedTagLookup(taxonomy), [taxonomy]);
  const customAccentsById = taxonomy.customAccentsById;
  const isAlbum = playlistUri.startsWith("spotify:album:");
  const entityLabel = isAlbum ? "Album" : "Playlist";
  const entityLabelLower = entityLabel.toLowerCase();
  const displayName =
    playlistData?.name || playlistMetadata?.name || `Unknown ${entityLabel}`;
  const ownerName = playlistData?.ownerName ?? playlistMetadata?.ownerName ?? null;
  const imageUrl = playlistData?.imageUrl ?? playlistMetadata?.imageUrl ?? null;
  const description =
    playlistData?.description ?? playlistMetadata?.description ?? null;
  const trackCount = playlistData?.trackCount ?? playlistMetadata?.trackCount ?? null;
  const sortedTags = (playlistData?.tagIds || [])
    .map((tagId) => resolvedLookup.get(tagId))
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
    .sort(compareResolvedTagsByTaxonomyOrder);
  const rating = playlistData?.rating || 0;
  const energy = playlistData?.energy || 0;
  const hasTags = sortedTags.length > 0;
  const hasPlaylistLevels = rating > 0 || energy > 0;
  const canApplyToTracks = hasTags || hasPlaylistLevels;
  const applyAllLabel = [
    hasTags ? "tags" : null,
    rating > 0 ? "rating" : null,
    energy > 0 ? "energy" : null,
  ].filter((part): part is string => Boolean(part));

  const handleApplyToTracksClick = () => {
    if (hasPlaylistLevels) {
      setShowApplyOptions((current) => !current);
      return;
    }

    onApplyTagsToTracks(playlistUri, "tags");
  };

  const handleApplyOption = (applyMode: PlaylistTrackApplyMode) => {
    setShowApplyOptions(false);
    onApplyTagsToTracks(playlistUri, applyMode);
  };

  const handleOpenPlaylist = () => {
    onOpenPlaylist(playlistUri);
  };

  const handleOpenPlaylistKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpenPlaylist();
    }
  };

  const handleEnergyInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    onSetEnergy(parseInt(event.target.value, 10));
  };

  const handleEnergyClick = (event: React.MouseEvent<HTMLInputElement>) => {
    const sliderElement = event.currentTarget;
    const rect = sliderElement.getBoundingClientRect();
    const clickPosition = event.clientX - rect.left;
    const sliderWidth = rect.width;
    const percentage = clickPosition / sliderWidth;
    const energyValue = Math.max(1, Math.min(10, Math.round(1 + percentage * 9)));

    onSetEnergy(energyValue);
  };

  return (
    <section className={styles.container}>
      <div className={styles.header}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${displayName} cover`}
            className={`${styles.cover} ${
              isAlbum ? styles.albumCover : styles.playlistCover
            } ${styles.clickableCover}`}
            onClick={handleOpenPlaylist}
            onKeyDown={handleOpenPlaylistKeyDown}
            role="button"
            tabIndex={0}
            title={`Open ${entityLabelLower} in Spotify`}
          />
        ) : (
          <div
            className={`${styles.cover} ${styles.coverPlaceholder} ${
              isAlbum ? styles.albumCover : styles.playlistCover
            } ${styles.clickableCover}`}
            onClick={handleOpenPlaylist}
            onKeyDown={handleOpenPlaylistKeyDown}
            role="button"
            tabIndex={0}
            title={`Open ${entityLabelLower} in Spotify`}
          >
            ♪
          </div>
        )}

        <div className={styles.titleBlock}>
          <p className={styles.eyebrow}>{entityLabel}</p>
          <h2
            className={`${styles.title} ${styles.clickableTitle}`}
            onClick={handleOpenPlaylist}
            onKeyDown={handleOpenPlaylistKeyDown}
            role="button"
            tabIndex={0}
            title={`Open ${entityLabelLower} in Spotify`}
          >
            {displayName}
          </h2>
          <p className={styles.meta}>
            {ownerName ? <span>{ownerName}</span> : null}
            {trackCount !== null && trackCount !== undefined ? (
              <span>{trackCount} tracks</span>
            ) : null}
            {playlistData?.dateCreated ? (
              <span>Tagged {formatTimestamp(playlistData.dateCreated, true)}</span>
            ) : null}
            {playlistData?.dateModified ? (
              <span>Updated {formatTimestamp(playlistData.dateModified, true)}</span>
            ) : null}
          </p>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>

        <div className={styles.actions}>
          {!isAlbum ? (
            <button
              className={`${styles.button} ${styles.secondaryButton}`}
              onClick={() => onRefreshMetadata(playlistUri)}
              title={`Refresh ${entityLabelLower} metadata`}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          ) : null}
          <div className={styles.applyControl}>
            <button
              className={`${styles.button} ${styles.applyButton}`}
              onClick={handleApplyToTracksClick}
              disabled={!canApplyToTracks || isApplyingTagsToTracks}
              title={
                canApplyToTracks
                  ? `Apply this ${entityLabelLower}'s values to every track inside it`
                  : `Add ${entityLabelLower} tags, rating, or energy before applying to tracks`
              }
            >
              <ListPlus size={15} aria-hidden="true" />
              <span>{isApplyingTagsToTracks ? "Applying..." : "Apply to tracks"}</span>
            </button>

            {showApplyOptions && !isApplyingTagsToTracks ? (
              <div className={styles.applyMenu}>
                <button
                  className={styles.applyMenuItem}
                  onClick={() => handleApplyOption("tags")}
                  disabled={!hasTags}
                >
                  Tags only
                </button>
                <button
                  className={styles.applyMenuItem}
                  onClick={() => handleApplyOption("all")}
                >
                  All ({applyAllLabel.join(", ")})
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.controlsPanel}>
        <div className={styles.controlSection}>
          <label className={styles.label}>
            Rating: {rating > 0 ? rating : ""}
          </label>
          <div className={styles.ratingContainer}>
            <div className={styles.stars} key={`playlist-stars-${rating}`}>
              <ReactStars
                count={5}
                value={rating}
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

            {rating > 0 ? (
              <button
                className={styles.clearButton}
                onClick={() => onSetRating(0)}
                aria-label={`Clear ${entityLabelLower} rating`}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.controlSection}>
          <label className={styles.label}>
            Energy:
            {energy > 0 ? (
              <span className={styles.energyValue}>{energy}</span>
            ) : null}
          </label>
          <div className={styles.energyContainer}>
            <input
              type="range"
              min="1"
              max="10"
              value={energy || 5}
              data-is-set={energy > 0 ? "true" : "false"}
              className={`${styles.energySlider} ${
                energy === 0 ? styles.energySliderUnset : ""
              }`}
              onChange={handleEnergyInput}
              onClick={handleEnergyClick}
              onDoubleClick={() => onSetEnergy(0)}
            />
            {energy > 0 ? (
              <button
                className={styles.clearButton}
                onClick={() => onSetEnergy(0)}
                aria-label={`Clear ${entityLabelLower} energy`}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.tagsSection}>
        {sortedTags.length > 0 ? (
          <div className={styles.tags} aria-label={`${entityLabel} tags`}>
            {sortedTags.map((tag) => {
              const isActive = activeTagFilters.includes(tag.id);
              const isExcluded = excludedTagFilters.includes(tag.id);

              return (
                <span
                  key={tag.id}
                  className={`${styles.tag} ${
                    tag.tag.accentId ? styles.tagAccented : ""
                  } ${isActive ? styles.tagActive : ""} ${
                    isExcluded ? styles.tagExcluded : ""
                  }`}
                  style={buildTagAccentCssVars(
                    tag.tag.accentId ?? null,
                    customAccentsById,
                  )}
                >
                  <button
                    className={styles.tagLabelButton}
                    onClick={() => onToggleTagIncludeOff(tag.id)}
                    aria-label={
                      isActive
                        ? `Exclude "${tag.name}"`
                        : isExcluded
                          ? `Remove "${tag.name}" filter`
                          : `Include "${tag.name}"`
                    }
                    title={
                      isActive
                        ? `Exclude "${tag.name}" from ${entityLabelLower} results`
                        : isExcluded
                          ? `Remove "${tag.name}" from ${entityLabelLower} filters`
                          : `Filter ${entityLabelLower}s by "${tag.name}"`
                    }
                  >
                    {tag.name}
                  </button>
                  <button
                    className={styles.removeTag}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveTag(tag.id);
                    }}
                    title={`Remove "${tag.name}" from this ${entityLabelLower}`}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <p className={styles.noTags}>No tags applied</p>
        )}
      </div>
    </section>
  );
};

export default PlaylistDetails;
