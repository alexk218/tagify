import { isRecord } from "./validation";

export const PUBLIC_PROJECTION_VERSION = 1 as const;
export const CATALOG_REFERENCE_VERSION = 2 as const;

export { isRecord };
export * from "./taxonomy-artifact";
export * from "./comments";
export * from "./artifact-projector";

export type MusicEntityKind = "track" | "album" | "artist";
export type CatalogEntityType = "artist" | "recording" | "releaseGroup" | "release" | "work";
export type TaxonomyNodeKind = "category" | "folder" | "subcategory" | "tag";

export interface MusicEntityRefV1 {
  provider: "spotify";
  kind: MusicEntityKind;
  providerId: string;
}

/** Permanent Tagify-owned identity. Provider IDs are mappings, never primary keys. */
export interface CatalogEntityRefV2 {
  referenceVersion: typeof CATALOG_REFERENCE_VERSION;
  catalogEntityId: string;
  entityType: CatalogEntityType;
}

export interface ProviderIdentifierV1 {
  provider: string;
  providerEntityType: string;
  providerId: string;
  canonicalUrl: string | null;
  verificationStatus: "observed" | "matched" | "verified";
  confidence: number;
}

export interface PublicAnnotationV2 {
  entity: CatalogEntityRefV2;
  ratingHalfStars: number | null;
  taxonomyTagClientIds: string[];
  sourceModifiedAt: number | null;
}

export interface EntityPublicationRuleV1 {
  tags: boolean;
  ratings: boolean;
}

export interface PublicationPreferencesV1 {
  shareTaxonomy: boolean;
  shareActivity: boolean;
  entities: Record<MusicEntityKind, EntityPublicationRuleV1>;
  hiddenLocalTagIds: string[];
  excludedEntities: MusicEntityRefV1[];
}

export interface PublicTaxonomyNodeV1 {
  clientId: string;
  kind: TaxonomyNodeKind;
  parentClientId: string | null;
  position: number;
  label: string;
  accent: string | null;
}

export interface PublicAnnotationV1 {
  entity: MusicEntityRefV1;
  ratingHalfStars: number | null;
  taxonomyTagClientIds: string[];
  sourceModifiedAt: number | null;
}

export interface ProjectionCountsV1 {
  taxonomyNodes: number;
  annotations: number;
  tracks: number;
  albums: number;
  artists: number;
}

export interface PublicProfileProjectionV1 {
  projectionVersion: typeof PUBLIC_PROJECTION_VERSION;
  sourceTagifySchemaVersion: number;
  sourceTagifyVersion: string | null;
  generatedAt: string;
  preferences: PublicationPreferencesV1;
  taxonomyNodes: PublicTaxonomyNodeV1[];
  annotations: PublicAnnotationV1[];
  counts: ProjectionCountsV1;
  checksum: string;
}

export interface PublicationSessionRequestV1 {
  idempotencyKey: string;
  checksum: string;
  expectedTaxonomyNodes: number;
  expectedAnnotations: number;
  preferences: PublicationPreferencesV1;
}

export interface PublicationSessionV1 {
  id: string;
  status: "staging" | "finalizing" | "published" | "expired" | "failed";
  nextTaxonomyChunk: number;
  nextAnnotationChunk: number;
  expiresAt: string;
}

export interface PublicContributorV1 {
  handle: string;
  displayName: string;
  ratingHalfStars: number | null;
  tags: Array<{ label: string; path: string }>;
  isFollowing: boolean;
  isOwn?: boolean;
}

export interface PublicTagPathV1 {
  path: string;
  contributorCount: number;
}

export interface PublicTagInspirationV1 {
  label: string;
  contributorCount: number;
  paths: PublicTagPathV1[];
  contributors: Array<{
    handle: string;
    displayName: string;
    isFollowing: boolean;
  }>;
}

export interface TaggingInspirationV1 {
  contributorCount: number;
  tags: PublicTagInspirationV1[];
}

