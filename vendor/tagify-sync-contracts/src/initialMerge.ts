import type {
  AnnotationSnapshotV1,
  CollectionSnapshotV1,
  CustomColorSnapshotV1,
  DurableAppStateDocumentV2,
  LibrarySnapshotV2,
  TaxonomyNodeSnapshotV1,
} from "./index";

export type InitialMergeSource = "device" | "community";

export type InitialMergeConflictKind =
  | "annotation-field"
  | "tag-membership"
  | "annotation-state"
  | "taxonomy"
  | "color"
  | "collection"
  | "smart-playlist"
  | "saved-setting";

export interface InitialMergeConflictV1 {
  id: string;
  kind: InitialMergeConflictKind;
  subjectId: string;
  field: string | null;
  deviceValue: unknown;
  communityValue: unknown;
}

export interface InitialMergeCountsV1 {
  annotations: number;
  taxonomy: number;
  smartPlaylists: number;
  savedSettings: number;
}

export interface InitialMergePlanV1 {
  version: 1;
  communityHeadCursor: number;
  communityChecksum: string | null;
  device: InitialMergeCountsV1;
  community: InitialMergeCountsV1;
  additionsFromDevice: number;
  additionsFromCommunity: number;
  unchanged: number;
  conflicts: InitialMergeConflictV1[];
}

export interface InitialMergeRequestV1 {
  version: 1;
  deviceId: string;
  operationId: string;
  expectedCommunityHeadCursor: number;
  expectedCommunityChecksum: string | null;
  deviceSnapshot: LibrarySnapshotV2;
  resolutions: Record<string, InitialMergeSource>;
}

export interface InitialMergeResultV1 {
  version: 1;
  headCursor: number;
  additionsFromDevice: number;
  additionsFromCommunity: number;
  conflictsResolved: number;
}

