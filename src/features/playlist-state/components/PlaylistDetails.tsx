import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, ListPlus, RefreshCw, X } from "lucide-react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import {
  AlbumTrackSummary,
  BatchTagUpdate,
  PlaylistData,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";
import {
  buildResolvedTagLookup,
  compareResolvedTagsByTaxonomyOrder,
} from "@/utils/tagTaxonomy";
import { formatCondensedDate, formatTimestamp } from "@/utils/formatters";
import {
  buildTagAccentCssVars,
  type PlaylistMetadata,
  type TrackMetadata,
} from "@/features/tag-data";
import { CommunityEntityLens, getCommunityEntityUrl } from "@/features/community";
import { useAlbumTrackTotals } from "../hooks/useAlbumTrackTotals";
import { albumTrackTotalsStore } from "../services/albumTrackTotals";
import AlbumTrackInsights from "./AlbumTrackInsights";
import ApplyToTracksDialog from "./ApplyToTracksDialog";
import styles from "./PlaylistDetails.module.css";
import communityLinkStyles from "../../community/CommunityEntityLink.module.css";

interface PlaylistDetailsProps {
  playlistUri: string;
  playlistData?: PlaylistData;
  playlistMetadata?: PlaylistMetadata | null;
  albumTrackSummary?: AlbumTrackSummary;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onSetRating: (rating: number) => void;
  onSetEnergy: (energy: number) => void;
  onRemoveTag: (tagId: string) => void;
  onToggleTagIncludeOff: (tagId: string) => void;
  onOpenPlaylist: (playlistUri: string) => void;
  onRefreshMetadata: (playlistUri: string) => void;
  onLoadTrackUris: (playlistUri: string) => Promise<string[]>;
  onApplyTrackUpdates: (updates: BatchTagUpdate[]) => Promise<void>;
  /** Opens one of the album's tracks for rating or tagging. */
  onTagTrack: (trackUri: string) => void;
  /** Rates one of the album's tracks, saving it with the album if it's new. */
  onSetTrackRating: (trackUri: string, rating: number, metadata: TrackMetadata) => void;
}

const NO_ALBUMS_TO_LOOK_UP: string[] = [];

function isTrackTotal(value: number | null | undefined): value is number {
  return typeof value === "number" && value > 0;
}

/** Album descriptions are "Released YYYY-MM-DD"; Spotify shows just the year. */
function getReleaseYear(description: string | null): string | null {
  return description?.match(/^Released (\d{4})\b/)?.[1] ?? null;
}