export interface InspirationPreferencesV1 {
  includePublicAnnotations: boolean;
  showProfileInDiscovery: boolean;
  receivePersonalizedInspiration: boolean;
  updatedAt: string | null;
}

export type InspirationFeedbackKindV1 = "entity_tag" | "person" | "taxonomy";
export type InspirationFeedbackActionV1 =
  | "impression"
  | "open"
  | "dismiss"
  | "mute"
  | "follow"
  | "preview"
  | "install"
  | "undo";

export interface PublicEntityArtistV1 {
  providerId: string;
  name: string;
  spotifyUrl: string;
}

export interface PublicEntityViewV1 {
  entity: MusicEntityRefV1;
  title: string;
  subtitle: string | null;
  spotifyUrl: string;
  thumbnailUrl: string | null;
  artists: PublicEntityArtistV1[];
  rating: {
    average: number | null;
    count: number;
    distribution: number[];
  };
  contributors: PublicContributorV1[];
  tagInspiration?: TaggingInspirationV1;
}

export interface PublicEntityViewV2 {
  catalogEntity: CatalogEntityRefV2;
  displayKind: MusicEntityKind;
  canonicalPath: string;
  legacyEntity: MusicEntityRefV1 | null;
  providerIdentifiers: ProviderIdentifierV1[];
  title: string;
  subtitle: string | null;
  spotifyUrl: string | null;
  thumbnailUrl: string | null;
  artists: PublicEntityArtistV1[];
  rating: {
    average: number | null;
    count: number;
    distribution: number[];
  };
  contributors: PublicContributorV1[];
  tagInspiration?: TaggingInspirationV1;
  metadataProvenance: Array<{
    field: "title" | "subtitle" | "thumbnailUrl";
    source: string;
    sourceUrl: string | null;
    license: string | null;
  }>;
}

/**
 * Summarizes explicitly public, attributed tag paths without claiming that
 * matching labels are semantically identical across personal taxonomies.
 */
export function buildTaggingInspiration(
  contributors: PublicContributorV1[],
): TaggingInspirationV1 {
  const tags = new Map<
    string,
    {
      label: string;
      contributors: Map<
        string,
        { handle: string; displayName: string; isFollowing: boolean }
      >;
      paths: Map<string, Set<string>>;
    }
  >();

  contributors.forEach((contributor) => {
    contributor.tags.forEach((tag) => {
      const key = normalizeTagText(tag.label);
      if (!key) return;
      const current = tags.get(key) ?? {
        label: tag.label.trim(),
        contributors: new Map(),
        paths: new Map(),
      };
      current.contributors.set(contributor.handle, {
        handle: contributor.handle,
        displayName: contributor.displayName,
        isFollowing: contributor.isFollowing,
      });
      const path = tag.path.trim() || tag.label.trim();
      const pathContributors = current.paths.get(path) ?? new Set<string>();
      pathContributors.add(contributor.handle);
      current.paths.set(path, pathContributors);
      tags.set(key, current);
    });
  });

  return {
    contributorCount: new Set(contributors.map((item) => item.handle)).size,
    tags: [...tags.values()]
      .map((tag) => ({
        label: tag.label,
        contributorCount: tag.contributors.size,
        paths: [...tag.paths.entries()]
          .map(([path, handles]) => ({
            path,
            contributorCount: handles.size,
          }))
          .sort(
            (left, right) =>
              right.contributorCount - left.contributorCount ||
              left.path.localeCompare(right.path),
          ),
        contributors: [...tag.contributors.values()].sort((left, right) =>
          left.handle.localeCompare(right.handle),
        ),
      }))
      .sort(
        (left, right) =>
          right.contributorCount - left.contributorCount ||
          left.label.localeCompare(right.label),
      ),
  };
}

