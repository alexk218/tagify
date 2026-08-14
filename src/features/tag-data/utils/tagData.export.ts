import { TagDataStructure } from "@/types/tagData";
import {
  buildResolvedTagLookup,
  findDisplayTagName,
  TAG_DATA_SCHEMA_VERSION,
} from "@/utils/tagTaxonomy";

interface TagAnalytics {
  id: string;
  name: string;
  order: number;
  usage_count: number;
  is_used: boolean;
  full_path: string;
}

interface SubcategoryAnalytics {
  id: string;
  name: string;
  order: number;
  total_tags: number;
  used_tags: number;
  unused_tags: number;
  tags: TagAnalytics[];
}

interface CategoryAnalytics {
  id: string;
  name: string;
  order: number;
  total_subcategories: number;
  total_tags: number;
  used_tags: number;
  unused_tags: number;
  subcategories: SubcategoryAnalytics[];
}

interface TagUsageSummary {
  most_used_tags: Array<{
    name: string;
    usage_count: number;
  }>;
  unused_tag_names: string[];
  usage_percentage: number;
}

interface ExportedTrackTag {
  tagId: string;
  categoryId: string;
  subcategoryId: string;
  name: string;
  full_path: string;
}

interface ExportedTrackData {
  rating: number;
  energy: number;
  bpm: number | null;
  tags: ExportedTrackTag[];
  rekordbox_comment: string;
}

interface ExportedPlaylistData {
  rating: number;
  energy: number;
  name: string;
  owner_name: string | null;
  description: string | null;
  image_url: string | null;
  track_count: number | null;
  snapshot_id: string | null;
  tags: ExportedTrackTag[];
}

interface ExportedArtistData {
  rating: number;
  energy: number;
  name: string;
  image_url: string | null;
  follower_count: number | null;
  genres: string[];
  tags: ExportedTrackTag[];
}

interface TagAnalyticsData {
  total_categories: number;
  total_subcategories: number;
  total_tags: number;
  used_tags: number;
  unused_tags: number;
  categories: CategoryAnalytics[];
  tag_usage_summary: TagUsageSummary;
}

export interface ExportDataResult {
  version: string;
  schema_version: number;
  exported_at: string;
  tracks: {
    [trackUri: string]: ExportedTrackData;
  };
  playlists: {
    [playlistUri: string]: ExportedPlaylistData;
  };
  artists: {
    [artistUri: string]: ExportedArtistData;
  };
  tag_analytics: TagAnalyticsData;
}

