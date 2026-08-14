import { defaultTagData } from "@/constants/defaultTagData";
import type {
  LegacyTagDataStructure,
  LegacyTrackData,
  LegacyTrackTag,
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TrackData,
} from "@/types/tagData";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
import {
  buildTaxonomyFromCategoryTree,
  createLegacyTagIdentityId,
  migrateLegacyFilterTagId,
  normalizeTaxonomyCustomAccents,
  TAG_DATA_SCHEMA_VERSION,
} from "@/utils/tagTaxonomy";
import {
  buildTagFilterFormulaFromIncludeTagGroups,
  buildTagFilterFormulaFromLegacyFilters,
  normalizeTagFilterFormula,
  TAG_FILTER_OPERATORS,
} from "@/utils/tagFilterGroups";
import { normalizeTagAccentId } from "./tagAccent";
import { normalizeColorLibrary } from "./tagColorThemes";

interface LegacySmartPlaylistTagFilter {
  categoryId: string;
  subcategoryId: string;
  tagId: string;
}

function cloneDefaultTagData(): TagDataStructure {
  return JSON.parse(JSON.stringify(defaultTagData)) as TagDataStructure;
}

function dedupeTagIds(tagIds: string[]): string[] {
  return Array.from(new Set(tagIds.filter((tagId) => typeof tagId === "string" && tagId.length > 0)));
}

function isLegacyTrackTag(value: unknown): value is LegacyTrackTag {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LegacyTrackTag).categoryId === "string" &&
    typeof (value as LegacyTrackTag).subcategoryId === "string" &&
    typeof (value as LegacyTrackTag).tagId === "string"
  );
}

function normalizeLegacyTrackTags(trackData: Partial<LegacyTrackData>): string[] {
  if (!Array.isArray(trackData.tags)) {
    return [];
  }

  return dedupeTagIds(
    trackData.tags.filter(isLegacyTrackTag).map((tag) =>
      createLegacyTagIdentityId(tag.categoryId, tag.subcategoryId, tag.tagId),
    ),
  );
}

function normalizeTrackData(trackData: unknown): TrackData {
  const candidate = (trackData || {}) as Partial<TrackData & LegacyTrackData>;

  const nextTagIds = Array.isArray(candidate.tagIds)
    ? dedupeTagIds(candidate.tagIds)
    : normalizeLegacyTrackTags(candidate);

  return {
    rating: typeof candidate.rating === "number" ? candidate.rating : 0,
    energy: typeof candidate.energy === "number" ? candidate.energy : 0,
    bpm:
      typeof candidate.bpm === "number" || candidate.bpm === null
        ? candidate.bpm
        : null,
    ...(candidate.camelotKey !== undefined
      ? { camelotKey: candidate.camelotKey ?? null }
      : {}),
    tagIds: nextTagIds,
    ...(typeof candidate.dateCreated === "number"
      ? { dateCreated: candidate.dateCreated }
      : {}),
    ...(typeof candidate.dateModified === "number"
      ? { dateModified: candidate.dateModified }
      : {}),
    ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
    ...(typeof candidate.artists === "string"
      ? { artists: candidate.artists }
      : {}),
    ...(typeof candidate.backfillAttempts === "number"
      ? { backfillAttempts: candidate.backfillAttempts }
      : {}),
  };
}

function normalizePlaylistData(playlistData: unknown): PlaylistData {
  const candidate = (playlistData || {}) as Partial<PlaylistData>;

  return {
    rating: typeof candidate.rating === "number" ? candidate.rating : 0,
    energy: typeof candidate.energy === "number" ? candidate.energy : 0,
    tagIds: Array.isArray(candidate.tagIds)
      ? dedupeTagIds(candidate.tagIds)
      : [],
    ...(typeof candidate.dateCreated === "number"
      ? { dateCreated: candidate.dateCreated }
      : {}),
    ...(typeof candidate.dateModified === "number"
      ? { dateModified: candidate.dateModified }
      : {}),
    ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
    ...(candidate.ownerName !== undefined
      ? { ownerName: candidate.ownerName ?? null }
      : {}),
    ...(candidate.imageUrl !== undefined
      ? { imageUrl: candidate.imageUrl ?? null }
      : {}),
    ...(candidate.description !== undefined
      ? { description: candidate.description ?? null }
      : {}),
    ...(typeof candidate.trackCount === "number" || candidate.trackCount === null
      ? { trackCount: candidate.trackCount }
      : {}),
    ...(candidate.snapshotId !== undefined
      ? { snapshotId: candidate.snapshotId ?? null }
      : {}),
  };
}

