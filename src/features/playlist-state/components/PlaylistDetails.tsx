import { TrackInsightStats, type PlaylistTrackInsights } from "@/features/track-insights";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, ListPlus, RefreshCw } from "lucide-react";
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
import type { PlaylistMetadata, TrackMetadata } from "@/features/tag-data";
import {
  EntityDetailsCard,
  EntityIconButton,
  EntityOwnValues,
  type EntityMetaItem,
} from "@/features/entity-views";
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
  playlistTrackInsights?: PlaylistTrackInsights;
  onRefreshTrackInsights?: () => void;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onSetRating: (rating: number) => void;
  onSetEnergy: (energy: number) => void;
  onAddTag: (tagId: string) => void;
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
  playlistTrackInsights,
  onRefreshTrackInsights,
  tracks,
  taxonomy,
  activeTagFilters,
  excludedTagFilters,
  onSetRating,
  onSetEnergy,
  onAddTag,
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
  const knownTrackCount = (!isAlbum ? playlistTrackInsights?.listedTrackCount : undefined) ?? playlistMetadata?.trackCount ?? playlistData?.trackCount ?? null;
  const albumUrisToLookUp = useMemo(
    () => (isAlbum && !isTrackTotal(knownTrackCount) ? [playlistUri] : NO_ALBUMS_TO_LOOK_UP),
    [isAlbum, knownTrackCount, playlistUri],
  );
  const albumTrackTotals = useAlbumTrackTotals(albumUrisToLookUp);
  const trackCount = (!isAlbum && knownTrackCount === 0) ? 0 : isTrackTotal(knownTrackCount)
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

  const meta: EntityMetaItem[] = [
    ...(ownerName ? [{ key: "owner", content: ownerName }] : []),
    ...(releaseYear ? [{ key: "year", content: releaseYear }] : []),
    ...(trackCount !== null
      ? [{ key: "tracks", content: `${trackCount} ${trackCount === 1 ? "track" : "tracks"}` }]
      : []),
    ...(playlistData?.dateModified
      ? [{
          key: "updated",
          content: `Updated ${formatCondensedDate(playlistData.dateModified)}`,
          title: dateTitle,
        }]
      : []),
  ];
  // Community links appear only once the album has perspectives to show.
  const communityLinkUrl =
    communityUrl && communityAvailability?.entityUri === playlistUri && communityAvailability.hasPerspectives
      ? communityUrl
      : null;

  return (
    <EntityDetailsCard
      kind={isAlbum ? "album" : "playlist"}
      name={displayName}
      imageUrl={imageUrl}
      meta={meta}
      description={!isAlbum ? description : null}
      openTitle={`Open ${entityLabelLower} in Spotify`}
      onOpen={() => onOpenPlaylist(playlistUri)}
      actions={communityLinkUrl || !isAlbum ? (
        <>
          {communityLinkUrl ? (
            <a
              className={communityLinkStyles.communityLink}
              href={communityLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this album in Tagify Community"
              aria-label="Open this album in Tagify Community"
            >
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
          {!isAlbum ? (
            <EntityIconButton
              label="Refresh playlist details from Spotify"
              onClick={() => onRefreshMetadata(playlistUri)}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </EntityIconButton>
          ) : null}
        </>
      ) : null}
    >
      <EntityOwnValues
        uri={playlistUri}
        entityLabel={entityLabel}
        rating={rating}
        energy={energy}
        onSetRating={onSetRating}
        onSetEnergy={onSetEnergy}
        tags={sortedTags}
        customAccentsById={customAccentsById}
        activeTagFilters={activeTagFilters}
        excludedTagFilters={excludedTagFilters}
        onToggleTagFilter={onToggleTagIncludeOff}
        onRemoveTag={onRemoveTag}
        tagsAction={canApplyToTracks ? (
          <button
            type="button"
            className={styles.applyButton}
            onClick={() => setIsApplyDialogOpen(true)}
            title={`Copy this ${entityLabelLower}'s tags, rating, and energy to its tracks`}
          >
            <ListPlus size={15} aria-hidden="true" />
            <span>Apply to tracks…</span>
          </button>
        ) : null}
      />

      {isAlbum ? (
        <AlbumTrackInsights
          albumUri={playlistUri}
          taxonomy={taxonomy}
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
          appliedTagIds={playlistData?.tagIds}
          onAddTag={onAddTag}
        />
      ) : (
        <TrackInsightStats
          summary={playlistTrackInsights?.summary}
          playlist={playlistTrackInsights}
          onRefresh={onRefreshTrackInsights}
          taxonomy={taxonomy}
          appliedTagIds={playlistData?.tagIds}
          onAddTag={onAddTag}
          entityLabel="playlist"
        />
      )}
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
    </EntityDetailsCard>
  );
};

export default PlaylistDetails;
