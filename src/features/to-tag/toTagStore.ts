import { useSyncExternalStore } from "react";
import { MAX_APP_STATE_DOCUMENT_BYTES } from "@tagify/sync-contracts";
import { durableStateStoredByteLength, readLocalDurableAppState } from "@/services/sync/DurableAppState";

/**
 * The To Tag list: songs someone wants to come back to. It is kept apart
 * from the library, so adding a song never creates a track record or changes
 * a song's dates, counts, Stats or what is published to Community. It syncs
 * inside the saved-settings (preferences) document and goes into backups.
 */
export const TO_TAG_KEY = "tagify:toTagList";
const EVENT = "tagify:toTagChanged";
const MAX_TEXT = 200;

export interface ToTagEntry {
  uri: string;
  /** Snapshot shown while the song has no Tagify data; may be filled later. */
  name: string;
  artists: string;
  album: string;
  /** Album cover (https only), shown in the To Tag list until the song has Tagify data. */
  image: string;
  addedAt: number;
}

export type ToTagSongDetails = Partial<Pick<ToTagEntry, "name" | "artists" | "album" | "image">>;

const isSongUri = (uri: unknown): uri is string =>
  typeof uri === "string" && /^spotify:(track|local):/.test(uri) && uri.length <= 1000;
const text = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "");
const imageUrl = (value: unknown) =>
  typeof value === "string" && value.startsWith("https://") && value.length <= 500 ? value : "";

export function normalizeToTagList(value: unknown): ToTagEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (!isSongUri(entry.uri) || seen.has(entry.uri)) return [];
    seen.add(entry.uri);
    const addedAt = typeof entry.addedAt === "number" && Number.isFinite(entry.addedAt) ? entry.addedAt : 0;
    return [{ uri: entry.uri, name: text(entry.name), artists: text(entry.artists), album: text(entry.album), image: imageUrl(entry.image), addedAt }];
  });
}

let cachedRaw: string | null | undefined;
let cached: ToTagEntry[] = [];

export function readToTagList(): ToTagEntry[] {
  let raw: string | null;
  try { raw = localStorage.getItem(TO_TAG_KEY); } catch { return cached; }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try { cached = normalizeToTagList(raw ? JSON.parse(raw) : []); } catch { cached = []; }
  }
  return cached;
}

export class ToTagFullError extends Error {
  constructor() {
    super("Your To Tag list is full. Tick off some songs you’ve finished, then try again.");
  }
}

function writeToTagList(list: ToTagEntry[]): void {
  const normalized = normalizeToTagList(list);
  const preferences = { ...(readLocalDurableAppState().preferences as Record<string, unknown>), [TO_TAG_KEY]: normalized };
  if (durableStateStoredByteLength(normalized) > MAX_APP_STATE_DOCUMENT_BYTES / 4 || durableStateStoredByteLength(preferences) > MAX_APP_STATE_DOCUMENT_BYTES) {
    throw new ToTagFullError();
  }
  try {
    if (normalized.length) localStorage.setItem(TO_TAG_KEY, JSON.stringify(normalized));
    else localStorage.removeItem(TO_TAG_KEY);
  } catch {
    throw new Error("Your To Tag list couldn’t be saved on this device. Please try again.");
  }
  window.dispatchEvent(new Event(EVENT));
  window.dispatchEvent(new Event("tagify:settingsChanged"));
  window.dispatchEvent(new Event("tagify:syncOutboxChanged"));
}

/** Adds songs that aren't on the list yet. Returns how many were added. */
export function addToTag(songs: Array<{ uri: string } & ToTagSongDetails>, now = Date.now()): number {
  const list = readToTagList();
  const present = new Set(list.map((entry) => entry.uri));
  const added = normalizeToTagList(
    songs.filter((song) => !present.has(song.uri)).map((song) => ({ ...song, addedAt: now })),
  );
  if (added.length) writeToTagList([...list, ...added]);
  return added.length;
}

/** Ticks songs off the list (Done). Returns how many were removed. */
export function removeFromToTag(uris: string[]): number {
  const remove = new Set(uris);
  const list = readToTagList();
  const next = list.filter((entry) => !remove.has(entry.uri));
  if (next.length !== list.length) writeToTagList(next);
  return list.length - next.length;
}

/** Fills in missing names and covers without moving songs or changing when they were added. */
export function fillToTagDetails(details: Record<string, ToTagSongDetails>): void {
  let changed = false;
  const next = readToTagList().map((entry) => {
    const found = details[entry.uri];
    if (!found) return entry;
    const filled = {
      ...entry,
      name: entry.name || text(found.name),
      artists: entry.artists || text(found.artists),
      album: entry.album || text(found.album),
      image: entry.image || imageUrl(found.image),
    };
    changed ||= filled.name !== entry.name || filled.artists !== entry.artists || filled.album !== entry.album || filled.image !== entry.image;
    return filled;
  });
  if (changed) writeToTagList(next);
}

export function subscribeToTag(listener: () => void): () => void {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === TO_TAG_KEY) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener("tagify:durableStateRestored", listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("tagify:durableStateRestored", listener);
    window.removeEventListener("storage", storage);
  };
}

export function useToTagList(): ToTagEntry[] {
  return useSyncExternalStore(subscribeToTag, readToTagList, readToTagList);
}