function normalizeTagText(value: string) {
  return value.trim().normalize("NFKC").toLowerCase();
}

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{10,64}$/;
const SAFE_ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function assertMusicEntityRefV1(
  value: unknown,
): asserts value is MusicEntityRefV1 {
  if (!isRecord(value) || value.provider !== "spotify") {
    throw new Error("Unsupported music provider");
  }
  if (
    !isEntityKind(value.kind) ||
    typeof value.providerId !== "string" ||
    !SPOTIFY_ID_PATTERN.test(value.providerId)
  ) {
    throw new Error("Invalid Spotify entity reference");
  }
}

export function assertCatalogEntityRefV2(value: unknown): asserts value is CatalogEntityRefV2 {
  if (!isRecord(value) || value.referenceVersion !== CATALOG_REFERENCE_VERSION) {
    throw new Error("Unsupported catalog reference version");
  }
  if (!isUuid(value.catalogEntityId) || !isCatalogEntityType(value.entityType)) {
    throw new Error("Invalid Tagify catalog entity reference");
  }
}

export function assertProviderIdentifierV1(value: unknown): asserts value is ProviderIdentifierV1 {
  if (!isRecord(value) || typeof value.provider !== "string" || !/^[a-z][a-z0-9_-]{1,31}$/.test(value.provider)) {
    throw new Error("Invalid catalog provider");
  }
  if (typeof value.providerEntityType !== "string" || !/^[a-z][a-z0-9_-]{1,31}$/.test(value.providerEntityType)) {
    throw new Error("Invalid provider entity type");
  }
  if (typeof value.providerId !== "string" || value.providerId.length < 1 || value.providerId.length > 160) {
    throw new Error("Invalid provider identifier");
  }
  if (value.canonicalUrl !== null && (typeof value.canonicalUrl !== "string" || !isHttpsUrl(value.canonicalUrl))) {
    throw new Error("Invalid provider URL");
  }
  if (value.verificationStatus !== "observed" && value.verificationStatus !== "matched" && value.verificationStatus !== "verified") {
    throw new Error("Invalid provider verification status");
  }
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error("Invalid provider confidence");
  }
}

export function assertPublicProfileProjectionV1(
  value: unknown,
): asserts value is PublicProfileProjectionV1 {
  if (
    !isRecord(value) ||
    value.projectionVersion !== PUBLIC_PROJECTION_VERSION
  ) {
    throw new Error("Unsupported public projection version");
  }
  if (
    !Array.isArray(value.taxonomyNodes) ||
    !Array.isArray(value.annotations)
  ) {
    throw new Error("Invalid public projection");
  }
  value.taxonomyNodes.forEach(assertTaxonomyNode);
  value.annotations.forEach(assertAnnotation);
  if (typeof value.checksum !== "string" || value.checksum.length < 8) {
    throw new Error("Invalid public projection checksum");
  }
}

export function assertPublicationPreferencesV1(
  value: unknown,
): asserts value is PublicationPreferencesV1 {
  if (
    !isRecord(value) ||
    typeof value.shareTaxonomy !== "boolean" ||
    typeof value.shareActivity !== "boolean" ||
    !isRecord(value.entities)
  ) {
    throw new Error("Invalid publication preferences");
  }
  const entities = value.entities;
  (["track", "album", "artist"] as MusicEntityKind[]).forEach((kind) => {
    const rule = entities[kind];
    if (
      !isRecord(rule) ||
      typeof rule.tags !== "boolean" ||
      typeof rule.ratings !== "boolean"
    )
      throw new Error("Invalid publication rules");
  });
  if (
    !Array.isArray(value.hiddenLocalTagIds) ||
    value.hiddenLocalTagIds.some(
      (id) => typeof id !== "string" || id.length > 128,
    )
  )
    throw new Error("Invalid hidden tags");
  if (!Array.isArray(value.excludedEntities))
    throw new Error("Invalid excluded entities");
  value.excludedEntities.forEach(assertMusicEntityRefV1);
}

export function assertPublicTaxonomyNodeV1(
  value: unknown,
): asserts value is PublicTaxonomyNodeV1 {
  assertTaxonomyNode(value);
}

export function assertPublicAnnotationV1(
  value: unknown,
): asserts value is PublicAnnotationV1 {
  assertAnnotation(value);
}

