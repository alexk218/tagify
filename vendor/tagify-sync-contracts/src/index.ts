export const LEGACY_PRIVATE_SYNC_PROTOCOL_VERSION = 1 as const;
export const PRIVATE_SYNC_PROTOCOL_VERSION = 2 as const;
export const PUBLICATION_POLICY_VERSION = 2 as const;
export const MAX_SYNC_BATCH_OPERATIONS = 500;
export const MAX_TAXONOMY_NODES = 10_000;
export const MAX_ANNOTATIONS = 100_000;
export const MAX_APP_STATE_DOCUMENT_BYTES = 512_000;

export * from "./initialMerge";

export const DURABLE_APP_STATE_DOMAINS = [
  "smart-playlists",
  "filter-formulas",
  "playlist-rules",
  "preferences",
  "community-provenance",
] as const;

export type DurableAppStateDomain = (typeof DURABLE_APP_STATE_DOMAINS)[number];

export type SyncEntityKind = "track" | "album" | "playlist" | "artist";
export type TaxonomyNodeKind = "category" | "folder" | "subcategory" | "tag";
export type AnnotationField = "rating" | "energy" | "bpm" | "key";
export type SyncConflictKind = "field" | "membership" | "entity-delete" | "taxonomy-structure";
export type SyncMutationOrigin = "desktop" | "web" | "bootstrap" | "restore";

export interface SyncEntityRefV1 {
  provider: "spotify";
  kind: SyncEntityKind;
  providerId: string;
}

export interface RevisionedValueV1<T> {
  value: T;
  revision: number;
}

export interface AnnotationSnapshotV1 {
  entity: SyncEntityRefV1;
  fields: {
    rating: RevisionedValueV1<number | null>;
    energy: RevisionedValueV1<number | null>;
    bpm: RevisionedValueV1<number | null>;
    key: RevisionedValueV1<string | null>;
  };
  tagMemberships: Record<string, RevisionedValueV1<boolean>>;
  entityRevision: number;
  deleted: boolean;
  /** When Tagify first saved the item on any device (ISO). Older peers omit it. */
  createdAt?: string;
  /** When Tagify last changed the item on any device (ISO). Older peers omit it. */
  modifiedAt?: string;
}

export interface TaxonomyNodeSnapshotV1 {
  id: string;
  kind: TaxonomyNodeKind;
  parentId: string | null;
  name: string;
  accentId: string | null;
  position: number;
  nodeRevision: number;
  parentListRevision: number;
  deleted: boolean;
}

export interface CustomColorSnapshotV1 {
  id: string;
  name: string;
  color: string;
  revision: number;
  deleted: boolean;
}

export interface CollectionSnapshotV1 {
  id: string;
  name: string;
  colorIds: string[];
  position: number;
  revision: number;
  deleted: boolean;
}

export interface LibrarySnapshotV1 {
  protocolVersion: typeof LEGACY_PRIVATE_SYNC_PROTOCOL_VERSION;
  sourceStorageSchemaVersion: number;
  libraryId: string;
  headCursor: number;
  generatedAt: string;
  taxonomy: TaxonomyNodeSnapshotV1[];
  colors: CustomColorSnapshotV1[];
  collections: CollectionSnapshotV1[];
  annotations: AnnotationSnapshotV1[];
}

export interface DurableAppStateDocumentV2 {
  domain: DurableAppStateDomain;
  value: unknown;
  revision: number;
  updatedAt: string;
}

export interface LibrarySnapshotV2 extends Omit<LibrarySnapshotV1, "protocolVersion"> {
  protocolVersion: typeof PRIVATE_SYNC_PROTOCOL_VERSION;
  appState: DurableAppStateDocumentV2[];
  checksum?: string;
}

export type LibrarySnapshot = LibrarySnapshotV1 | LibrarySnapshotV2;

interface MutationBaseV1 {
  operationId: string;
  origin: SyncMutationOrigin;
}

/** Device timestamps an annotation change may carry; older peers ignore them. */
interface AnnotationTimestampsV1 {
  createdAt?: string;
  modifiedAt?: string;
}

export interface AnnotationPatchMutationV1 extends MutationBaseV1, AnnotationTimestampsV1 {
  type: "annotation.patch";
  entity: SyncEntityRefV1;
  fields: Partial<Record<AnnotationField, number | string | null>>;
  expectedRevisions: Partial<Record<AnnotationField, number>>;
}

