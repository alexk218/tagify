import { SORT_OPTIONS, SORT_ORDERS } from "@/constants/trackList";
import { TagTaxonomy } from "@/types/tagData";
import { parseLocalFileUri } from "@/utils/LocalFileParser";
import { normalizeCamelotKey, sortCamelotKeys } from "@/utils/camelotKey";
import { evaluateTagFilterFormula } from "@/utils/tagFilterGroups";
import {
  buildDuplicateTagNameSet,
  buildResolvedTagLookup,
} from "@/utils/tagTaxonomy";
import {
  BuildSmartPlaylistCriteriaInputs,
  ResolvedTag,
  SmartPlaylistCriteria,
  TagDisplayInfo,
  TrackListEntry,
  TrackListFilterInputs,
  TrackListSortInputs,
  TrackListTrackData,
  TrackListTrackInfo,
} from "@/features/track-session/model/trackList.types";

export function buildTagDisplayLookup(
  taxonomy: TagTaxonomy,
  options: { disambiguate?: boolean } = {},
): Map<string, TagDisplayInfo> {
  const lookup = new Map<string, TagDisplayInfo>();
  const resolvedLookup = buildResolvedTagLookup(taxonomy);
  const duplicateNames = options.disambiguate
    ? buildDuplicateTagNameSet(taxonomy)
    : null;

  resolvedLookup.forEach((resolvedTag, tagId) => {
    const shouldDisambiguate =
      options.disambiguate &&
      duplicateNames?.has(resolvedTag.name.toLowerCase());

    lookup.set(tagId, {
      displayName: shouldDisambiguate
        ? `${resolvedTag.name} (${resolvedTag.subcategoryName} / ${resolvedTag.categoryName})`
        : resolvedTag.name,
      accentId: resolvedTag.tag.accentId ?? null,
    });
  });

  return lookup;
}

export function buildTagNameLookup(
  taxonomy: TagTaxonomy,
  options: { disambiguate?: boolean } = {},
): Map<string, string> {
  return new Map(
    Array.from(buildTagDisplayLookup(taxonomy, options)).map(([tagId, tagInfo]) => [
      tagId,
      tagInfo.displayName,
    ]),
  );
}

export function buildTagPositionLookup(
  taxonomy: TagTaxonomy,
): Map<string, string> {
  const lookup = new Map<string, string>();
  const resolvedLookup = buildResolvedTagLookup(taxonomy);

  resolvedLookup.forEach((resolvedTag, tagId) => {
    const positionKey = `${String(resolvedTag.categoryOrder).padStart(3, "0")}-${String(
      resolvedTag.subcategoryOrder,
    ).padStart(3, "0")}-${String(resolvedTag.tagOrder).padStart(3, "0")}`;
    lookup.set(tagId, positionKey);
  });

  return lookup;
}

export function buildTrackInfoMap(
  trackEntries: TrackListEntry[],
): Record<string, TrackListTrackInfo> {
  const infoMap: Record<string, TrackListTrackInfo> = {};

  trackEntries.forEach(([uri, trackData]) => {
    if (uri.startsWith("spotify:local:")) {
      const parsedLocalFile = parseLocalFileUri(uri);
      infoMap[uri] = {
        name: parsedLocalFile.title,
        artists: parsedLocalFile.artist,
      };
      return;
    }

    if (trackData?.name && trackData?.artists) {
      infoMap[uri] = {
        name: trackData.name,
        artists: trackData.artists,
      };
      return;
    }

    infoMap[uri] = {
      name: "Unknown Track",
      artists: "Unknown Artist",
    };
  });

  return infoMap;
}

export function getResolvedTrackTags(
  trackData: TrackListTrackData,
  tagDisplayLookup: Map<string, TagDisplayInfo>,
): ResolvedTag[] {
  return (trackData.tagIds || [])
    .map((tagId): ResolvedTag | null => {
      const tagInfo = tagDisplayLookup.get(tagId);
      if (!tagInfo) {
        return null;
      }

      return {
        displayName: tagInfo.displayName,
        tagId,
        accentId: tagInfo.accentId,
      };
    })
    .filter((tag): tag is ResolvedTag => tag !== null);
}