export function buildExportData(tagData: TagDataStructure): ExportDataResult {
  const resolvedLookup = buildResolvedTagLookup(tagData.taxonomy);
  const tagUsageMap = new Map<string, number>();

  resolvedLookup.forEach((_, tagId) => {
    tagUsageMap.set(tagId, 0);
  });

  Object.values(tagData.tracks).forEach((trackDataEntry) => {
    trackDataEntry.tagIds.forEach((tagId) => {
      tagUsageMap.set(tagId, (tagUsageMap.get(tagId) || 0) + 1);
    });
  });
  Object.values(tagData.playlists || {}).forEach((playlistDataEntry) => {
    playlistDataEntry.tagIds.forEach((tagId) => {
      tagUsageMap.set(tagId, (tagUsageMap.get(tagId) || 0) + 1);
    });
  });
  Object.values(tagData.artists || {}).forEach((artistDataEntry) => {
    artistDataEntry.tagIds.forEach((tagId) => {
      tagUsageMap.set(tagId, (tagUsageMap.get(tagId) || 0) + 1);
    });
  });

  const result: ExportDataResult = {
    version: "2.0",
    schema_version: TAG_DATA_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    tracks: {},
    playlists: {},
    artists: {},
    tag_analytics: {
      total_categories: tagData.taxonomy.categoryOrder.length,
      total_subcategories: 0,
      total_tags: 0,
      used_tags: 0,
      unused_tags: 0,
      categories: [],
      tag_usage_summary: {
        most_used_tags: [],
        unused_tag_names: [],
        usage_percentage: 0,
      },
    },
  };

  tagData.taxonomy.categoryOrder.forEach((categoryId, categoryIndex) => {
    const category = tagData.taxonomy.categoriesById[categoryId];
    if (!category) {
      return;
    }

    const categoryAnalytics: CategoryAnalytics = {
      id: category.id,
      name: category.name,
      order: categoryIndex,
      total_subcategories: category.subcategoryIds.length,
      total_tags: 0,
      used_tags: 0,
      unused_tags: 0,
      subcategories: [],
    };

    category.subcategoryIds.forEach((subcategoryId, subcategoryIndex) => {
      const subcategory = tagData.taxonomy.subcategoriesById[subcategoryId];
      if (!subcategory) {
        return;
      }

      const subcategoryAnalytics: SubcategoryAnalytics = {
        id: subcategory.id,
        name: subcategory.name,
        order: subcategoryIndex,
        total_tags: subcategory.tagIds.length,
        used_tags: 0,
        unused_tags: 0,
        tags: [],
      };

      subcategory.tagIds.forEach((tagId, tagIndex) => {
        const resolvedTag = resolvedLookup.get(tagId);
        if (!resolvedTag) {
          return;
        }

        const usageCount = tagUsageMap.get(tagId) || 0;
        const isUsed = usageCount > 0;
        subcategoryAnalytics.tags.push({
          id: tagId,
          name: resolvedTag.name,
          order: tagIndex,
          usage_count: usageCount,
          is_used: isUsed,
          full_path: resolvedTag.displayPath,
        });

        categoryAnalytics.total_tags += 1;
        result.tag_analytics.total_tags += 1;

        if (isUsed) {
          subcategoryAnalytics.used_tags += 1;
          categoryAnalytics.used_tags += 1;
          result.tag_analytics.used_tags += 1;
        } else {
          subcategoryAnalytics.unused_tags += 1;
          categoryAnalytics.unused_tags += 1;
          result.tag_analytics.unused_tags += 1;
        }
      });

      categoryAnalytics.subcategories.push(subcategoryAnalytics);
      result.tag_analytics.total_subcategories += 1;
    });

    result.tag_analytics.categories.push(categoryAnalytics);
  });

  const usedTags: Array<{ name: string; count: number }> = [];
  const unusedTags: string[] = [];
  tagUsageMap.forEach((count, tagId) => {
    const tagName = findDisplayTagName(tagData.taxonomy, tagId, {
      disambiguate: true,
    });

    if (count > 0) {
      usedTags.push({ name: tagName, count });
    } else {
      unusedTags.push(tagName);
    }
  });

  result.tag_analytics.tag_usage_summary = {
    most_used_tags: usedTags
      .sort((left, right) => right.count - left.count)
      .slice(0, 10)
      .map((tag) => ({ name: tag.name, usage_count: tag.count })),
    unused_tag_names: unusedTags.sort(),
    usage_percentage:
      result.tag_analytics.total_tags > 0
        ? Math.round(
            (result.tag_analytics.used_tags / result.tag_analytics.total_tags) *
              100,
          )
        : 0,
  };

  Object.entries(tagData.tracks).forEach(([trackUri, trackDataEntry]) => {
    if (
      trackDataEntry.rating === 0 &&
      trackDataEntry.energy === 0 &&
      trackDataEntry.tagIds.length === 0
    ) {
      return;
    }

    const resolvedTags = trackDataEntry.tagIds
      .map((tagId) => resolvedLookup.get(tagId))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    const tagNames = resolvedTags.map((tag) => tag.name);

    const energyComment = trackDataEntry.energy > 0 ? `Energy ${trackDataEntry.energy} - ` : "";
    const bpmComment = trackDataEntry.bpm !== null ? `BPM ${trackDataEntry.bpm} - ` : "";

    result.tracks[trackUri] = {
      rating: trackDataEntry.rating,
      energy: trackDataEntry.energy,
      bpm: trackDataEntry.bpm,
      tags: resolvedTags.map((tag) => ({
        tagId: tag.id,
        categoryId: tag.category.id,
        subcategoryId: tag.subcategory.id,
        name: tag.name,
        full_path: tag.displayPath,
      })),
      rekordbox_comment:
        tagNames.length > 0
          ? `${bpmComment}${energyComment}${tagNames.join(", ")}`
          : (bpmComment + energyComment).length > 0
            ? (bpmComment + energyComment).slice(0, -3)
            : "",
    };
  });

  Object.entries(tagData.playlists || {}).forEach(([playlistUri, playlistDataEntry]) => {
    if (
      playlistDataEntry.rating === 0 &&
      playlistDataEntry.energy === 0 &&
      playlistDataEntry.tagIds.length === 0
    ) {
      return;
    }

    const resolvedTags = playlistDataEntry.tagIds
      .map((tagId) => resolvedLookup.get(tagId))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));

    result.playlists[playlistUri] = {
      rating: playlistDataEntry.rating,
      energy: playlistDataEntry.energy,
      name: playlistDataEntry.name || "Unknown Playlist",
      owner_name: playlistDataEntry.ownerName ?? null,
      description: playlistDataEntry.description ?? null,
      image_url: playlistDataEntry.imageUrl ?? null,
      track_count: playlistDataEntry.trackCount ?? null,
      snapshot_id: playlistDataEntry.snapshotId ?? null,
      tags: resolvedTags.map((tag) => ({
        tagId: tag.id,
        categoryId: tag.category.id,
        subcategoryId: tag.subcategory.id,
        name: tag.name,
        full_path: tag.displayPath,
      })),
    };
  });

  Object.entries(tagData.artists || {}).forEach(([artistUri, artistDataEntry]) => {
    if (
      artistDataEntry.rating === 0 &&
      artistDataEntry.energy === 0 &&
      artistDataEntry.tagIds.length === 0
    ) {
      return;
    }

    const resolvedTags = artistDataEntry.tagIds
      .map((tagId) => resolvedLookup.get(tagId))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));

    result.artists[artistUri] = {
      rating: artistDataEntry.rating,
      energy: artistDataEntry.energy,
      name: artistDataEntry.name || "Unknown Artist",
      image_url: artistDataEntry.imageUrl ?? null,
      follower_count: artistDataEntry.followerCount ?? null,
      genres: artistDataEntry.genres || [],
      tags: resolvedTags.map((tag) => ({
        tagId: tag.id,
        categoryId: tag.category.id,
        subcategoryId: tag.subcategory.id,
        name: tag.name,
        full_path: tag.displayPath,
      })),
    };
  });

  return result;
}
