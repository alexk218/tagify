import type { MusicEntityKind, MusicEntityRefV1 } from "./index";
import { isRecord } from "./validation";
import {
  isTagifyPresetAccentId,
  type TagifyPresetAccentId,
} from "../../../src/shared/tagAccentPresets";

export const PUBLISHED_TAXONOMY_ARTIFACT_VERSION = 1 as const;
export const PUBLICATION_POLICY_VERSION = 1 as const;
export const INSTALLED_TAXONOMY_RECORD_VERSION = 1 as const;
export const TAGIFY_BACKUP_ENVELOPE_VERSION = 2 as const;

export const TAXONOMY_ARTIFACT_LIMITS = {
  nodes: 10_000,
  colors: 10_000,
  collections: 2_000,
  lineage: 1_000,
  labelLength: 80,
  descriptionLength: 2_000,
} as const;

export type PublicationVisibilityV1 = "public" | "unlisted";
export type PublicTaxonomyNodeKindV1 = "category" | "folder" | "subcategory" | "tag";

export interface PublishedAccentRefV1 {
  kind: "preset" | "custom";
  id: TagifyPresetAccentId | string;
}

export interface PublishedTaxonomyNodeV1 {
  publicId: string;
  kind: PublicTaxonomyNodeKindV1;
  parentPublicId: string | null;
  position: number;
  label: string;
  accent: PublishedAccentRefV1 | null;
}

export interface PublishedColorV1 {
  publicId: string;
  name: string;
  hex: string;
  collectionPublicId: string | null;
  position: number;
}

export interface PublishedColorCollectionV1 {
  publicId: string;
  name: string;
  position: number;
}

export interface VerifiedRemixSourceV1 {
  sourceTaxonomyId: string;
  sourceRevisionId: string;
  sourceAuthorHandle: string | null;
  sourceAuthorTombstoned: boolean;
  sourceNodePublicIds: string[];
}

export interface PublishedTaxonomyArtifactV1 {
  format: "tagify-published-taxonomy";
  artifactVersion: typeof PUBLISHED_TAXONOMY_ARTIFACT_VERSION;
  taxonomyId: string;
  revisionId: string;
  revision: number;
  shareSlug: string;
  author: { handle: string | null; displayName: string | null };
  description: string | null;
  visibility: PublicationVisibilityV1;
  publishedAt: string;
  compatibility: {
    minimumTagifyMajor: 3;
    sourceTagifySchemaVersion: number;
  };
  nodes: PublishedTaxonomyNodeV1[];
  colors: PublishedColorV1[];
  collections: PublishedColorCollectionV1[];
  ungroupedColorPublicIds: string[];
  lineage: VerifiedRemixSourceV1[];
  checksum: string;
}

export interface PublicationPolicyV1 {
  policyVersion: typeof PUBLICATION_POLICY_VERSION;
  visibility: PublicationVisibilityV1;
  approvedLocalNodeIds: string[];
  approvedLocalColorIds: string[];
  approvedLocalCollectionIds: string[];
  entityRules: Record<MusicEntityKind, { tags: boolean; ratings: boolean }>;
  excludedEntities: MusicEntityRefV1[];
  publishActivity: boolean;
}

export interface OwnerTaxonomyIdentityMappingV1 {
  taxonomyId: string;
  localNodeToPublicId: Record<string, string>;
  localColorToPublicId: Record<string, string>;
  localCollectionToPublicId: Record<string, string>;
}

export interface InstalledTaxonomyRecordV1 {
  recordVersion: typeof INSTALLED_TAXONOMY_RECORD_VERSION;
  installationId: string;
  taxonomyId: string;
  sourceShareSlug: string;
  sourceRevisionId: string;
  sourceRevision: number;
  sourceAuthor: { handle: string | null; displayName: string | null };
  installedAt: string;
  updatedAt: string;
  lastUpdateCheckAt: string | null;
  nodePublicToLocalId: Record<string, string>;
  colorPublicToLocalId: Record<string, string>;
  collectionPublicToLocalId: Record<string, string>;
  sourceFingerprints: Record<string, string>;
  installedLocalFingerprints: Record<string, string>;
  locallyEditedPublicIds: string[];
  detachedLocalIds: string[];
}

export interface TagifyBackupEnvelopeV2<TTagData = unknown> {
  format: "tagify-backup";
  envelopeVersion: typeof TAGIFY_BACKUP_ENVELOPE_VERSION;
  exportedAt: string;
  tagifyVersion: string;
  tagData: TTagData;
  community: {
    publicationPolicy: PublicationPolicyV1 | null;
    ownerIdentityMapping: OwnerTaxonomyIdentityMappingV1 | null;
    installations: InstalledTaxonomyRecordV1[];
  };
}