export interface TagMembershipMutationV1 extends MutationBaseV1, AnnotationTimestampsV1 {
  type: "annotation.tag-membership";
  entity: SyncEntityRefV1;
  tagId: string;
  present: boolean;
  expectedRevision: number;
}

export interface AnnotationDeleteMutationV1 extends MutationBaseV1 {
  type: "annotation.delete";
  entity: SyncEntityRefV1;
  expectedEntityRevision: number;
}

export interface TaxonomyNodeMutationV1 extends MutationBaseV1 {
  type: "taxonomy.upsert" | "taxonomy.delete";
  node: Pick<TaxonomyNodeSnapshotV1, "id" | "kind" | "parentId" | "name" | "accentId" | "position">;
  expectedNodeRevision: number;
  expectedParentListRevision: number;
}

export interface TaxonomyOrderMutationV1 extends MutationBaseV1 {
  type: "taxonomy.reorder";
  parentId: string | null;
  orderedNodeIds: string[];
  expectedParentListRevision: number;
}

export interface ColorMutationV1 extends MutationBaseV1 {
  type: "color.upsert" | "color.delete";
  color: Pick<CustomColorSnapshotV1, "id" | "name" | "color">;
  expectedRevision: number;
}

export interface CollectionMutationV1 extends MutationBaseV1 {
  type: "collection.upsert" | "collection.delete";
  collection: Pick<CollectionSnapshotV1, "id" | "name" | "colorIds" | "position">;
  expectedRevision: number;
}

export type SyncMutationV1 =
  | AnnotationPatchMutationV1
  | TagMembershipMutationV1
  | AnnotationDeleteMutationV1
  | TaxonomyNodeMutationV1
  | TaxonomyOrderMutationV1
  | ColorMutationV1
  | CollectionMutationV1;

export interface AppStateReplaceMutationV2 extends MutationBaseV1 {
  type: "app-state.replace";
  domain: DurableAppStateDomain;
  value: unknown;
  expectedRevision: number;
}

export type SyncMutationV2 = SyncMutationV1 | AppStateReplaceMutationV2;

export interface SyncBatchV1 {
  protocolVersion: typeof LEGACY_PRIVATE_SYNC_PROTOCOL_VERSION;
  batchId: string;
  deviceId: string;
  baseCursor: number;
  operations: SyncMutationV1[];
}

export interface SyncBatchV2 extends Omit<SyncBatchV1, "protocolVersion" | "operations"> {
  protocolVersion: typeof PRIVATE_SYNC_PROTOCOL_VERSION;
  operations: SyncMutationV2[];
}

export type SyncBatch = SyncBatchV1 | SyncBatchV2;

export interface SyncChangeV1 {
  cursor: number;
  batchId: string;
  operation: SyncMutationV1;
  committedAt: string;
}

