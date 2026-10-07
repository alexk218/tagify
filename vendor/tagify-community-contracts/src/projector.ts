import {
  PUBLIC_PROJECTION_VERSION,
  type MusicEntityKind,
  type MusicEntityRefV1,
  type PublicationPreferencesV1,
  type PublicAnnotationV1,
  type PublicProfileProjectionV1,
  type PublicTaxonomyNodeV1,
  entityKey,
  isRecord,
  isSafeAccent,
  parseSpotifyEntity,
  ratingToHalfStars,
} from "./index";
import { resolveTagifyPresetAccent } from "../../../src/shared/tagAccentPresets";

interface BackupTaxonomy {
  categoryOrder: string[];
  categoriesById: Record<string, { id: string; name: string; subcategoryIds: string[] }>;
  subcategoriesById: Record<string, { id: string; name: string; categoryId: string; tagIds: string[] }>;
  tagsById: Record<string, { id: string; name: string; subcategoryId: string; accentId?: string | null }>;
  customAccentsById: Record<string, { id: string; color: string }>;
}

interface BackupEntityData {
  rating?: number;
  tagIds?: string[];
  dateModified?: number;
}

interface NormalizedBackup {
  schemaVersion: number;
  version: string | null;
  taxonomy: BackupTaxonomy;
  tracks: Record<string, BackupEntityData>;
  playlists: Record<string, BackupEntityData>;
  artists: Record<string, BackupEntityData>;
}

export interface ProjectionPreviewV1 {
  projection: PublicProfileProjectionV1;
  availableTags: Array<{ id: string; label: string; path: string }>;
  availableEntities: Array<{ entity: MusicEntityRefV1; label: string; rating: number; tagCount: number }>;
  warnings: string[];
}

export const DEFAULT_PUBLICATION_PREFERENCES: PublicationPreferencesV1 = {
  shareTaxonomy: true,
  shareActivity: true,
  entities: {
    track: { tags: true, ratings: true },
    album: { tags: true, ratings: true },
    artist: { tags: true, ratings: true },
  },
  hiddenLocalTagIds: [],
  excludedEntities: [],
};

export async function projectTagifyBackup(
  rawBackup: unknown,
  preferences: PublicationPreferencesV1 = DEFAULT_PUBLICATION_PREFERENCES,
  now = new Date(),
): Promise<ProjectionPreviewV1> {
  const backup = normalizeBackup(rawBackup);
  const warnings: string[] = [];
  const hiddenTags = new Set(preferences.hiddenLocalTagIds);
  const excludedEntities = new Set(preferences.excludedEntities.map(entityKey));
  const availableTags = buildAvailableTags(backup.taxonomy);
  const taxonomyNodes = preferences.shareTaxonomy
    ? projectTaxonomy(backup.taxonomy, hiddenTags)
    : [];
  const visibleTagIds = new Set(
    availableTags.filter((tag) => !hiddenTags.has(tag.id)).map((tag) => tag.id),
  );
  const annotations: PublicAnnotationV1[] = [];
  const availableEntities: ProjectionPreviewV1["availableEntities"] = [];

  const collect = (records: Record<string, BackupEntityData>, kind: MusicEntityKind) => {
    Object.entries(records).forEach(([uri, data]) => {
      const entity = parseSpotifyEntity(uri);
      if (!entity || entity.kind !== kind) {
        if (uri.startsWith("spotify:local:") || uri.startsWith("spotify:playlist:")) {
          return;
        }
        warnings.push(`Skipped unsupported ${kind} reference: ${uri}`);
        return;
      }
      const rule = preferences.entities[kind];
      const rating = typeof data.rating === "number" ? data.rating : 0;
      const tagIds = Array.isArray(data.tagIds)
        ? data.tagIds.filter((tagId): tagId is string => typeof tagId === "string" && visibleTagIds.has(tagId))
        : [];
      availableEntities.push({
        entity,
        label: uri,
        rating,
        tagCount: tagIds.length,
      });
      if (excludedEntities.has(entityKey(entity))) return;
      const publishedRating = rule.ratings ? ratingToHalfStars(rating) : null;
      const publishedTags = preferences.shareTaxonomy && rule.tags ? tagIds : [];
      if (publishedRating === null && publishedTags.length === 0) return;
      annotations.push({
        entity,
        ratingHalfStars: publishedRating,
        taxonomyTagClientIds: publishedTags,
        sourceModifiedAt: typeof data.dateModified === "number" ? data.dateModified : null,
      });
    });
  };

  collect(backup.tracks, "track");
  collect(
    Object.fromEntries(Object.entries(backup.playlists).filter(([uri]) => uri.startsWith("spotify:album:"))),
    "album",
  );
  collect(backup.artists, "artist");

  annotations.sort((left, right) => entityKey(left.entity).localeCompare(entityKey(right.entity)));
  const counts = {
    taxonomyNodes: taxonomyNodes.length,
    annotations: annotations.length,
    tracks: annotations.filter((item) => item.entity.kind === "track").length,
    albums: annotations.filter((item) => item.entity.kind === "album").length,
    artists: annotations.filter((item) => item.entity.kind === "artist").length,
  };
  const publishedPreferences: PublicationPreferencesV1 = {
    ...preferences,
    hiddenLocalTagIds: [],
    excludedEntities: [],
  };
  const checksumPayload = JSON.stringify({
    projectionVersion: PUBLIC_PROJECTION_VERSION,
    sourceTagifySchemaVersion: backup.schemaVersion,
    preferences: publishedPreferences,
    taxonomyNodes,
    annotations,
  });
  const checksum = await sha256(checksumPayload);

  return {
    projection: {
      projectionVersion: PUBLIC_PROJECTION_VERSION,
      sourceTagifySchemaVersion: backup.schemaVersion,
      sourceTagifyVersion: backup.version,
      generatedAt: now.toISOString(),
      preferences: publishedPreferences,
      taxonomyNodes,
      annotations,
      counts,
      checksum,
    },
    availableTags,
    availableEntities,
    warnings: [...new Set(warnings)],
  };
}

