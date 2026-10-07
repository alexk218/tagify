import type { TrackData } from "@/types/tagData";

/**
 * Local files cannot join the Spotify-ID sync protocol, so Community keeps
 * them in a separate owner-only backup keyed by the spotify:local: URI. Each
 * entry carries updatedAt; the newer entry wins on both sides, and deletions
 * stay as entries so an older device cannot bring a removed file back.
 */
export interface LocalFileBackupEntry {
  updatedAt: number;
  deleted?: true;
  rating?: number;
  energy?: number;
  bpm?: number | null;
  camelotKey?: string | null;
  tagIds?: string[];
  dateCreated?: number;
  dateModified?: number;
  name?: string;
  artists?: string;
  albumName?: string;
}

export type LocalFileEntries = Record<string, LocalFileBackupEntry>;

export interface LocalFileBackupShadow {
  key: "local-file-backup";
  /** Community revision these entries match; -1 when it must be read again. */
  revision: number;
  entries: LocalFileEntries;
}

export const LOCAL_FILE_BACKUP_SHADOW_KEY = "local-file-backup";

export function isLocalFileUri(uri: string): boolean {
  return uri.startsWith("spotify:local:");
}

export function localFileTracks(tracks: Record<string, TrackData>): Record<string, TrackData> {
  return Object.fromEntries(Object.entries(tracks).filter(([uri]) => isLocalFileUri(uri)));
}

function changedAt(track: Pick<TrackData, "dateModified" | "dateCreated">): number {
  return track.dateModified ?? track.dateCreated ?? 0;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function localFileEntry(track: TrackData): LocalFileBackupEntry {
  return withoutUndefined({
    updatedAt: changedAt(track),
    rating: track.rating,
    energy: track.energy,
    bpm: track.bpm ?? null,
    camelotKey: track.camelotKey ?? null,
    tagIds: [...new Set(track.tagIds)].sort(),
    dateCreated: track.dateCreated,
    dateModified: track.dateModified,
    name: track.name,
    artists: track.artists,
    albumName: track.albumName,
  });
}

export function localFileEntries(tracks: Record<string, TrackData>): LocalFileEntries {
  return Object.fromEntries(Object.entries(localFileTracks(tracks)).map(([uri, track]) => [uri, localFileEntry(track)]));
}

export function trackFromLocalFileEntry(entry: LocalFileBackupEntry, current?: TrackData): TrackData {
  return withoutUndefined({
    ...current,
    rating: entry.rating ?? 0,
    energy: entry.energy ?? 0,
    bpm: entry.bpm ?? null,
    camelotKey: entry.camelotKey ?? null,
    tagIds: entry.tagIds ?? [],
    dateCreated: entry.dateCreated ?? current?.dateCreated,
    dateModified: entry.dateModified ?? current?.dateModified,
    name: entry.name ?? current?.name,
    artists: entry.artists ?? current?.artists,
    albumName: entry.albumName ?? current?.albumName,
  });
}

/** Changes from Community that are newer than this device's copy. */
export function planIncomingLocalFiles(
  remote: LocalFileEntries,
  local: Record<string, TrackData>,
  known: LocalFileEntries,
): { save: Record<string, TrackData>; remove: string[] } {
  const save: Record<string, TrackData> = {};
  const remove: string[] = [];
  for (const [uri, entry] of Object.entries(remote)) {
    if (!isLocalFileUri(uri)) continue;
    const current = local[uri];
    const previous = known[uri];
    // Unchanged in Community since this device last synced.
    if (previous && sameEntry(previous, entry)) continue;
    if (entry.deleted) {
      if (current && changedAt(current) <= entry.updatedAt) remove.push(uri);
      continue;
    }
    if (!current) {
      // Removed here since the last sync; this device's deletion is newer.
      if (previous && !previous.deleted) continue;
      save[uri] = trackFromLocalFileEntry(entry);
      continue;
    }
    if (changedAt(current) < entry.updatedAt) save[uri] = trackFromLocalFileEntry(entry, current);
  }
  return { save, remove };
}

/** This device's changes and deletions since it last matched Community. */
export function planOutgoingLocalFiles(local: LocalFileEntries, known: LocalFileEntries, now: number): LocalFileEntries {
  const outgoing: LocalFileEntries = {};
  for (const [uri, entry] of Object.entries(local)) {
    if (!known[uri] || !sameEntry(known[uri], entry)) outgoing[uri] = entry;
  }
  for (const [uri, previous] of Object.entries(known)) {
    if (!local[uri] && !previous.deleted) outgoing[uri] = { updatedAt: Math.max(now, previous.updatedAt + 1), deleted: true };
  }
  return outgoing;
}

/** Splits entries into requests below the Community body limit. */
export function chunkLocalFileEntries(entries: LocalFileEntries, maximumBytes: number): LocalFileEntries[] {
  const chunks: LocalFileEntries[] = [];
  let current: LocalFileEntries = {};
  let currentBytes = 0;
  for (const [uri, entry] of Object.entries(entries)) {
    const bytes = new TextEncoder().encode(JSON.stringify({ [uri]: entry })).byteLength;
    if (currentBytes && currentBytes + bytes > maximumBytes) {
      chunks.push(current);
      current = {};
      currentBytes = 0;
    }
    current[uri] = entry;
    currentBytes += bytes;
  }
  if (currentBytes) chunks.push(current);
  return chunks;
}

function sameEntry(left: LocalFileBackupEntry, right: LocalFileBackupEntry): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