export interface SyncConflictV1 {
  id: string;
  libraryId: string;
  kind: SyncConflictKind;
  operationId: string;
  entity: SyncEntityRefV1 | null;
  taxonomyNodeId: string | null;
  field: AnnotationField | null;
  tagId: string | null;
  expectedRevision: number;
  actualRevision: number;
  attemptedValue: unknown;
  canonicalValue: unknown;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SyncCapabilitiesV1 {
  protocolVersion: number;
  supportedProtocolVersions: number[];
  minimumStorageSchemaVersion: number;
  maximumStorageSchemaVersion: number;
  pairingEnabled: boolean;
  writesEnabled: boolean;
  projectionEnabled: boolean;
  webAnnotationEditingEnabled: boolean;
  webTaxonomyEditingEnabled: boolean;
  maxBatchOperations: number;
  maxSnapshotChunkBytes: number;
  retentionDays: number;
  initialMergeReviewVersion?: 1;
}

export interface SyncCapabilitiesV2 extends SyncCapabilitiesV1 {
  capabilitiesVersion: 2;
  minimumEfficientClientVersion: string;
  efficientClientGeneration: "event-driven-v1";
  realtime: {
    enabled: boolean;
    event: "head_cursor";
    recoveryPollSeconds: number[];
    pauseWhenHidden: boolean;
  };
  snapshotDelivery: {
    mode: "private-signed-url";
    compression: "gzip";
    immutableByRevision: boolean;
  };
}

export interface PublicationEntityRuleV2 {
  tags: boolean;
  rating: boolean;
}

export interface PublicationPolicyV2 {
  policyVersion: typeof PUBLICATION_POLICY_VERSION;
  revision: number;
  reviewedAt: string | null;
  enabled: boolean;
  paused: boolean;
  shareTaxonomy: boolean;
  shareActivity: boolean;
  entities: Record<"track" | "album" | "artist", PublicationEntityRuleV2>;
  hiddenTagIds: string[];
  hiddenNodeIds: string[];
  excludedEntities: SyncEntityRefV1[];
  entityOverrides: Array<{
    entity: SyncEntityRefV1;
    tags: boolean;
    rating: boolean;
  }>;
}

export interface SyncPullResponseV1 {
  protocolVersion: number;
  libraryId: string;
  headCursor: number;
  changes: SyncChangeV1[];
  conflicts: SyncConflictV1[];
  snapshotRequired: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPOTIFY_ID = /^[A-Za-z0-9]{10,64}$/;
const SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const CAMELOT_KEY = /^(?:[1-9]|1[0-2])[AB]$/;

export function assertSyncBatchV1(value: unknown): asserts value is SyncBatchV1 {
  if (!isRecord(value) || value.protocolVersion !== LEGACY_PRIVATE_SYNC_PROTOCOL_VERSION) fail("Unsupported private sync protocol");
  assertUuid(value.batchId, "batchId");
  assertUuid(value.deviceId, "deviceId");
  assertCursor(value.baseCursor, "baseCursor");
  if (!Array.isArray(value.operations) || value.operations.length === 0 || value.operations.length > MAX_SYNC_BATCH_OPERATIONS) fail("Invalid operation count");
  const ids = new Set<string>();
  value.operations.forEach((operation) => {
    assertSyncMutationV1(operation);
    if (ids.has(operation.operationId)) fail("Duplicate operationId in batch");
    ids.add(operation.operationId);
  });
}

export function assertSyncBatch(value: unknown): asserts value is SyncBatch {
  if (!isRecord(value)) fail("Invalid sync batch");
  if (value.protocolVersion === LEGACY_PRIVATE_SYNC_PROTOCOL_VERSION) {
    assertSyncBatchV1(value);
    return;
  }
  if (value.protocolVersion !== PRIVATE_SYNC_PROTOCOL_VERSION) fail("Unsupported private sync protocol");
  assertUuid(value.batchId, "batchId");
  assertUuid(value.deviceId, "deviceId");
  assertCursor(value.baseCursor, "baseCursor");
  if (!Array.isArray(value.operations) || value.operations.length === 0 || value.operations.length > MAX_SYNC_BATCH_OPERATIONS) fail("Invalid operation count");
  const ids = new Set<string>();
  value.operations.forEach((operation) => {
    assertSyncMutationV2(operation);
    if (ids.has(operation.operationId)) fail("Duplicate operationId in batch");
    ids.add(operation.operationId);
  });
}

export function assertSyncMutationV2(value: unknown): asserts value is SyncMutationV2 {
  if (!isRecord(value)) fail("Invalid sync mutation");
  if (value.type !== "app-state.replace") {
    assertSyncMutationV1(value);
    return;
  }
  assertUuid(value.operationId, "operationId");
  if (value.origin !== "desktop" && value.origin !== "web" && value.origin !== "bootstrap" && value.origin !== "restore") fail("Invalid mutation origin");
  assertDurableAppStateDomain(value.domain);
  assertRevision(value.expectedRevision);
  assertJsonValue(value.value, "app-state value");
  if (jsonByteLength(value.value) > MAX_APP_STATE_DOCUMENT_BYTES) fail("App-state document is too large");
}

export function assertSyncMutationV1(value: unknown): asserts value is SyncMutationV1 {
  if (!isRecord(value)) fail("Invalid sync mutation");
  assertUuid(value.operationId, "operationId");
  if (value.origin !== "desktop" && value.origin !== "web" && value.origin !== "bootstrap" && value.origin !== "restore") fail("Invalid mutation origin");
  switch (value.type) {
    case "annotation.patch":
      assertEntity(value.entity);
      if (!isRecord(value.fields) || !isRecord(value.expectedRevisions)) fail("Invalid annotation patch");
      assertAnnotationFields(value.fields, value.expectedRevisions);
      assertOptionalTimestamps(value);
      return;
    case "annotation.tag-membership":
      assertEntity(value.entity); assertSafeId(value.tagId, "tagId"); assertBoolean(value.present, "present"); assertRevision(value.expectedRevision); assertOptionalTimestamps(value); return;
    case "annotation.delete":
      assertEntity(value.entity); assertRevision(value.expectedEntityRevision); return;
    case "taxonomy.upsert":
    case "taxonomy.delete":
      assertTaxonomyNode(value.node); assertRevision(value.expectedNodeRevision); assertRevision(value.expectedParentListRevision); return;
    case "taxonomy.reorder":
      if (value.parentId !== null) assertSafeId(value.parentId, "parentId");
      if (!Array.isArray(value.orderedNodeIds) || new Set(value.orderedNodeIds).size !== value.orderedNodeIds.length) fail("Invalid taxonomy order");
      value.orderedNodeIds.forEach((id) => assertSafeId(id, "orderedNodeId")); assertRevision(value.expectedParentListRevision); return;
    case "color.upsert":
    case "color.delete":
      assertColor(value.color); assertRevision(value.expectedRevision); return;
    case "collection.upsert":
    case "collection.delete":
      assertCollection(value.collection); assertRevision(value.expectedRevision); return;
    default:
      fail("Unsupported sync mutation");
  }
}

export function assertLibrarySnapshotV1(value: unknown): asserts value is LibrarySnapshotV1 {
  if (!isRecord(value) || value.protocolVersion !== LEGACY_PRIVATE_SYNC_PROTOCOL_VERSION) fail("Unsupported snapshot protocol");
  assertLibrarySnapshotCore(value);
}

function assertLibrarySnapshotCore(value: Record<string, unknown>) {
  if (!Number.isInteger(value.sourceStorageSchemaVersion) || Number(value.sourceStorageSchemaVersion) < 1) fail("Invalid storage schema version");
  assertUuid(value.libraryId, "libraryId"); assertCursor(value.headCursor, "headCursor"); assertIsoDate(value.generatedAt, "generatedAt");
  if (!Array.isArray(value.taxonomy) || value.taxonomy.length > MAX_TAXONOMY_NODES) fail("Invalid taxonomy snapshot");
  if (!Array.isArray(value.annotations) || value.annotations.length > MAX_ANNOTATIONS) fail("Invalid annotation snapshot");
  if (!Array.isArray(value.colors) || !Array.isArray(value.collections)) fail("Invalid color collections");
  value.taxonomy.forEach(assertTaxonomySnapshotNode);
  value.colors.forEach(assertColorSnapshot);
  value.collections.forEach(assertCollectionSnapshot);
  value.annotations.forEach(assertAnnotationSnapshot);
}

export function assertLibrarySnapshotV2(value: unknown): asserts value is LibrarySnapshotV2 {
  if (!isRecord(value) || value.protocolVersion !== PRIVATE_SYNC_PROTOCOL_VERSION) fail("Unsupported snapshot protocol");
  assertLibrarySnapshotCore(value);
  if (!Array.isArray(value.appState) || value.appState.length > DURABLE_APP_STATE_DOMAINS.length) fail("Invalid app-state snapshot");
  const domains = new Set<DurableAppStateDomain>();
  value.appState.forEach((document) => {
    assertDurableAppStateDocument(document);
    if (domains.has(document.domain)) fail("Duplicate app-state domain");
    domains.add(document.domain);
  });
  if (value.checksum !== undefined && (typeof value.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(value.checksum))) fail("Invalid snapshot checksum");
}

export function assertLibrarySnapshot(value: unknown): asserts value is LibrarySnapshot {
  if (!isRecord(value)) fail("Invalid library snapshot");
  if (value.protocolVersion === LEGACY_PRIVATE_SYNC_PROTOCOL_VERSION) assertLibrarySnapshotV1(value);
  else assertLibrarySnapshotV2(value);
}

export function assertPublicationPolicyV2(value: unknown): asserts value is PublicationPolicyV2 {
  if (!isRecord(value) || value.policyVersion !== PUBLICATION_POLICY_VERSION) fail("Unsupported publication policy");
  assertRevision(value.revision);
  if (value.reviewedAt !== null) assertIsoDate(value.reviewedAt, "reviewedAt");
  ["enabled", "paused", "shareTaxonomy", "shareActivity"].forEach((key) => assertBoolean(value[key], key));
  if (!isRecord(value.entities)) fail("Invalid publication entity rules");
  const entityRules = value.entities as Record<string, unknown>;
  (["track", "album", "artist"] as const).forEach((kind) => assertPublicationRule(entityRules[kind]));
  if (!Array.isArray(value.hiddenTagIds)) fail("Invalid hidden tags");
  value.hiddenTagIds.forEach((id) => assertSafeId(id, "hiddenTagId"));
  if (!Array.isArray(value.hiddenNodeIds)) fail("Invalid hidden taxonomy nodes");
  value.hiddenNodeIds.forEach((id) => assertSafeId(id, "hiddenNodeId"));
  if (!Array.isArray(value.excludedEntities)) fail("Invalid excluded entities");
  value.excludedEntities.forEach(assertEntity);
  if (!Array.isArray(value.entityOverrides)) fail("Invalid entity overrides");
  value.entityOverrides.forEach((override) => {
    if (!isRecord(override)) fail("Invalid entity override");
    assertEntity(override.entity); assertBoolean(override.tags, "tags"); assertBoolean(override.rating, "rating");
  });
}

export function entityKeyV1(entity: SyncEntityRefV1): string {
  return `${entity.provider}:${entity.kind}:${entity.providerId}`;
}

function assertAnnotationFields(fields: Record<string, unknown>, revisions: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (keys.length === 0 || keys.some((key) => !isAnnotationField(key))) fail("Invalid annotation fields");
  keys.forEach((field) => {
    const value = fields[field];
    if (field === "rating" && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5 || value * 2 % 1 !== 0)) fail("Invalid rating");
    if (field === "energy" && value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10)) fail("Invalid energy");
    if (field === "bpm" && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 20 || value > 400)) fail("Invalid BPM");
    if (field === "key" && value !== null && (typeof value !== "string" || !CAMELOT_KEY.test(value))) fail("Invalid musical key");
    assertRevision(revisions[field]);
  });
}