function normalizeBackup(raw: unknown): NormalizedBackup {
  if (!isRecord(raw)) throw new Error("Choose a Tagify backup JSON file");
  const schemaVersion = Number(raw.schemaVersion ?? raw.schema_version);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error("This file is not a supported Tagify backup");
  }
  if (!isRecord(raw.taxonomy)) {
    throw new Error("This backup predates the supported taxonomy format. Import and re-export it from Tagify 2.5 first.");
  }
  const taxonomy = raw.taxonomy;
  if (!Array.isArray(taxonomy.categoryOrder) || !isRecord(taxonomy.categoriesById) || !isRecord(taxonomy.subcategoriesById) || !isRecord(taxonomy.tagsById)) {
    throw new Error("The Tagify taxonomy in this backup is incomplete");
  }
  return {
    schemaVersion,
    version: typeof raw.version === "string" ? raw.version : null,
    taxonomy: {
      categoryOrder: taxonomy.categoryOrder.filter((id): id is string => typeof id === "string"),
      categoriesById: sanitizeLookup(taxonomy.categoriesById, "subcategoryIds"),
      subcategoriesById: sanitizeLookup(taxonomy.subcategoriesById, "tagIds") as BackupTaxonomy["subcategoriesById"],
      tagsById: sanitizeTags(taxonomy.tagsById),
      customAccentsById: sanitizeAccents(taxonomy.customAccentsById),
    },
    tracks: sanitizeEntityLookup(raw.tracks),
    playlists: sanitizeEntityLookup(raw.playlists),
    artists: sanitizeEntityLookup(raw.artists),
  };
}