function normalizeArtistData(artistData: unknown): ArtistData {
  const candidate = (artistData || {}) as Partial<ArtistData>;

  return {
    rating: typeof candidate.rating === "number" ? candidate.rating : 0,
    energy: typeof candidate.energy === "number" ? candidate.energy : 0,
    tagIds: Array.isArray(candidate.tagIds)
      ? dedupeTagIds(candidate.tagIds)
      : [],
    ...(typeof candidate.dateCreated === "number"
      ? { dateCreated: candidate.dateCreated }
      : {}),
    ...(typeof candidate.dateModified === "number"
      ? { dateModified: candidate.dateModified }
      : {}),
    ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
    ...(candidate.imageUrl !== undefined
      ? { imageUrl: candidate.imageUrl ?? null }
      : {}),
    ...(typeof candidate.followerCount === "number" ||
    candidate.followerCount === null
      ? { followerCount: candidate.followerCount }
      : {}),
    ...(Array.isArray(candidate.genres)
      ? { genres: candidate.genres.filter((genre): genre is string => typeof genre === "string") }
      : {}),
  };
}

function normalizeTaxonomy(
  taxonomy: TagDataStructure["taxonomy"],
): TagDataStructure["taxonomy"] {
  const customAccentsById = normalizeTaxonomyCustomAccents(taxonomy);
  const colorLibrary = normalizeColorLibrary({ ...taxonomy, customAccentsById });

  return {
    ...taxonomy,
    ...colorLibrary,
    tagsById: Object.fromEntries(
      Object.entries(colorLibrary.tagsById || {}).map(([tagId, tag]) => [
        tagId,
        {
          ...tag,
          accentId: normalizeTagAccentId(tag?.accentId, colorLibrary.customAccentsById),
        },
      ]),
    ),
  };
}

function isLegacyTagDataStructure(value: unknown): value is LegacyTagDataStructure {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as LegacyTagDataStructure).categories) &&
    typeof (value as LegacyTagDataStructure).tracks === "object" &&
    (value as LegacyTagDataStructure).tracks !== null
  );
}

function isCurrentTagDataStructure(value: unknown): value is TagDataStructure {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TagDataStructure).schemaVersion === "number" &&
    typeof (value as TagDataStructure).taxonomy === "object" &&
    (value as TagDataStructure).taxonomy !== null &&
    typeof (value as TagDataStructure).tracks === "object" &&
    (value as TagDataStructure).tracks !== null
  );
}

export function isSupportedTagDataBackup(
  value: unknown,
): value is TagDataStructure | LegacyTagDataStructure {
  return isCurrentTagDataStructure(value) || isLegacyTagDataStructure(value);
}

export function normalizeTagDataStructure(value: unknown): TagDataStructure {
  if (isCurrentTagDataStructure(value)) {
    const candidate = value as TagDataStructure;
    const nextTracks = Object.fromEntries(
      Object.entries(candidate.tracks).map(([trackUri, trackData]) => [
        trackUri,
        normalizeTrackData(trackData),
      ]),
    );
    const nextPlaylists = Object.fromEntries(
      Object.entries(candidate.playlists || {}).map(([playlistUri, playlistData]) => [
        playlistUri,
        normalizePlaylistData(playlistData),
      ]),
    );
    const nextArtists = Object.fromEntries(
      Object.entries(candidate.artists || {}).map(([artistUri, artistData]) => [
        artistUri,
        normalizeArtistData(artistData),
      ]),
    );

    return {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: normalizeTaxonomy(candidate.taxonomy),
      tracks: nextTracks,
      playlists: nextPlaylists,
      artists: nextArtists,
    };
  }

  if (isLegacyTagDataStructure(value)) {
    const candidate = value as LegacyTagDataStructure;
    return {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: buildTaxonomyFromCategoryTree(candidate.categories),
      tracks: Object.fromEntries(
        Object.entries(candidate.tracks).map(([trackUri, trackData]) => [
          trackUri,
          normalizeTrackData(trackData),
        ]),
      ),
      playlists: {},
      artists: {},
    };
  }

  return cloneDefaultTagData();
}

function normalizeStoredTagFilterIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeTagIds(
    value
      .filter((tagId): tagId is string => typeof tagId === "string")
      .map((tagId) => migrateLegacyFilterTagId(tagId)),
  );
}

export function normalizeFilterState(value: unknown): {
  includeTagClauses: {
    tagIds: string[];
    excludedTagIds: string[];
    operator: "AND" | "OR";
  }[];
  clauseConnectors: ("AND" | "OR")[];
} {
  const candidate = (value || {}) as {
    includeTagClauses?: unknown;
    clauseConnectors?: unknown;
    includeTagGroups?: unknown;
    activeTagFilters?: unknown;
    excludedTagFilters?: unknown;
    isOrFilterMode?: unknown;
  };

  const normalizedExcludedTagFilters = normalizeStoredTagFilterIds(
    candidate.excludedTagFilters,
  );
  const normalizedFormula = Array.isArray(candidate.includeTagClauses)
    ? normalizeTagFilterFormula({
        clauses: candidate.includeTagClauses.map((clause) => ({
          tagIds: normalizeStoredTagFilterIds(
            (clause as { tagIds?: unknown })?.tagIds,
          ),
          excludedTagIds: normalizeStoredTagFilterIds(
            (clause as { excludedTagIds?: unknown })?.excludedTagIds,
          ),
          operator:
            (clause as { operator?: unknown })?.operator === TAG_FILTER_OPERATORS.AND
              ? TAG_FILTER_OPERATORS.AND
              : TAG_FILTER_OPERATORS.OR,
        })),
        connectors: Array.isArray(candidate.clauseConnectors)
          ? candidate.clauseConnectors
          : [],
        })
      : Array.isArray(candidate.includeTagGroups)
      ? buildTagFilterFormulaFromIncludeTagGroups(
          candidate.includeTagGroups.map((group) =>
            normalizeStoredTagFilterIds(group),
          ),
          normalizedExcludedTagFilters,
        )
      : buildTagFilterFormulaFromLegacyFilters(
          normalizeStoredTagFilterIds(candidate.activeTagFilters),
          candidate.isOrFilterMode === true,
          normalizedExcludedTagFilters,
        );

  return {
    includeTagClauses: normalizedFormula.clauses,
    clauseConnectors: normalizedFormula.connectors,
  };
}

function isLegacySmartPlaylistTagFilter(value: unknown): value is LegacySmartPlaylistTagFilter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LegacySmartPlaylistTagFilter).categoryId === "string" &&
    typeof (value as LegacySmartPlaylistTagFilter).subcategoryId === "string" &&
    typeof (value as LegacySmartPlaylistTagFilter).tagId === "string"
  );
}

function normalizeSmartPlaylistTagFilters(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeTagIds(
    value.flatMap((filter) => {
      if (typeof filter === "string") {
        return [migrateLegacyFilterTagId(filter)];
      }

      if (isLegacySmartPlaylistTagFilter(filter)) {
        return [
          createLegacyTagIdentityId(
            filter.categoryId,
            filter.subcategoryId,
            filter.tagId,
          ),
        ];
      }

      return [];
    }),
  );
}