function assertEntity(value: unknown): asserts value is SyncEntityRefV1 {
  if (!isRecord(value) || value.provider !== "spotify" || !isEntityKind(value.kind) || typeof value.providerId !== "string" || !SPOTIFY_ID.test(value.providerId)) fail("Invalid Spotify entity");
}

function assertTaxonomyNode(value: unknown) {
  if (!isRecord(value)) fail("Invalid taxonomy node");
  assertSafeId(value.id, "nodeId");
  if (value.kind !== "category" && value.kind !== "folder" && value.kind !== "subcategory" && value.kind !== "tag") fail("Invalid taxonomy node kind");
  if (value.parentId !== null) assertSafeId(value.parentId, "parentId");
  assertSafeName(value.name, "taxonomy name");
  if (value.accentId !== null) assertSafeId(value.accentId, "accentId");
  if (!Number.isInteger(value.position) || Number(value.position) < 0) fail("Invalid taxonomy position");
}

function assertTaxonomySnapshotNode(value: unknown) {
  assertTaxonomyNode(value);
  const node = value as Record<string, unknown>;
  assertRevision(node.nodeRevision); assertRevision(node.parentListRevision); assertBoolean(node.deleted, "deleted");
}

function assertColor(value: unknown) {
  if (!isRecord(value)) fail("Invalid color");
  assertSafeId(value.id, "colorId"); assertSafeName(value.name, "color name");
  if (typeof value.color !== "string" || !HEX_COLOR.test(value.color)) fail("Invalid color value");
}

