import React, { useMemo } from "react";
import { RefreshCw, X } from "lucide-react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { ArtistData, TagTaxonomy } from "@/types/tagData";
import {
  buildResolvedTagLookup,
  compareResolvedTagsByTaxonomyOrder,
} from "@/utils/tagTaxonomy";
import { formatTimestamp } from "@/utils/formatters";
import { buildTagAccentCssVars } from "@/features/tag-data/utils/tagAccent";
import type { ArtistMetadata } from "@/features/tag-data";
import styles from "./ArtistDetails.module.css";

interface ArtistDetailsProps {
  artistUri: string;
  artistData?: ArtistData;
  artistMetadata?: ArtistMetadata | null;
  taxonomy: TagTaxonomy;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onSetRating: (rating: number) => void;
  onSetEnergy: (energy: number) => void;
  onRemoveTag: (tagId: string) => void;
  onToggleTagIncludeOff: (tagId: string) => void;
  onOpenArtist: (artistUri: string) => void;
  onRefreshMetadata: (artistUri: string) => void;
}

function formatFollowers(followerCount: number): string {
  return new Intl.NumberFormat().format(followerCount);
}

const ArtistDetails: React.FC<ArtistDetailsProps> = ({
  artistUri,
  artistData,
  artistMetadata,
  taxonomy,
  activeTagFilters,
  excludedTagFilters,
  onSetRating,
  onSetEnergy,
  onRemoveTag,
  onToggleTagIncludeOff,
  onOpenArtist,
  onRefreshMetadata,
}) => {
  const resolvedLookup = useMemo(() => buildResolvedTagLookup(taxonomy), [taxonomy]);
  const customAccentsById = taxonomy.customAccentsById;
  const displayName = artistData?.name || artistMetadata?.name || "Unknown Artist";
  const imageUrl = artistData?.imageUrl ?? artistMetadata?.imageUrl ?? null;
  const followerCount =
    artistData?.followerCount ?? artistMetadata?.followerCount ?? null;
  const genres = artistData?.genres ?? artistMetadata?.genres ?? [];
  const sortedTags = (artistData?.tagIds || [])
    .map((tagId) => resolvedLookup.get(tagId))
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
    .sort(compareResolvedTagsByTaxonomyOrder);
  const rating = artistData?.rating || 0;
  const energy = artistData?.energy || 0;

  const handleOpenArtist = () => {
    onOpenArtist(artistUri);
  };

  const handleOpenArtistKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpenArtist();
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
            alt={`${displayName} artist image`}
            className={`${styles.cover} ${styles.clickableCover}`}
            onClick={handleOpenArtist}
            onKeyDown={handleOpenArtistKeyDown}
            role="button"
            tabIndex={0}
            title="Open artist in Spotify"
          />
        ) : (
          <div
            className={`${styles.cover} ${styles.coverPlaceholder} ${styles.clickableCover}`}
            onClick={handleOpenArtist}
            onKeyDown={handleOpenArtistKeyDown}
            role="button"
            tabIndex={0}
            title="Open artist in Spotify"
          >
            ♪
          </div>
        )}

        <div className={styles.titleBlock}>
          <p className={styles.eyebrow}>Artist</p>
          <h2
            className={`${styles.title} ${styles.clickableTitle}`}
            onClick={handleOpenArtist}
            onKeyDown={handleOpenArtistKeyDown}
            role="button"
            tabIndex={0}
            title="Open artist in Spotify"
          >
            {displayName}
          </h2>
          <p className={styles.meta}>
            {followerCount !== null && followerCount !== undefined ? (
              <span>{formatFollowers(followerCount)} followers</span>
            ) : null}
            {genres.length > 0 ? <span>{genres.slice(0, 3).join(", ")}</span> : null}
            {artistData?.dateCreated ? (
              <span>Tagged {formatTimestamp(artistData.dateCreated, true)}</span>
            ) : null}
            {artistData?.dateModified ? (
              <span>Updated {formatTimestamp(artistData.dateModified, true)}</span>
            ) : null}
          </p>
        </div>

        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.secondaryButton}`}
            onClick={() => onRefreshMetadata(artistUri)}
            title="Refresh artist metadata"
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className={styles.controlsPanel}>
        <div className={styles.controlSection}>
          <label className={styles.label}>Rating: {rating > 0 ? rating : ""}</label>
          <div className={styles.ratingContainer}>
            <div className={styles.stars} key={`artist-stars-${rating}`}>
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
                aria-label="Clear artist rating"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.controlSection}>
          <label className={styles.label}>
            Energy:
            {energy > 0 ? <span className={styles.energyValue}>{energy}</span> : null}
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
                aria-label="Clear artist energy"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.tagsSection}>
        {sortedTags.length > 0 ? (
          <div className={styles.tags}>
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
                        ? `Exclude "${tag.name}" from artist results`
                        : isExcluded
                          ? `Remove "${tag.name}" from artist filters`
                          : `Filter artists by "${tag.name}"`
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
                    title={`Remove "${tag.name}" from this artist`}
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

export default ArtistDetails;
