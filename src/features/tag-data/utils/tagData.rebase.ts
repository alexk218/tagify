import type { ArtistData, PlaylistData, TagDataStructure, TrackData } from "@/types/tagData";
import { mergeTaxonomy, sameTaxonomy } from "./tagData.taxonomyMerge";

type LibraryRecord = TrackData | PlaylistData | ArtistData;
type RecordKey = "tracks" | "playlists" | "artists";

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Applies the tags one edit added and removed to another copy of the same
 * list, so two edits made at the same time both keep their tags.
 */
export function mergeTagIds(
  before: readonly string[] | undefined,
  edited: readonly string[] | undefined,
  current: readonly string[] | undefined,
): string[] {
  const previous = before ?? [], next = edited ?? [], latest = current ?? [];
  if (sameValue(previous, latest)) return [...next];
  const removed = new Set(previous.filter((tagId) => !next.includes(tagId)));
  const kept = latest.filter((tagId) => !removed.has(tagId));
  return [...kept, ...next.filter((tagId) => !previous.includes(tagId) && !kept.includes(tagId))];
}

export interface RebaseRecordOptions {
  /** Background fills set this so they never replace a value changed meanwhile. */
  keepConcurrentChanges?: boolean;
}

/**
 * Applies one edit (before → edited) to the current copy of a record. Only
 * changed fields are copied; tag lists merge additions and removals.
 * Returns null when the edit deleted the record.
 */
export function rebaseRecord<T extends LibraryRecord>(
  before: T | undefined,
  edited: T | null | undefined,
  current: T | undefined,
  { keepConcurrentChanges = false }: RebaseRecordOptions = {},
): T | null {
  if (!edited) return null;
  if (!current || current === before) return edited;
  const merged = { ...current } as T;
  const base = (before ?? {}) as Partial<T>;
  for (const key of new Set([...Object.keys(base), ...Object.keys(edited)]) as Set<keyof T>) {
    if (sameValue(base[key], edited[key])) continue;
    if (keepConcurrentChanges && key !== "tagIds" && !sameValue(base[key], current[key])) continue;
    merged[key] = (key === "tagIds"
      ? mergeTagIds(base[key] as string[] | undefined, edited[key] as string[] | undefined, current[key] as string[] | undefined)
      : edited[key]) as T[keyof T];
  }
  return merged;
}

function rebaseRecords<T extends LibraryRecord>(
  base: Record<string, T> = {},
  local: Record<string, T> = {},
  incoming: Record<string, T> = {},
): Record<string, T> {
  if (local === base) return incoming;
  if (incoming === base) return local;
  let result = incoming;
  for (const uri of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (local[uri] === base[uri]) continue;
    const rebased = rebaseRecord(base[uri], local[uri], incoming[uri]);
    if (rebased === incoming[uri] || (rebased === null && !(uri in incoming))) continue;
    if (result === incoming) result = { ...incoming };
    if (rebased === null) delete result[uri];
    else result[uri] = rebased;
  }
  return result;
}

/**
 * Re-applies the edits made on this device since `base` was saved (`local`)
 * to a newer saved copy of the library (`incoming`). Showing changes saved
 * elsewhere must never undo edits that are not saved yet.
 */
export function rebaseTagData(
  base: TagDataStructure,
  local: TagDataStructure,
  incoming: TagDataStructure,
): TagDataStructure {
  if (local === base) return incoming;
  if (incoming === base) return local;
  const records = Object.fromEntries((["tracks", "playlists", "artists"] as RecordKey[]).map((key) => [
    key, rebaseRecords<LibraryRecord>(base[key], local[key], incoming[key]),
  ])) as Pick<TagDataStructure, RecordKey>;
  const taxonomy = local.taxonomy === base.taxonomy ? incoming.taxonomy : mergeTaxonomy(base.taxonomy, local.taxonomy, incoming.taxonomy);
  if (taxonomy === incoming.taxonomy && (["tracks", "playlists", "artists"] as RecordKey[]).every((key) => records[key] === incoming[key])) {
    return incoming;
  }
  return { ...incoming, ...records, taxonomy };
}

/**
 * Returns `incoming` reusing the objects of `reference` wherever their
 * contents are the same, so showing a reloaded library only re-renders and
 * rewrites what actually changed.
 */
export function reuseUnchanged(reference: TagDataStructure, incoming: TagDataStructure): TagDataStructure {
  const records = Object.fromEntries((["tracks", "playlists", "artists"] as RecordKey[]).map((key) => {
    const before = reference[key] ?? {}, after = incoming[key] ?? {};
    let changed = Object.keys(before).length !== Object.keys(after).length;
    const shared: Record<string, LibraryRecord> = {};
    for (const [uri, record] of Object.entries(after)) {
      const previous = before[uri];
      shared[uri] = previous && sameValue(previous, record) ? previous : record;
      if (shared[uri] !== previous) changed = true;
    }
    return [key, changed ? shared : before];
  })) as Pick<TagDataStructure, RecordKey>;
  return {
    ...incoming,
    ...records,
    taxonomy: sameTaxonomy(reference.taxonomy, incoming.taxonomy) ? reference.taxonomy : incoming.taxonomy,
  };
}