function assertColorSnapshot(value: unknown) { assertColor(value); const color = value as Record<string, unknown>; assertRevision(color.revision); assertBoolean(color.deleted, "deleted"); }

function assertCollection(value: unknown) {
  if (!isRecord(value)) fail("Invalid collection");
  assertSafeId(value.id, "collectionId"); assertSafeName(value.name, "collection name");
  if (!Array.isArray(value.colorIds)) fail("Invalid collection colors");
  value.colorIds.forEach((id) => assertSafeId(id, "colorId"));
  if (!Number.isInteger(value.position) || Number(value.position) < 0) fail("Invalid collection position");
}

function assertCollectionSnapshot(value: unknown) { assertCollection(value); const collection = value as Record<string, unknown>; assertRevision(collection.revision); assertBoolean(collection.deleted, "deleted"); }

function assertAnnotationSnapshot(value: unknown) {
  if (!isRecord(value)) fail("Invalid annotation snapshot");
  assertEntity(value.entity);
  if (!isRecord(value.fields) || !isRecord(value.tagMemberships)) fail("Invalid annotation state");
  const fields = value.fields as Record<string, unknown>;
  (["rating", "energy", "bpm", "key"] as const).forEach((field) => {
    const revisioned = fields[field];
    if (!isRecord(revisioned)) fail("Invalid field state");
    assertRevision(revisioned.revision);
  });
  Object.entries(value.tagMemberships).forEach(([tagId, membership]) => {
    assertSafeId(tagId, "tagId");
    if (!isRecord(membership)) fail("Invalid membership state");
    assertBoolean(membership.value, "membership"); assertRevision(membership.revision);
  });
  assertRevision(value.entityRevision); assertBoolean(value.deleted, "deleted");
  assertOptionalTimestamps(value);
}