const PUBLIC_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SHARE_SLUG = /^[A-Za-z0-9_-]{16,128}$/;
const HANDLE = /^[a-z0-9_]{2,32}$/;
const HEX = /^#[0-9a-f]{6}$/;
const CHECKSUM = /^[0-9a-f]{64}$/;

export function assertPublishedTaxonomyArtifactV1(
  value: unknown,
): asserts value is PublishedTaxonomyArtifactV1 {
  if (
    !isRecord(value) ||
    value.format !== "tagify-published-taxonomy" ||
    value.artifactVersion !== 1
  ) {
    throw new Error("Unsupported taxonomy artifact version");
  }
  assertPublicId(value.taxonomyId, "taxonomy ID");
  assertPublicId(value.revisionId, "revision ID");
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1)
    throw new Error("Invalid taxonomy revision");
  if (typeof value.shareSlug !== "string" || !SHARE_SLUG.test(value.shareSlug))
    throw new Error("Invalid taxonomy share slug");
  if (!isRecord(value.author)) throw new Error("Invalid taxonomy author");
  if (
    value.author.handle !== null &&
    (typeof value.author.handle !== "string" ||
      !HANDLE.test(value.author.handle))
  )
    throw new Error("Invalid taxonomy author handle");
  if (value.author.displayName !== null)
    assertLabel(value.author.displayName, "author display name");
  if (
    value.description !== null &&
    (typeof value.description !== "string" ||
      value.description.length > TAXONOMY_ARTIFACT_LIMITS.descriptionLength)
  )
    throw new Error("Invalid taxonomy description");
  assertVisibility(value.visibility);
  assertIsoDate(value.publishedAt, "published timestamp");
  if (
    !isRecord(value.compatibility) ||
    value.compatibility.minimumTagifyMajor !== 3 ||
    !Number.isInteger(value.compatibility.sourceTagifySchemaVersion)
  )
    throw new Error("Invalid taxonomy compatibility metadata");
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length > TAXONOMY_ARTIFACT_LIMITS.nodes
  )
    throw new Error("Taxonomy node limit exceeded");
  if (
    !Array.isArray(value.colors) ||
    value.colors.length > TAXONOMY_ARTIFACT_LIMITS.colors
  )
    throw new Error("Taxonomy color limit exceeded");
  if (
    !Array.isArray(value.collections) ||
    value.collections.length > TAXONOMY_ARTIFACT_LIMITS.collections
  )
    throw new Error("Taxonomy collection limit exceeded");
  if (
    !Array.isArray(value.lineage) ||
    value.lineage.length > TAXONOMY_ARTIFACT_LIMITS.lineage
  )
    throw new Error("Taxonomy lineage limit exceeded");

  const nodeIds = new Set<string>();
  const colorIds = new Set<string>();
  const collectionIds = new Set<string>();
  value.collections.forEach((item) => {
    if (!isRecord(item)) throw new Error("Invalid color collection");
    assertUniquePublicId(item.publicId, collectionIds, "collection");
    assertLabel(item.name, "collection name");
    assertPosition(item.position);
  });
  value.colors.forEach((item) => {
    if (!isRecord(item)) throw new Error("Invalid color");
    assertUniquePublicId(item.publicId, colorIds, "color");
    assertLabel(item.name, "color name");
    if (typeof item.hex !== "string" || !HEX.test(item.hex))
      throw new Error("Invalid color hex");
    if (
      item.collectionPublicId !== null &&
      (typeof item.collectionPublicId !== "string" ||
        !collectionIds.has(item.collectionPublicId))
    )
      throw new Error("Color references an unknown collection");
    assertPosition(item.position);
  });
  value.nodes.forEach((item) => {
    if (!isRecord(item)) throw new Error("Invalid taxonomy node");
    assertUniquePublicId(item.publicId, nodeIds, "taxonomy node");
    if (
      item.kind !== "category" &&
      item.kind !== "folder" &&
      item.kind !== "subcategory" &&
      item.kind !== "tag"
    )
      throw new Error("Invalid taxonomy node kind");
    assertLabel(item.label, "taxonomy label");
    assertPosition(item.position);
    assertAccent(item.accent, colorIds);
  });
  validateNodeGraph(value.nodes as PublishedTaxonomyNodeV1[], nodeIds);
  if (
    !Array.isArray(value.ungroupedColorPublicIds) ||
    new Set(value.ungroupedColorPublicIds).size !==
      value.ungroupedColorPublicIds.length ||
    value.ungroupedColorPublicIds.some(
      (id) => typeof id !== "string" || !colorIds.has(id),
    )
  )
    throw new Error("Invalid ungrouped color order");
  const grouped = new Set(
    (value.colors as PublishedColorV1[])
      .filter((color) => color.collectionPublicId !== null)
      .map((color) => color.publicId),
  );
  if (value.ungroupedColorPublicIds.some((id) => grouped.has(id)))
    throw new Error("A grouped color cannot also be ungrouped");
  value.lineage.forEach(assertLineage);
  if (typeof value.checksum !== "string" || !CHECKSUM.test(value.checksum))
    throw new Error("Invalid taxonomy checksum");
}