function projectTaxonomy(taxonomy: BackupTaxonomy, hiddenTags: Set<string>): PublicTaxonomyNodeV1[] {
  const nodes: PublicTaxonomyNodeV1[] = [];
  taxonomy.categoryOrder.forEach((categoryId, categoryPosition) => {
    const category = taxonomy.categoriesById[categoryId];
    if (!category) return;
    const visibleSubcategories = category.subcategoryIds.filter((subcategoryId) => {
      const subcategory = taxonomy.subcategoriesById[subcategoryId];
      return subcategory?.tagIds.some((tagId) => !hiddenTags.has(tagId));
    });
    if (visibleSubcategories.length === 0) return;
    nodes.push({ clientId: category.id, kind: "category", parentClientId: null, position: categoryPosition, label: cleanLabel(category.name), accent: null });
    visibleSubcategories.forEach((subcategoryId, subcategoryPosition) => {
      const subcategory = taxonomy.subcategoriesById[subcategoryId];
      if (!subcategory) return;
      nodes.push({ clientId: subcategory.id, kind: "subcategory", parentClientId: category.id, position: subcategoryPosition, label: cleanLabel(subcategory.name), accent: null });
      subcategory.tagIds.forEach((tagId, tagPosition) => {
        const tag = taxonomy.tagsById[tagId];
        if (!tag || hiddenTags.has(tagId)) return;
        nodes.push({
          clientId: tag.id,
          kind: "tag",
          parentClientId: subcategory.id,
          position: tagPosition,
          label: cleanLabel(tag.name),
          accent: resolveAccent(tag.accentId, taxonomy.customAccentsById),
        });
      });
    });
  });
  return nodes;
}

function buildAvailableTags(taxonomy: BackupTaxonomy): ProjectionPreviewV1["availableTags"] {
  const tags: ProjectionPreviewV1["availableTags"] = [];
  taxonomy.categoryOrder.forEach((categoryId) => {
    const category = taxonomy.categoriesById[categoryId];
    category?.subcategoryIds.forEach((subcategoryId) => {
      const subcategory = taxonomy.subcategoriesById[subcategoryId];
      subcategory?.tagIds.forEach((tagId) => {
        const tag = taxonomy.tagsById[tagId];
        if (tag) tags.push({ id: tag.id, label: cleanLabel(tag.name), path: `${cleanLabel(category.name)} / ${cleanLabel(subcategory.name)} / ${cleanLabel(tag.name)}` });
      });
    });
  });
  return tags;
}

function cleanLabel(value: unknown): string {
  if (typeof value !== "string") throw new Error("Taxonomy labels must be text");
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 80 || /[<>]/.test(cleaned) || /https?:\/\//i.test(cleaned)) {
    throw new Error("A taxonomy label is empty, unsafe, or too long");
  }
  return cleaned;
}

function resolveAccent(accentId: string | null | undefined, custom: BackupTaxonomy["customAccentsById"]): string | null {
  if (!accentId) return null;
  const preset = resolveTagifyPresetAccent(accentId);
  if (preset) return preset;
  const color = custom[accentId]?.color;
  return isSafeAccent(color) ? color.toLowerCase() : null;
}

function sanitizeLookup(value: Record<string, unknown>, childKey: "subcategoryIds" | "tagIds"): Record<string, any> {
  const result: Record<string, any> = {};
  Object.entries(value).forEach(([key, item]) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") return;
    result[key] = { ...item, [childKey]: Array.isArray(item[childKey]) ? item[childKey].filter((id): id is string => typeof id === "string") : [] };
  });
  return result;
}

function sanitizeTags(value: Record<string, unknown>): BackupTaxonomy["tagsById"] {
  const result: BackupTaxonomy["tagsById"] = {};
  Object.entries(value).forEach(([key, item]) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.subcategoryId !== "string") return;
    result[key] = { id: item.id, name: item.name, subcategoryId: item.subcategoryId, accentId: typeof item.accentId === "string" ? item.accentId : null };
  });
  return result;
}

function sanitizeAccents(value: unknown): BackupTaxonomy["customAccentsById"] {
  if (!isRecord(value)) return {};
  const result: BackupTaxonomy["customAccentsById"] = {};
  Object.entries(value).forEach(([key, item]) => {
    if (isRecord(item) && typeof item.id === "string" && typeof item.color === "string") result[key] = { id: item.id, color: item.color };
  });
  return result;
}

function sanitizeEntityLookup(value: unknown): Record<string, BackupEntityData> {
  if (!isRecord(value)) return {};
  const result: Record<string, BackupEntityData> = {};
  Object.entries(value).forEach(([uri, item]) => {
    if (!isRecord(item)) return;
    result[uri] = {
      rating: typeof item.rating === "number" ? item.rating : 0,
      tagIds: Array.isArray(item.tagIds) ? item.tagIds.filter((id): id is string => typeof id === "string") : [],
      dateModified: typeof item.dateModified === "number" ? item.dateModified : undefined,
    };
  });
  return result;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
