import { TrackInsightStats, type ArtistTrackInsights } from "@/features/track-insights";
import React, { useCallback, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { ArtistData, TagTaxonomy } from "@/types/tagData";
import {
  buildResolvedTagLookup,
  compareResolvedTagsByTaxonomyOrder,
} from "@/utils/tagTaxonomy";
import { formatCondensedDate, formatTimestamp } from "@/utils/formatters";
import type { ArtistMetadata } from "@/features/tag-data";
import {
  EntityDetailsCard,
  EntityIconButton,
  EntityOwnValues,
  type EntityMetaItem,
} from "@/features/entity-views";
import communityLinkStyles from "../../community/CommunityEntityLink.module.css";
import { CommunityEntityLens, getCommunityEntityUrl } from "@/features/community";

interface ArtistDetailsProps {
  artistUri: string;
  trackInsights?: ArtistTrackInsights;
  artistData?: ArtistData;
  artistMetadata?: ArtistMetadata | null;
  taxonomy: TagTaxonomy;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onSetRating: (rating: number) => void;
  onSetEnergy: (energy: number) => void;
  onAddTag: (tagId: string) => void;
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
  trackInsights,
  artistData,
  artistMetadata,
  taxonomy,
  activeTagFilters,
  excludedTagFilters,
  onSetRating,
  onSetEnergy,
  onAddTag,
  onRemoveTag,
  onToggleTagIncludeOff,
  onOpenArtist,
  onRefreshMetadata,
}) => {
  const resolvedLookup = useMemo(() => buildResolvedTagLookup(taxonomy), [taxonomy]);
  const customAccentsById = taxonomy.customAccentsById;
  const displayName = artistData?.name || artistMetadata?.name || trackInsights?.summaries.get(artistUri)?.artistName || "Unknown Artist";
  const imageUrl = artistData?.imageUrl ?? artistMetadata?.imageUrl ?? null;
  const followerCount =
    artistData?.followerCount ?? artistMetadata?.followerCount ?? null;
  const genres = artistData?.genres ?? artistMetadata?.genres ?? [];
  const artistTagIds = artistData?.tagIds;
  const sortedTags = useMemo(
    () =>
      (artistTagIds || [])
        .map((tagId) => resolvedLookup.get(tagId))
        .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
        .sort(compareResolvedTagsByTaxonomyOrder),
    [artistTagIds, resolvedLookup],
  );
  const [communityAvailability, setCommunityAvailability] = useState<{
    entityUri: string;
    hasPerspectives: boolean;
  } | null>(null);
  const handleCommunityAvailability = useCallback((entityUri: string, hasPerspectives: boolean) => {
    setCommunityAvailability({ entityUri, hasPerspectives });
  }, []);
  const communityUrl = getCommunityEntityUrl(artistUri);
  // Community links appear only once the artist has perspectives to show.
  const communityLinkUrl =
    communityUrl && communityAvailability?.entityUri === artistUri && communityAvailability.hasPerspectives
      ? communityUrl
      : null;

  const dateTitle = [
    artistData?.dateCreated ? `First tagged ${formatTimestamp(artistData.dateCreated)}` : null,
    artistData?.dateModified ? `Last updated ${formatTimestamp(artistData.dateModified)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const meta: EntityMetaItem[] = [
    ...(followerCount !== null && followerCount !== undefined
      ? [{ key: "followers", content: `${formatFollowers(followerCount)} followers` }]
      : []),
    ...(genres.length > 0 ? [{ key: "genres", content: genres.slice(0, 3).join(", ") }] : []),
    ...(artistData?.dateModified
      ? [{
          key: "updated",
          content: `Updated ${formatCondensedDate(artistData.dateModified)}`,
          title: dateTitle,
        }]
      : []),
  ];

  return (
    <EntityDetailsCard
      kind="artist"
      name={displayName}
      imageUrl={imageUrl}
      meta={meta}
      openTitle="Open artist in Spotify"
      onOpen={() => onOpenArtist(artistUri)}
      actions={
        <>
          {communityLinkUrl ? (
            <a
              className={communityLinkStyles.communityLink}
              href={communityLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this artist in Tagify Community"
              aria-label="Open this artist in Tagify Community"
            >
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
          <EntityIconButton
            label="Refresh artist details from Spotify"
            onClick={() => onRefreshMetadata(artistUri)}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </EntityIconButton>
        </>
      }
    >
      <EntityOwnValues
        uri={artistUri}
        entityLabel="Artist"
        rating={artistData?.rating || 0}
        energy={artistData?.energy || 0}
        onSetRating={onSetRating}
        onSetEnergy={onSetEnergy}
        tags={sortedTags}
        customAccentsById={customAccentsById}
        activeTagFilters={activeTagFilters}
        excludedTagFilters={excludedTagFilters}
        onToggleTagFilter={onToggleTagIncludeOff}
        onRemoveTag={onRemoveTag}
      />
      <TrackInsightStats
        summary={trackInsights?.summaries.get(artistUri)}
        artist={trackInsights}
        taxonomy={taxonomy}
        appliedTagIds={artistData?.tagIds}
        onAddTag={onAddTag}
        entityLabel="artist"
      />
      <CommunityEntityLens entityUri={artistUri} onAvailabilityChange={handleCommunityAvailability} />
    </EntityDetailsCard>
  );
};

export default ArtistDetails;