export function assertPublicationPolicyV1(
  value: unknown,
): asserts value is PublicationPolicyV1 {
  if (!isRecord(value) || value.policyVersion !== 1)
    throw new Error("Unsupported publication policy version");
  assertVisibility(value.visibility);
  for (const field of [
    "approvedLocalNodeIds",
    "approvedLocalColorIds",
    "approvedLocalCollectionIds",
  ] as const)
    assertLocalIdList(value[field], field);
  if (!isRecord(value.entityRules))
    throw new Error("Invalid entity publication rules");
  for (const kind of ["track", "album", "artist"] as const) {
    const rule = value.entityRules[kind];
    if (
      !isRecord(rule) ||
      typeof rule.tags !== "boolean" ||
      typeof rule.ratings !== "boolean"
    )
      throw new Error("Invalid entity publication rule");
  }
  if (
    !Array.isArray(value.excludedEntities) ||
    value.excludedEntities.length > 100_000
  )
    throw new Error("Invalid excluded entities");
  value.excludedEntities.forEach(assertMusicEntityRef);
  if (typeof value.publishActivity !== "boolean")
    throw new Error("Invalid activity preference");
}

export function assertInstalledTaxonomyRecordV1(
  value: unknown,
): asserts value is InstalledTaxonomyRecordV1 {
  if (!isRecord(value) || value.recordVersion !== 1)
    throw new Error("Unsupported installed taxonomy record version");
  for (const field of [
    "installationId",
    "taxonomyId",
    "sourceRevisionId",
  ] as const)
    assertPublicId(value[field], field);
  if (typeof value.sourceShareSlug !== "string" || !SHARE_SLUG.test(value.sourceShareSlug))
    throw new Error("Invalid installed source share slug");
  if (
    !Number.isInteger(value.sourceRevision) ||
    Number(value.sourceRevision) < 1
  )
    throw new Error("Invalid installed source revision");
  if (!isRecord(value.sourceAuthor))
    throw new Error("Invalid installed source author");
  if (
    value.sourceAuthor.handle !== null &&
    (typeof value.sourceAuthor.handle !== "string" ||
      !HANDLE.test(value.sourceAuthor.handle))
  )
    throw new Error("Invalid installed source author handle");
  if (value.sourceAuthor.displayName !== null)
    assertLabel(value.sourceAuthor.displayName, "installed source author name");
  for (const field of [
    "nodePublicToLocalId",
    "colorPublicToLocalId",
    "collectionPublicToLocalId",
    "sourceFingerprints",
    "installedLocalFingerprints",
  ] as const)
    if (!isStringRecord(value[field])) throw new Error(`Invalid ${field}`);
  for (const field of ["locallyEditedPublicIds", "detachedLocalIds"] as const)
    assertLocalIdList(value[field], field);
  assertIsoDate(value.installedAt, "installed timestamp");
  assertIsoDate(value.updatedAt, "updated timestamp");
  if (value.lastUpdateCheckAt !== null)
    assertIsoDate(value.lastUpdateCheckAt, "update check timestamp");
}

export function taxonomyArtifactChecksumPayload(
  artifact:
    Omit<PublishedTaxonomyArtifactV1, "checksum"> | PublishedTaxonomyArtifactV1,
): string {
  const { checksum: _checksum, ...content } =
    artifact as PublishedTaxonomyArtifactV1;
  return canonicalJson(content);
}