function assertOptionalTimestamps(value: Record<string, unknown>) {
  if (value.createdAt !== undefined) assertIsoDate(value.createdAt, "createdAt");
  if (value.modifiedAt !== undefined) assertIsoDate(value.modifiedAt, "modifiedAt");
}

function assertPublicationRule(value: unknown) {
  if (!isRecord(value)) fail("Invalid publication rule");
  assertBoolean(value.tags, "tags"); assertBoolean(value.rating, "rating");
}

function assertDurableAppStateDocument(value: unknown): asserts value is DurableAppStateDocumentV2 {
  if (!isRecord(value)) fail("Invalid app-state document");
  assertDurableAppStateDomain(value.domain);
  assertJsonValue(value.value, "app-state value");
  if (jsonByteLength(value.value) > MAX_APP_STATE_DOCUMENT_BYTES) fail("App-state document is too large");
  assertRevision(value.revision);
  assertIsoDate(value.updatedAt, "updatedAt");
}

function assertDurableAppStateDomain(value: unknown): asserts value is DurableAppStateDomain {
  if (typeof value !== "string" || !(DURABLE_APP_STATE_DOMAINS as readonly string[]).includes(value)) fail("Invalid app-state domain");
}

function assertJsonValue(value: unknown, name: string, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`Invalid ${name}`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) fail(`Invalid ${name}`);
    seen.add(value);
    value.forEach((item) => assertJsonValue(item, name, seen));
    seen.delete(value);
    return;
  }
  if (isRecord(value)) {
    if (seen.has(value)) fail(`Invalid ${name}`);
    seen.add(value);
    Object.entries(value).forEach(([key, item]) => {
      if (key === "__proto__" || key === "prototype" || key === "constructor") fail(`Invalid ${name}`);
      assertJsonValue(item, name, seen);
    });
    seen.delete(value);
    return;
  }
  fail(`Invalid ${name}`);
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function assertUuid(value: unknown, name: string) { if (typeof value !== "string" || !UUID.test(value)) fail(`Invalid ${name}`); }
function assertSafeId(value: unknown, name: string) { if (typeof value !== "string" || !SAFE_ID.test(value)) fail(`Invalid ${name}`); }
function assertSafeName(value: unknown, name: string) { if (typeof value !== "string" || value.trim().length === 0 || value.length > 80 || /[<>]/.test(value)) fail(`Invalid ${name}`); }
function assertBoolean(value: unknown, name: string) { if (typeof value !== "boolean") fail(`Invalid ${name}`); }
function assertRevision(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) fail("Invalid revision"); }
function assertCursor(value: unknown, name: string) { if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`Invalid ${name}`); }
function assertIsoDate(value: unknown, name: string) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`Invalid ${name}`); }
function isEntityKind(value: unknown): value is SyncEntityKind { return value === "track" || value === "album" || value === "playlist" || value === "artist"; }
function isAnnotationField(value: string): value is AnnotationField { return value === "rating" || value === "energy" || value === "bpm" || value === "key"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(message: string): never { throw new Error(message); }