export function sortResolvedTags(
  tags: ResolvedTag[],
  tagPositionLookup: Map<string, string>,
): ResolvedTag[] {
  return [...tags].sort((a, b) => {
    const posA = tagPositionLookup.get(a.tagId) || "999-999-999";
    const posB = tagPositionLookup.get(b.tagId) || "999-999-999";
    return posA.localeCompare(posB);
  });
}

export function sortTrackEntries(
  tracksToSort: TrackListEntry[],
  trackInfo: Record<string, TrackListTrackInfo>,
  { sortBy, sortOrder }: TrackListSortInputs,
): TrackListEntry[] {
  return [...tracksToSort].sort((a, b) => {
    const [uriA, dataA] = a;
    const [uriB, dataB] = b;
    const infoA = trackInfo[uriA];
    const infoB = trackInfo[uriB];

    let comparison = 0;

    switch (sortBy) {
      case SORT_OPTIONS.ALPHABETICAL: {
        if (!infoA || !infoB) return 0;
        comparison = infoA.name.localeCompare(infoB.name);
        break;
      }
      case SORT_OPTIONS.DATE_CREATED: {
        comparison = (dataA.dateCreated || 0) - (dataB.dateCreated || 0);
        break;
      }
      case SORT_OPTIONS.DATE_MODIFIED: {
        comparison = (dataA.dateModified || 0) - (dataB.dateModified || 0);
        break;
      }
      case SORT_OPTIONS.RATING: {
        comparison = dataA.rating - dataB.rating;
        break;
      }
      case SORT_OPTIONS.ENERGY: {
        comparison = dataA.energy - dataB.energy;
        break;
      }
      case SORT_OPTIONS.BPM: {
        comparison = (dataA.bpm || 0) - (dataB.bpm || 0);
        break;
      }
      default:
        return 0;
    }

    return sortOrder === SORT_ORDERS.DESC ? -comparison : comparison;
  });
}

function getTrackTagIds(trackData: TrackListTrackData): string[] {
  return trackData.tagIds || [];
}

export function filterTrackEntries(
  trackEntries: TrackListEntry[],
  trackInfo: Record<string, TrackListTrackInfo>,
  {
    includeTagClauses,
    clauseConnectors,
    ratingFilters,
    energyMinFilter,
    energyMaxFilter,
    bpmMinFilter,
    bpmMaxFilter,
    normalizedCamelotKeyFilters,
    searchTerm,
  }: TrackListFilterInputs,
): TrackListEntry[] {
  const resolvedIncludeTagClauses = includeTagClauses ?? [];
  const resolvedClauseConnectors = clauseConnectors ?? [];

  return trackEntries.filter(([uri, trackData]) => {
    const info = trackInfo[uri];
    const isLocalFile = uri.startsWith("spotify:local:");
    const hasMetadata = !!info;

    if (!isLocalFile && !hasMetadata) {
      return false;
    }

    const trackTagIds = getTrackTagIds(trackData);

    const matchesIncludeTags =
      resolvedIncludeTagClauses.length === 0 ||
      evaluateTagFilterFormula(trackTagIds, {
        clauses: resolvedIncludeTagClauses,
        connectors: resolvedClauseConnectors,
      });

    const matchesRating =
      ratingFilters.length === 0 ||
      (trackData.rating > 0 && ratingFilters.includes(trackData.rating));

    const matchesEnergyMin =
      energyMinFilter === null || trackData.energy >= energyMinFilter;
    const matchesEnergyMax =
      energyMaxFilter === null || trackData.energy <= energyMaxFilter;

    const matchesBpmMin =
      bpmMinFilter === null ||
      (trackData.bpm !== null && trackData.bpm >= bpmMinFilter);
    const matchesBpmMax =
      bpmMaxFilter === null ||
      (trackData.bpm !== null && trackData.bpm <= bpmMaxFilter);

    const normalizedTrackCamelotKey = normalizeCamelotKey(trackData.camelotKey);
    const matchesCamelotKey =
      normalizedCamelotKeyFilters.length === 0 ||
      (normalizedTrackCamelotKey !== null &&
        normalizedCamelotKeyFilters.includes(normalizedTrackCamelotKey));

    if (isLocalFile && !hasMetadata) {
      return (
        searchTerm === "" &&
        matchesIncludeTags &&
        matchesRating &&
        matchesEnergyMin &&
        matchesEnergyMax &&
        matchesBpmMin &&
        matchesBpmMax &&
        matchesCamelotKey
      );
    }

    const matchesSearch =
      searchTerm === "" ||
      info.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      info.artists.toLowerCase().includes(searchTerm.toLowerCase());

    return (
      matchesSearch &&
      matchesIncludeTags &&
      matchesRating &&
      matchesEnergyMin &&
      matchesEnergyMax &&
      matchesBpmMin &&
      matchesBpmMax &&
      matchesCamelotKey
    );
  });
}