export async function computeTaxonomyArtifactChecksum(
  artifact:
    Omit<PublishedTaxonomyArtifactV1, "checksum"> | PublishedTaxonomyArtifactV1,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    taxonomyArtifactChecksumPayload(artifact),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function assertTaxonomyArtifactChecksum(
  artifact: PublishedTaxonomyArtifactV1,
): Promise<void> {
  if ((await computeTaxonomyArtifactChecksum(artifact)) !== artifact.checksum)
    throw new Error("Taxonomy artifact checksum mismatch");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  throw new Error("Canonical JSON contains an unsupported value");
}

function validateNodeGraph(
  nodes: PublishedTaxonomyNodeV1[],
  ids: Set<string>,
): void {
  const byId = new Map(nodes.map((node) => [node.publicId, node]));
  const siblingLabels = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "category" && node.parentPublicId !== null)
      throw new Error("Category cannot have a parent");
    if (node.kind !== "category") {
      if (!node.parentPublicId || !ids.has(node.parentPublicId))
        throw new Error("Taxonomy node has an unknown parent");
      const parent = byId.get(node.parentPublicId)!;
      if (parent.kind === "tag")
        throw new Error("Invalid taxonomy hierarchy");
    }
    const siblingKey = `${node.parentPublicId ?? "root"}\u0000${node.label.toLocaleLowerCase()}`;
    if (siblingLabels.has(siblingKey))
      throw new Error("Duplicate sibling taxonomy label");
    siblingLabels.add(siblingKey);
  }
  for (const node of nodes) {
    const seen = new Set<string>();
    let cursor: PublishedTaxonomyNodeV1 | undefined = node;
    while (cursor) {
      if (seen.has(cursor.publicId)) throw new Error("Taxonomy hierarchy contains a cycle");
      seen.add(cursor.publicId);
      cursor = cursor.parentPublicId ? byId.get(cursor.parentPublicId) : undefined;
    }
  }
}

function assertAccent(value: unknown, colorIds: Set<string>): void {
  if (value === null) return;
  if (
    !isRecord(value) ||
    (value.kind !== "preset" && value.kind !== "custom") ||
    typeof value.id !== "string"
  )
    throw new Error("Invalid tag accent binding");
  if (value.kind === "preset" && !isTagifyPresetAccentId(value.id))
    throw new Error("Unknown preset tag accent");
  if (value.kind === "custom" && !colorIds.has(value.id))
    throw new Error("Tag references an unknown custom color");
}

function assertLineage(value: unknown): void {
  if (!isRecord(value)) throw new Error("Invalid remix lineage");
  assertPublicId(value.sourceTaxonomyId, "source taxonomy ID");
  assertPublicId(value.sourceRevisionId, "source revision ID");
  if (
    value.sourceAuthorHandle !== null &&
    (typeof value.sourceAuthorHandle !== "string" ||
      !HANDLE.test(value.sourceAuthorHandle))
  )
    throw new Error("Invalid lineage author");
  if (
    typeof value.sourceAuthorTombstoned !== "boolean" ||
    !Array.isArray(value.sourceNodePublicIds) ||
    value.sourceNodePublicIds.some(
      (id) => typeof id !== "string" || !PUBLIC_ID.test(id),
    )
  )
    throw new Error("Invalid remix lineage");
}

function assertUniquePublicId(
  value: unknown,
  ids: Set<string>,
  label: string,
): void {
  assertPublicId(value, label);
  if (ids.has(value as string)) throw new Error(`Duplicate ${label} ID`);
  ids.add(value as string);
}

function assertPublicId(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !PUBLIC_ID.test(value))
    throw new Error(`Invalid ${label}`);
}

function assertLabel(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > TAXONOMY_ARTIFACT_LIMITS.labelLength ||
    /[<>\u0000-\u001f]/.test(value)
  )
    throw new Error(`Invalid ${label}`);
}

function assertPosition(value: unknown): void {
  if (
    !Number.isInteger(value) ||
    Number(value) < 0 ||
    Number(value) > TAXONOMY_ARTIFACT_LIMITS.nodes
  )
    throw new Error("Invalid ordering position");
}

function assertVisibility(
  value: unknown,
): asserts value is PublicationVisibilityV1 {
  if (value !== "public" && value !== "unlisted")
    throw new Error("Invalid publication visibility");
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error(`Invalid ${label}`);
}

function assertLocalIdList(
  value: unknown,
  label: string,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length > TAXONOMY_ARTIFACT_LIMITS.nodes ||
    value.some(
      (item) =>
        typeof item !== "string" || item.length < 1 || item.length > 128,
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error(`Invalid ${label}`);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        key.length <= 128 && typeof item === "string" && item.length <= 128,
    )
  );
}

function assertMusicEntityRef(
  value: unknown,
): asserts value is MusicEntityRefV1 {
  if (
    !isRecord(value) ||
    value.provider !== "spotify" ||
    (value.kind !== "track" &&
      value.kind !== "album" &&
      value.kind !== "artist") ||
    typeof value.providerId !== "string" ||
    !/^[A-Za-z0-9]{10,64}$/.test(value.providerId)
  ) {
    throw new Error("Invalid excluded Spotify entity");
  }
}