export function planInitialLibraryMerge(
  device: LibrarySnapshotV2,
  community: LibrarySnapshotV2,
): InitialMergePlanV1 {
  const state = createMergeState(device, community, {});
  return {
    version: 1,
    communityHeadCursor: community.headCursor,
    communityChecksum: community.checksum ?? null,
    device: snapshotCounts(device),
    community: snapshotCounts(community),
    additionsFromDevice: state.additionsFromDevice,
    additionsFromCommunity: state.additionsFromCommunity,
    unchanged: state.unchanged,
    conflicts: state.conflicts.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function resolveInitialLibraryMerge(
  device: LibrarySnapshotV2,
  community: LibrarySnapshotV2,
  resolutions: Record<string, InitialMergeSource>,
): LibrarySnapshotV2 {
  const state = createMergeState(device, community, resolutions);
  const unresolved = state.conflicts.filter((conflict) => !resolutions[conflict.id]);
  if (unresolved.length) {
    throw new Error(`Initial merge has ${unresolved.length} unresolved conflict${unresolved.length === 1 ? "" : "s"}`);
  }
  return {
    protocolVersion: 2,
    sourceStorageSchemaVersion: Math.max(device.sourceStorageSchemaVersion, community.sourceStorageSchemaVersion),
    libraryId: community.libraryId,
    headCursor: community.headCursor,
    generatedAt: new Date().toISOString(),
    taxonomy: state.taxonomy,
    colors: state.colors,
    collections: state.collections,
    annotations: state.annotations,
    appState: state.appState,
  };
}

interface MergeState {
  conflicts: InitialMergeConflictV1[];
  additionsFromDevice: number;
  additionsFromCommunity: number;
  unchanged: number;
  taxonomy: TaxonomyNodeSnapshotV1[];
  colors: CustomColorSnapshotV1[];
  collections: CollectionSnapshotV1[];
  annotations: AnnotationSnapshotV1[];
  appState: DurableAppStateDocumentV2[];
}

function createMergeState(
  device: LibrarySnapshotV2,
  community: LibrarySnapshotV2,
  resolutions: Record<string, InitialMergeSource>,
): MergeState {
  const state: MergeState = {
    conflicts: [], additionsFromDevice: 0, additionsFromCommunity: 0, unchanged: 0,
    taxonomy: [], colors: [], collections: [], annotations: [], appState: [],
  };
  state.taxonomy = mergeWholeRecords(
    "taxonomy",
    canonicalTaxonomy(device.taxonomy),
    canonicalTaxonomy(community.taxonomy),
    (item) => item.id,
    taxonomyValue,
    state,
    resolutions,
  );
  state.colors = mergeWholeRecords("color", device.colors, community.colors, (item) => item.id, colorValue, state, resolutions);
  state.collections = mergeWholeRecords("collection", device.collections, community.collections, (item) => item.id, collectionValue, state, resolutions);
  state.annotations = mergeAnnotations(device.annotations, community.annotations, state, resolutions);
  state.appState = mergeAppState(device.appState, community.appState, state, resolutions);
  return state;
}

function mergeWholeRecords<T>(
  kind: "taxonomy" | "color" | "collection",
  deviceItems: T[],
  communityItems: T[],
  keyOf: (item: T) => string,
  comparable: (item: T) => unknown,
  state: MergeState,
  resolutions: Record<string, InitialMergeSource>,
): T[] {
  const deviceMap = new Map(deviceItems.map((item) => [keyOf(item), item]));
  const communityMap = new Map(communityItems.map((item) => [keyOf(item), item]));
  const keys = [...new Set([...communityMap.keys(), ...deviceMap.keys()])].sort();
  return keys.map((key) => {
    const local = deviceMap.get(key);
    const cloud = communityMap.get(key);
    if (!cloud) { state.additionsFromDevice += 1; return clone(local!); }
    if (!local) { state.additionsFromCommunity += 1; return clone(cloud); }
    if (equal(comparable(local), comparable(cloud))) { state.unchanged += 1; return clone(cloud); }
    const id = `${kind}:${key}`;
    state.conflicts.push({ id, kind, subjectId: key, field: null, deviceValue: comparable(local), communityValue: comparable(cloud) });
    return clone(resolutions[id] === "device" ? local : cloud);
  });
}

function mergeAnnotations(
  deviceItems: AnnotationSnapshotV1[],
  communityItems: AnnotationSnapshotV1[],
  state: MergeState,
  resolutions: Record<string, InitialMergeSource>,
): AnnotationSnapshotV1[] {
  const keyOf = (item: AnnotationSnapshotV1) => `${item.entity.provider}:${item.entity.kind}:${item.entity.providerId}`;
  const deviceMap = new Map(deviceItems.map((item) => [keyOf(item), item]));
  const communityMap = new Map(communityItems.map((item) => [keyOf(item), item]));
  const keys = [...new Set([...communityMap.keys(), ...deviceMap.keys()])].sort();
  return keys.map((key) => {
    const local = deviceMap.get(key);
    const cloud = communityMap.get(key);
    if (!cloud) { state.additionsFromDevice += 1; return clone(local!); }
    if (!local) { state.additionsFromCommunity += 1; return clone(cloud); }
    const merged = clone(cloud);
    // Keep the earliest first-saved and latest last-changed time from either copy.
    const createdAt = earlierDate(local.createdAt, cloud.createdAt);
    const modifiedAt = laterDate(local.modifiedAt, cloud.modifiedAt);
    if (createdAt) merged.createdAt = createdAt;
    if (modifiedAt) merged.modifiedAt = modifiedAt;
    let changed = false;
    if (local.deleted !== cloud.deleted) {
      const id = `annotation:${key}:deleted`;
      state.conflicts.push({ id, kind: "annotation-state", subjectId: key, field: "saved state", deviceValue: local.deleted, communityValue: cloud.deleted });
      merged.deleted = resolutions[id] === "device" ? local.deleted : cloud.deleted;
      changed = true;
    }
    for (const field of ["rating", "energy", "bpm", "key"] as const) {
      const localField = local.fields[field];
      const cloudField = cloud.fields[field];
      if (equal(localField.value, cloudField.value)) continue;
      changed = true;
      if (localField.value === null) continue;
      if (cloudField.value === null) { Object.assign(merged.fields, { [field]: clone(localField) }); continue; }
      const id = `annotation:${key}:field:${field}`;
      state.conflicts.push({ id, kind: "annotation-field", subjectId: key, field, deviceValue: localField.value, communityValue: cloudField.value });
      if (resolutions[id] === "device") Object.assign(merged.fields, { [field]: clone(localField) });
    }
    const tagIds = [...new Set([...Object.keys(cloud.tagMemberships), ...Object.keys(local.tagMemberships)])].sort();
    merged.tagMemberships = {};
    for (const tagId of tagIds) {
      const localMembership = local.tagMemberships[tagId];
      const cloudMembership = cloud.tagMemberships[tagId];
      if (!cloudMembership) { merged.tagMemberships[tagId] = clone(localMembership); changed = true; continue; }
      if (!localMembership) { merged.tagMemberships[tagId] = clone(cloudMembership); continue; }
      if (localMembership.value === cloudMembership.value) { merged.tagMemberships[tagId] = clone(cloudMembership); continue; }
      changed = true;
      const id = `annotation:${key}:tag:${tagId}`;
      state.conflicts.push({ id, kind: "tag-membership", subjectId: key, field: tagId, deviceValue: localMembership.value, communityValue: cloudMembership.value });
      merged.tagMemberships[tagId] = clone(resolutions[id] === "device" ? localMembership : cloudMembership);
    }
    if (!changed) state.unchanged += 1;
    return merged;
  });
}

function mergeAppState(
  deviceItems: DurableAppStateDocumentV2[],
  communityItems: DurableAppStateDocumentV2[],
  state: MergeState,
  resolutions: Record<string, InitialMergeSource>,
): DurableAppStateDocumentV2[] {
  const deviceMap = new Map(deviceItems.map((item) => [item.domain, item]));
  const communityMap = new Map(communityItems.map((item) => [item.domain, item]));
  const domains = [...new Set([...communityMap.keys(), ...deviceMap.keys()])].sort();
  return domains.map((domain) => {
    const local = deviceMap.get(domain);
    const cloud = communityMap.get(domain);
    if (!cloud) { state.additionsFromDevice += countDocumentEntries(local!); return clone(local!); }
    if (!local) { state.additionsFromCommunity += countDocumentEntries(cloud); return clone(cloud); }
    const value = domain === "smart-playlists"
      ? mergeSmartPlaylists(local.value, cloud.value, state, resolutions)
      : mergeRecordState(domain, local.value, cloud.value, state, resolutions);
    if (equal(value, cloud.value)) state.unchanged += countDocumentEntries(cloud);
    return {
      domain,
      value,
      revision: Math.max(local.revision, cloud.revision),
      updatedAt: newerDate(local.updatedAt, cloud.updatedAt),
    };
  });
}

function mergeSmartPlaylists(
  deviceValue: unknown,
  communityValue: unknown,
  state: MergeState,
  resolutions: Record<string, InitialMergeSource>,
): unknown[] {
  const local = Array.isArray(deviceValue) ? deviceValue.filter(isRecord) : [];
  const cloud = Array.isArray(communityValue) ? communityValue.filter(isRecord) : [];
  const keyOf = (item: Record<string, unknown>, index: number) => String(item.id || item.playlistId || `position-${index}`);
  const localMap = new Map(local.map((item, index) => [keyOf(item, index), item]));
  const cloudMap = new Map(cloud.map((item, index) => [keyOf(item, index), item]));
  const keys = [...new Set([...cloudMap.keys(), ...localMap.keys()])];
  return keys.map((key) => {
    const devicePlaylist = localMap.get(key);
    const communityPlaylist = cloudMap.get(key);
    if (!communityPlaylist) { state.additionsFromDevice += 1; return clone(devicePlaylist!); }
    if (!devicePlaylist) { state.additionsFromCommunity += 1; return clone(communityPlaylist); }
    if (equal(devicePlaylist, communityPlaylist)) return clone(communityPlaylist);
    const id = `app-state:smart-playlists:${key}`;
    state.conflicts.push({ id, kind: "smart-playlist", subjectId: key, field: null, deviceValue: devicePlaylist, communityValue: communityPlaylist });
    return clone(resolutions[id] === "device" ? devicePlaylist : communityPlaylist);
  });
}

function mergeRecordState(
  domain: string,
  deviceValue: unknown,
  communityValue: unknown,
  state: MergeState,
  resolutions: Record<string, InitialMergeSource>,
): unknown {
  if (!isRecord(deviceValue) || !isRecord(communityValue)) {
    if (equal(deviceValue, communityValue)) return clone(communityValue);
    if (isEmpty(deviceValue)) { state.additionsFromCommunity += 1; return clone(communityValue); }
    if (isEmpty(communityValue)) { state.additionsFromDevice += 1; return clone(deviceValue); }
    const id = `app-state:${domain}:value`;
    state.conflicts.push({ id, kind: "saved-setting", subjectId: domain, field: null, deviceValue, communityValue });
    return clone(resolutions[id] === "device" ? deviceValue : communityValue);
  }
  const result: Record<string, unknown> = {};
  const keys = [...new Set([...Object.keys(communityValue), ...Object.keys(deviceValue)])].sort();
  for (const key of keys) {
    const deviceEntry = deviceValue[key];
    const communityEntry = communityValue[key];
    if (!(key in communityValue)) { result[key] = clone(deviceEntry); state.additionsFromDevice += 1; continue; }
    if (!(key in deviceValue)) { result[key] = clone(communityEntry); state.additionsFromCommunity += 1; continue; }
    if (equal(deviceEntry, communityEntry)) { result[key] = clone(communityEntry); continue; }
    if (isEmpty(deviceEntry)) { result[key] = clone(communityEntry); continue; }
    if (isEmpty(communityEntry)) { result[key] = clone(deviceEntry); continue; }
    const id = `app-state:${domain}:${key}`;
    state.conflicts.push({ id, kind: "saved-setting", subjectId: domain, field: key, deviceValue: deviceEntry, communityValue: communityEntry });
    result[key] = clone(resolutions[id] === "device" ? deviceEntry : communityEntry);
  }
  return result;
}

function snapshotCounts(snapshot: LibrarySnapshotV2): InitialMergeCountsV1 {
  const smartPlaylists = snapshot.appState.find((document) => document.domain === "smart-playlists")?.value;
  return {
    annotations: snapshot.annotations.filter((item) => !item.deleted).length,
    taxonomy: snapshot.taxonomy.filter((item) => !item.deleted).length,
    smartPlaylists: Array.isArray(smartPlaylists) ? smartPlaylists.length : 0,
    savedSettings: snapshot.appState.filter((document) => document.domain !== "smart-playlists").reduce((total, document) => total + countDocumentEntries(document), 0),
  };
}

function canonicalTaxonomy(items: TaxonomyNodeSnapshotV1[]): TaxonomyNodeSnapshotV1[] {
  return items.map((item) => item.kind === "subcategory" ? { ...item, kind: "folder" } : item);
}

function countDocumentEntries(document: DurableAppStateDocumentV2): number {
  if (Array.isArray(document.value)) return document.value.length;
  if (isRecord(document.value)) return Object.keys(document.value).length;
  return isEmpty(document.value) ? 0 : 1;
}

function taxonomyValue(item: TaxonomyNodeSnapshotV1) { return { kind: item.kind, parentId: item.parentId, name: item.name, accentId: item.accentId, position: item.position, deleted: item.deleted }; }
function colorValue(item: CustomColorSnapshotV1) { return { name: item.name, color: item.color, deleted: item.deleted }; }
function collectionValue(item: CollectionSnapshotV1) { return { name: item.name, colorIds: item.colorIds, position: item.position, deleted: item.deleted }; }
function newerDate(left: string, right: string) { return Date.parse(left) > Date.parse(right) ? left : right; }
function earlierDate(left?: string, right?: string) { return !left ? right : !right ? left : Date.parse(left) <= Date.parse(right) ? left : right; }
function laterDate(left?: string, right?: string) { return !left ? right : !right ? left : Date.parse(left) >= Date.parse(right) ? left : right; }
function isEmpty(value: unknown) { return value === null || value === undefined || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function clone<T>(value: T): T { return structuredClone(value); }
function equal(left: unknown, right: unknown): boolean { return stableJson(left) === stableJson(right); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