export function collectTrackFilterData(
  trackEntries: TrackListEntry[],
  tagDisplayLookup: Map<string, TagDisplayInfo>,
): {
  allUniqueTagsMap: Map<string, TagDisplayInfo>;
  allRatings: Set<number>;
  allEnergyLevels: Set<number>;
  allBpmValues: Set<number>;
  allCamelotKeys: string[];
} {
  const allUniqueTags = new Map<string, TagDisplayInfo>();
  const ratings = new Set<number>();
  const energies = new Set<number>();
  const bpmValues = new Set<number>();
  const camelotKeys = new Set<string>();

  trackEntries.forEach(([, track]) => {
    if (track.rating > 0) {
      ratings.add(track.rating);
    }
    if (track.energy > 0) {
      energies.add(track.energy);
    }
    if (track.bpm !== null && track.bpm > 0) {
      bpmValues.add(track.bpm);
    }

    const camelotKey = normalizeCamelotKey(track.camelotKey);
    if (camelotKey !== null) {
      camelotKeys.add(camelotKey);
    }

    (track.tagIds || []).forEach((tagId) => {
      allUniqueTags.set(tagId, tagDisplayLookup.get(tagId) || {
        displayName: tagId,
        accentId: null,
      });
    });
  });

  return {
    allUniqueTagsMap: allUniqueTags,
    allRatings: ratings,
    allEnergyLevels: energies,
    allBpmValues: bpmValues,
    allCamelotKeys: sortCamelotKeys(camelotKeys),
  };
}

export function hasIncompleteTags(trackData: TrackListTrackData): boolean {
  const missingRating = trackData.rating === 0 || trackData.rating === undefined;
  const missingEnergy = trackData.energy === 0 || trackData.energy === undefined;
  const missingTags = !trackData.tagIds || trackData.tagIds.length === 0;

  return missingRating || missingEnergy || missingTags;
}

export function buildSmartPlaylistCriteria({
  playlistId,
  playlistName,
  trackUris,
  includeTagClauses,
  clauseConnectors,
  ratingFilters,
  energyMinFilter,
  energyMaxFilter,
  bpmMinFilter,
  bpmMaxFilter,
  normalizedCamelotKeyFilters,
}: BuildSmartPlaylistCriteriaInputs): SmartPlaylistCriteria {
  return {
    playlistId,
    playlistName,
    criteria: {
      includeTagClauses,
      clauseConnectors,
      ratingFilters,
      energyMinFilter,
      energyMaxFilter,
      bpmMinFilter,
      bpmMaxFilter,
      camelotKeyFilters: normalizedCamelotKeyFilters,
    },
    isActive: true,
    createdAt: Date.now(),
    lastSyncAt: Date.now(),
    smartPlaylistTrackUris: trackUris,
  };
}