export function normalizeSmartPlaylistCriteriaList(value: unknown): SmartPlaylistCriteria[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((playlist) => {
    if (typeof playlist !== "object" || playlist === null) {
      return [];
    }

    const candidate = playlist as Partial<SmartPlaylistCriteria> & {
      criteria?: {
        includeTagClauses?: unknown;
        clauseConnectors?: unknown;
        includeTagGroups?: unknown;
        activeTagFilters?: unknown;
        excludedTagFilters?: unknown;
        ratingFilters?: unknown;
        energyMinFilter?: unknown;
        energyMaxFilter?: unknown;
        bpmMinFilter?: unknown;
        bpmMaxFilter?: unknown;
        camelotKeyFilters?: unknown;
        camelotMinFilter?: unknown;
        camelotMaxFilter?: unknown;
        isOrFilterMode?: unknown;
      };
    };

    if (
      typeof candidate.playlistId !== "string" ||
      typeof candidate.playlistName !== "string" ||
      typeof candidate.isActive !== "boolean" ||
      !candidate.criteria
    ) {
      return [];
    }

    return [
      {
        playlistId: candidate.playlistId,
        playlistName: candidate.playlistName,
        isActive: candidate.isActive,
        createdAt:
          typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
        lastSyncAt:
          typeof candidate.lastSyncAt === "number" ? candidate.lastSyncAt : 0,
        smartPlaylistTrackUris: Array.isArray(candidate.smartPlaylistTrackUris)
          ? candidate.smartPlaylistTrackUris.filter(
              (trackUri): trackUri is string => typeof trackUri === "string",
            )
          : [],
        criteria: {
          ...(() => {
            const normalizedFormula = Array.isArray(candidate.criteria.includeTagClauses)
              ? normalizeTagFilterFormula({
                  clauses: candidate.criteria.includeTagClauses.map((clause) => ({
                    tagIds: normalizeSmartPlaylistTagFilters(
                      (clause as { tagIds?: unknown })?.tagIds,
                    ),
                    excludedTagIds: normalizeSmartPlaylistTagFilters(
                      (clause as { excludedTagIds?: unknown })?.excludedTagIds,
                    ),
                    operator:
                      (clause as { operator?: unknown })?.operator ===
                      TAG_FILTER_OPERATORS.AND
                        ? TAG_FILTER_OPERATORS.AND
                        : TAG_FILTER_OPERATORS.OR,
                  })),
                  connectors: Array.isArray(candidate.criteria.clauseConnectors)
                    ? candidate.criteria.clauseConnectors
                    : [],
                })
              : Array.isArray(candidate.criteria.includeTagGroups)
                ? buildTagFilterFormulaFromIncludeTagGroups(
                    candidate.criteria.includeTagGroups.map((group) =>
                      normalizeSmartPlaylistTagFilters(group),
                    ),
                    normalizeSmartPlaylistTagFilters(
                      candidate.criteria.excludedTagFilters,
                    ),
                  )
                : buildTagFilterFormulaFromLegacyFilters(
                    normalizeSmartPlaylistTagFilters(candidate.criteria.activeTagFilters),
                    candidate.criteria.isOrFilterMode === true,
                    normalizeSmartPlaylistTagFilters(
                      candidate.criteria.excludedTagFilters,
                    ),
                  );

            return {
              includeTagClauses: normalizedFormula.clauses,
              clauseConnectors: normalizedFormula.connectors,
            };
          })(),
          ratingFilters: Array.isArray(candidate.criteria.ratingFilters)
            ? candidate.criteria.ratingFilters.filter(
                (rating): rating is number => typeof rating === "number",
              )
            : [],
          energyMinFilter:
            typeof candidate.criteria.energyMinFilter === "number" ||
            candidate.criteria.energyMinFilter === null
              ? candidate.criteria.energyMinFilter
              : null,
          energyMaxFilter:
            typeof candidate.criteria.energyMaxFilter === "number" ||
            candidate.criteria.energyMaxFilter === null
              ? candidate.criteria.energyMaxFilter
              : null,
          bpmMinFilter:
            typeof candidate.criteria.bpmMinFilter === "number" ||
            candidate.criteria.bpmMinFilter === null
              ? candidate.criteria.bpmMinFilter
              : null,
          bpmMaxFilter:
            typeof candidate.criteria.bpmMaxFilter === "number" ||
            candidate.criteria.bpmMaxFilter === null
              ? candidate.criteria.bpmMaxFilter
              : null,
          camelotKeyFilters: Array.isArray(candidate.criteria.camelotKeyFilters)
            ? candidate.criteria.camelotKeyFilters.filter(
                (key): key is string => typeof key === "string",
              )
            : [],
          camelotMinFilter:
            typeof candidate.criteria.camelotMinFilter === "string" ||
            candidate.criteria.camelotMinFilter === null
              ? candidate.criteria.camelotMinFilter
              : null,
          camelotMaxFilter:
            typeof candidate.criteria.camelotMaxFilter === "string" ||
            candidate.criteria.camelotMaxFilter === null
              ? candidate.criteria.camelotMaxFilter
              : null,
        },
      },
    ];
  });
}
