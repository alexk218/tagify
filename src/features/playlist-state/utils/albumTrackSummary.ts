import {
  AlbumTrackSummary,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";
import {
  buildResolvedTagLookup,
  compareResolvedTagsByTaxonomyOrder,
} from "@/utils/tagTaxonomy";

const COMMON_TAG_MIN_COVERAGE = 0.25;
// One track's rating or tags are just that track's, so album averages and
// common tags need at least two contributing tracks.
const MIN_CONTRIBUTING_TRACKS = 2;

interface AlbumTrackAccumulator {
  taggedTrackCount: number;
  tracksWithTagsCount: number;
  ratingTotal: number;
  ratedTrackCount: number;
  energyTotal: number;
  energyTrackCount: number;
  tagCounts: Map<string, number>;
  albumName: string | null;
  artistCounts: Map<string, number>;
  imageUrl: string | null;
  lastTaggedAt: number;
}

export interface AlbumProgress {
  taggedTrackCount: number;
  totalTrackCount: number | null;
  /** From 0 to 1, or null while the album's length is unknown. */
  ratio: number | null;
  isComplete: boolean;
}

function getPrimaryArtist(artists: string | undefined): string | null {
  const primaryArtist = artists?.split(", ")[0]?.trim();
  return primaryArtist || null;
}

export function buildAlbumTrackSummaries(
  tracks: Record<string, TrackData>,
  taxonomy: TagTaxonomy,
): Map<string, AlbumTrackSummary> {
  const accumulators = new Map<string, AlbumTrackAccumulator>();
  const resolvedTags = buildResolvedTagLookup(taxonomy);

  Object.values(tracks).forEach((track) => {
    if (!track.albumUri) {
      return;
    }

    const knownTagIds = Array.from(new Set(track.tagIds)).filter((tagId) =>
      resolvedTags.has(tagId),
    );
    if (track.rating <= 0 && track.energy <= 0 && knownTagIds.length === 0) {
      return;
    }

    const accumulator = accumulators.get(track.albumUri) || {
      taggedTrackCount: 0,
      tracksWithTagsCount: 0,
      ratingTotal: 0,
      ratedTrackCount: 0,
      energyTotal: 0,
      energyTrackCount: 0,
      tagCounts: new Map<string, number>(),
      albumName: null,
      artistCounts: new Map<string, number>(),
      imageUrl: null,
      lastTaggedAt: 0,
    };

    accumulator.taggedTrackCount += 1;
    accumulator.albumName ||= track.albumName || null;
    accumulator.imageUrl ||= track.albumImageUrl || null;
    accumulator.lastTaggedAt = Math.max(
      accumulator.lastTaggedAt,
      track.dateModified || track.dateCreated || 0,
    );

    const primaryArtist = getPrimaryArtist(track.artists);
    if (primaryArtist) {
      accumulator.artistCounts.set(
        primaryArtist,
        (accumulator.artistCounts.get(primaryArtist) || 0) + 1,
      );
    }

    if (track.rating > 0) {
      accumulator.ratingTotal += track.rating;
      accumulator.ratedTrackCount += 1;
    }

    if (track.energy > 0) {
      accumulator.energyTotal += track.energy;
      accumulator.energyTrackCount += 1;
    }

    if (knownTagIds.length > 0) {
      accumulator.tracksWithTagsCount += 1;
    }
    knownTagIds.forEach((tagId) => {
      accumulator.tagCounts.set(tagId, (accumulator.tagCounts.get(tagId) || 0) + 1);
    });

    accumulators.set(track.albumUri, accumulator);
  });

  return new Map(
    Array.from(accumulators, ([albumUri, accumulator]) => {
      const commonTags = Array.from(accumulator.tagCounts, ([tagId, trackCount]) => ({
        tagId,
        trackCount,
        coverage: trackCount / accumulator.taggedTrackCount,
      }))
        .filter(
          (tag) =>
            accumulator.tracksWithTagsCount >= MIN_CONTRIBUTING_TRACKS &&
            tag.coverage >= COMMON_TAG_MIN_COVERAGE,
        )
        .sort((left, right) => {
          const countComparison = right.trackCount - left.trackCount;
          if (countComparison !== 0) {
            return countComparison;
          }

          const leftResolved = resolvedTags.get(left.tagId);
          const rightResolved = resolvedTags.get(right.tagId);
          if (leftResolved && rightResolved) {
            return compareResolvedTagsByTaxonomyOrder(leftResolved, rightResolved);
          }

          return left.tagId.localeCompare(right.tagId);
        });

      // Most tracks share the album artist; featured artists only appear on a few.
      const artistName =
        Array.from(accumulator.artistCounts).reduce<[string, number] | null>(
          (best, entry) => (!best || entry[1] > best[1] ? entry : best),
          null,
        )?.[0] ?? null;

      const summary: AlbumTrackSummary = {
        taggedTrackCount: accumulator.taggedTrackCount,
        ratedTrackCount: accumulator.ratedTrackCount,
        ratingAverage:
          accumulator.ratedTrackCount >= MIN_CONTRIBUTING_TRACKS
            ? accumulator.ratingTotal / accumulator.ratedTrackCount
            : null,
        energyTrackCount: accumulator.energyTrackCount,
        energyAverage:
          accumulator.energyTrackCount >= MIN_CONTRIBUTING_TRACKS
            ? accumulator.energyTotal / accumulator.energyTrackCount
            : null,
        commonTags,
        albumName: accumulator.albumName,
        artistName,
        imageUrl: accumulator.imageUrl,
        lastTaggedAt: accumulator.lastTaggedAt || null,
      };

      return [albumUri, summary];
    }),
  );
}

export function getAlbumProgress(
  taggedTrackCount: number,
  totalTrackCount: number | null | undefined,
): AlbumProgress {
  const total =
    typeof totalTrackCount === "number" && totalTrackCount > 0 ? totalTrackCount : null;
  // Spotify can drop tracks from an album after they were tagged.
  const tagged = total === null ? taggedTrackCount : Math.min(taggedTrackCount, total);

  return {
    taggedTrackCount: tagged,
    totalTrackCount: total,
    ratio: total === null ? null : tagged / total,
    isComplete: total !== null && tagged >= total,
  };
}

export function formatTrackAverage(value: number): string {
  return value.toFixed(1);
}

function pluralizeTracks(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

export function describeAlbumProgress(
  taggedTrackCount: number,
  totalTrackCount: number | null,
): string {
  if (totalTrackCount === null) {
    return `${pluralizeTracks(taggedTrackCount)} rated or tagged`;
  }
  if (taggedTrackCount >= totalTrackCount) {
    return totalTrackCount === 1
      ? "The only track is rated or tagged"
      : `All ${totalTrackCount} tracks rated or tagged`;
  }
  if (taggedTrackCount === 0) {
    return `None of the ${pluralizeTracks(totalTrackCount)} rated or tagged yet`;
  }
  return `${taggedTrackCount} of ${pluralizeTracks(totalTrackCount)} rated or tagged`;
}