export function parseSpotifyEntity(value: string): MusicEntityRefV1 | null {
  const trimmed = value.trim();
  const uriMatch = trimmed.match(
    /^spotify:(track|album|artist):([A-Za-z0-9]+)$/i,
  );
  const urlMatch = trimmed.match(
    /^https:\/\/open\.spotify\.com\/(track|album|artist)\/([A-Za-z0-9]+)(?:[/?#].*)?$/i,
  );
  const match = uriMatch || urlMatch;
  if (!match) return null;
  const entity = {
    provider: "spotify" as const,
    kind: match[1].toLowerCase() as MusicEntityKind,
    providerId: match[2],
  };
  try {
    assertMusicEntityRefV1(entity);
    return entity;
  } catch {
    return null;
  }
}

export function entityKey(entity: MusicEntityRefV1): string {
  return `${entity.provider}:${entity.kind}:${entity.providerId}`;
}

export function spotifyUrl(entity: MusicEntityRefV1): string {
  return `https://open.spotify.com/${entity.kind}/${entity.providerId}`;
}

export function legacyKindToCatalogEntityType(kind: MusicEntityKind): CatalogEntityType {
  if (kind === "track") return "recording";
  if (kind === "album") return "release";
  return "artist";
}

export function catalogEntityTypeToPathSegment(entityType: CatalogEntityType): string {
  if (entityType === "releaseGroup") return "release-group";
  return entityType;
}

export function catalogEntityPath(entity: Pick<CatalogEntityRefV2, "catalogEntityId" | "entityType">): string {
  if (!isUuid(entity.catalogEntityId) || !isCatalogEntityType(entity.entityType)) throw new Error("Invalid catalog entity path");
  return `/${catalogEntityTypeToPathSegment(entity.entityType)}/${entity.catalogEntityId}`;
}

export function ratingToHalfStars(rating: number): number | null {
  if (!Number.isFinite(rating) || rating <= 0) return null;
  const halfStars = Math.round(rating * 2);
  if (halfStars < 1 || halfStars > 10)
    throw new Error("Rating must be between 0.5 and 5");
  return halfStars;
}

export function isSafeAccent(value: unknown): value is string {
  return typeof value === "string" && SAFE_ACCENT_PATTERN.test(value);
}

function isEntityKind(value: unknown): value is MusicEntityKind {
  return value === "track" || value === "album" || value === "artist";
}

function isCatalogEntityType(value: unknown): value is CatalogEntityType {
  return value === "artist" || value === "recording" || value === "releaseGroup" || value === "release" || value === "work";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function assertTaxonomyNode(
  value: unknown,
): asserts value is PublicTaxonomyNodeV1 {
  if (
    !isRecord(value) ||
    typeof value.clientId !== "string" ||
    typeof value.label !== "string"
  ) {
    throw new Error("Invalid taxonomy node");
  }
  if (
    value.kind !== "category" &&
    value.kind !== "folder" &&
    value.kind !== "subcategory" &&
    value.kind !== "tag"
  ) {
    throw new Error("Invalid taxonomy node kind");
  }
  if (
    value.label.trim().length === 0 ||
    value.label.length > 80 ||
    /[<>]/.test(value.label)
  ) {
    throw new Error("Unsafe taxonomy label");
  }
  if (value.accent !== null && !isSafeAccent(value.accent)) {
    throw new Error("Unsafe taxonomy accent");
  }
}

function assertAnnotation(value: unknown): asserts value is PublicAnnotationV1 {
  if (!isRecord(value)) throw new Error("Invalid annotation");
  assertMusicEntityRefV1(value.entity);
  const rating = value.ratingHalfStars;
  if (
    rating !== null &&
    (typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 10)
  ) {
    throw new Error("Invalid annotation rating");
  }
  if (
    !Array.isArray(value.taxonomyTagClientIds) ||
    value.taxonomyTagClientIds.some((id) => typeof id !== "string")
  ) {
    throw new Error("Invalid annotation tags");
  }
}