const PlaylistDetails: React.FC<PlaylistDetailsProps> = ({
  playlistUri,
  playlistData,
  playlistMetadata,
  albumTrackSummary,
  tracks,
  taxonomy,
  activeTagFilters,
  excludedTagFilters,
  onSetRating,
  onSetEnergy,
  onRemoveTag,
  onToggleTagIncludeOff,
  onOpenPlaylist,
  onRefreshMetadata,
  onLoadTrackUris,
  onApplyTrackUpdates,
  onTagTrack,
  onSetTrackRating,
}) => {
  const [isApplyDialogOpen, setIsApplyDialogOpen] = useState(false);
  const resolvedLookup = useMemo(() => buildResolvedTagLookup(taxonomy), [taxonomy]);
  const customAccentsById = taxonomy.customAccentsById;
  const isAlbum = playlistUri.startsWith("spotify:album:");
  const [communityAvailability, setCommunityAvailability] = useState<{
    entityUri: string;
    hasPerspectives: boolean;
  } | null>(null);
  const handleCommunityAvailability = useCallback((entityUri: string, hasPerspectives: boolean) => {
    setCommunityAvailability({ entityUri, hasPerspectives });
  }, []);
  const communityUrl = isAlbum ? getCommunityEntityUrl(playlistUri) : null;
  const entityLabel = isAlbum ? "Album" : "Playlist";
  const entityLabelLower = entityLabel.toLowerCase();
  const knownName =
    playlistData?.name || playlistMetadata?.name || albumTrackSummary?.albumName || null;
  const displayName = knownName || `Unknown ${entityLabel}`;
  const ownerName =
    playlistData?.ownerName ??
    playlistMetadata?.ownerName ??
    albumTrackSummary?.artistName ??
    null;
  const imageUrl =
    playlistData?.imageUrl ??
    playlistMetadata?.imageUrl ??
    albumTrackSummary?.imageUrl ??
    null;
  const description =
    playlistData?.description ?? playlistMetadata?.description ?? null;
  const releaseYear = isAlbum ? getReleaseYear(description) : null;
  const knownTrackCount = playlistMetadata?.trackCount ?? playlistData?.trackCount ?? null;
  const albumUrisToLookUp = useMemo(
    () => (isAlbum && !isTrackTotal(knownTrackCount) ? [playlistUri] : NO_ALBUMS_TO_LOOK_UP),
    [isAlbum, knownTrackCount, playlistUri],
  );
  const albumTrackTotals = useAlbumTrackTotals(albumUrisToLookUp);
  const trackCount = isTrackTotal(knownTrackCount)
    ? knownTrackCount
    : isAlbum
      ? (albumTrackTotals[playlistUri] ?? null)
      : null;
  const playlistTagIds = playlistData?.tagIds;
  const sortedTags = useMemo(
    () =>
      (playlistTagIds || [])
        .map((tagId) => resolvedLookup.get(tagId))
        .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
        .sort(compareResolvedTagsByTaxonomyOrder),
    [playlistTagIds, resolvedLookup],
  );
  const rating = playlistData?.rating || 0;
  const energy = playlistData?.energy || 0;
  const canApplyToTracks = sortedTags.length > 0 || rating > 0 || energy > 0;
  const applyValues = useMemo(
    () => ({ tagIds: sortedTags.map((tag) => tag.id), rating, energy }),
    [sortedTags, rating, energy],
  );
  const freshAlbumTrackCount = isAlbum ? playlistMetadata?.trackCount : null;

  useEffect(() => {
    if (isTrackTotal(freshAlbumTrackCount)) {
      albumTrackTotalsStore.remember({ [playlistUri]: freshAlbumTrackCount });
    }
  }, [freshAlbumTrackCount, playlistUri]);

  useEffect(() => {
    setIsApplyDialogOpen(false);
  }, [playlistUri]);

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

  const dateTitle = [
    playlistData?.dateCreated
      ? `First tagged ${formatTimestamp(playlistData.dateCreated)}`
      : null,
    playlistData?.dateModified
      ? `Last updated ${formatTimestamp(playlistData.dateModified)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

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
            {releaseYear ? <span>{releaseYear}</span> : null}
            {trackCount !== null ? (
              <span>
                {trackCount} {trackCount === 1 ? "track" : "tracks"}
              </span>
            ) : null}
            {playlistData?.dateModified ? (
              <span title={dateTitle}>
                Updated {formatCondensedDate(playlistData.dateModified)}
              </span>
            ) : null}
          </p>
          {!isAlbum && description ? (
            <p className={styles.description}>{description}</p>
          ) : null}
        </div>

        <div className={styles.actions}>
          {communityUrl && communityAvailability?.entityUri === playlistUri && communityAvailability.hasPerspectives ? (
            <a
              className={communityLinkStyles.communityLink}
              href={communityUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this album in Tagify Community"
              aria-label="Open this album in Tagify Community"
            >
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
          {!isAlbum ? (
            <button
              className={styles.iconButton}
              onClick={() => onRefreshMetadata(playlistUri)}
              title="Refresh playlist details from Spotify"
              aria-label="Refresh playlist details from Spotify"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.ownValues}>
        <div className={styles.controlsRow}>
          <div className={styles.controlSection}>
            <label className={styles.label}>
              {entityLabel} rating
              {rating > 0 ? <span className={styles.ratingValue}>{rating}</span> : null}
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
              {entityLabel} energy
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
                aria-label={`${entityLabel} energy`}
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

        <div className={styles.tagsRow}>
          <span className={styles.rowLabel}>{entityLabel} tags</span>
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
                        isActive || isExcluded
                          ? `Remove "${tag.name}" filter`
                          : `Include "${tag.name}"`
                      }
                      title={
                        isActive || isExcluded
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
                      aria-label={`Remove "${tag.name}" from this ${entityLabelLower}`}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : (
            <span className={styles.noTags}>None yet. Choose tags below.</span>
          )}

          {canApplyToTracks ? (
            <button
              className={styles.applyButton}
              onClick={() => setIsApplyDialogOpen(true)}
              title={`Copy this ${entityLabelLower}'s tags, rating, and energy to its tracks`}
            >
              <ListPlus size={15} aria-hidden="true" />
              <span>Apply to tracks…</span>
            </button>
          ) : null}
        </div>
      </div>

      {isAlbum ? (
        <AlbumTrackInsights
          albumUri={playlistUri}
          tracks={tracks}
          onTagTrack={onTagTrack}
          onRateTrack={(trackUri, rating, track) =>
            onSetTrackRating(trackUri, rating, {
              ...track,
              albumName: knownName ?? undefined,
              albumUri: playlistUri,
              albumImageUrl: imageUrl,
            })
          }
          summary={albumTrackSummary}
          totalTrackCount={trackCount}
          resolvedLookup={resolvedLookup}
          customAccentsById={customAccentsById}
          activeTagFilters={activeTagFilters}
          excludedTagFilters={excludedTagFilters}
          onToggleTagIncludeOff={onToggleTagIncludeOff}
        />
      ) : null}

      {isAlbum ? <CommunityEntityLens entityUri={playlistUri} onAvailabilityChange={handleCommunityAvailability} /> : null}

      {isApplyDialogOpen ? (
        <ApplyToTracksDialog
          entityLabel={entityLabel}
          name={displayName}
          ownerName={ownerName}
          values={applyValues}
          albumDetails={
            isAlbum
              ? {
                  albumUri: playlistUri,
                  albumName: knownName ?? undefined,
                  albumImageUrl: imageUrl,
                }
              : undefined
          }
          tagNames={sortedTags.map((tag) => tag.name)}
          tracks={tracks}
          loadTrackUris={() => onLoadTrackUris(playlistUri)}
          onApply={onApplyTrackUpdates}
          onClose={() => setIsApplyDialogOpen(false)}
        />
      ) : null}
    </section>
  );
};

export default PlaylistDetails;
