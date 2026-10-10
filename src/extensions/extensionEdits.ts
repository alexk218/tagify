/**
 * Saves ratings, energy, and tags changed outside the Tagify page (keyboard
 * shortcuts and the controls added to Spotify's own views).
 *
 * Every change is applied to the current saved record inside one storage
 * transaction. Nothing here writes a whole record rebuilt from an earlier
 * copy, so tags saved by the Tagify page, sync, or background lookups in the
 * meantime are always kept.
 */
import type { ArtistData, PlaylistData, TagDataStructure, TrackData } from "@/types/tagData";
import { isTrackEmpty } from "@/features/tag-data/utils/tagData.helpers";
import { dispatchTagDataUpdatedEvent, type TagDataUpdatedEventType } from "@/features/tag-data/utils/tagData.events";
import { isLibraryChoicePending } from "@/services/storage/libraryChoice";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";

export const LIBRARY_UNAVAILABLE_MESSAGE =
  "Tagify couldn't read your library just now, so that change wasn't saved. Try again in a moment.";
export const EDIT_NOT_SAVED_MESSAGE = "Tagify couldn't save that change. Try again in a moment.";

const STAR_RATINGS = new Set([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
const ENERGY_LEVELS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

export const LIBRARY_CHOICE_PENDING_MESSAGE =
  "Choose how to open your library in Tagify first, then try that again.";

export class LibraryUnavailableError extends Error {
  constructor(message = LIBRARY_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "LibraryUnavailableError";
  }
}

/** The plain-language notification for an edit that could not be saved. */
export function getEditErrorMessage(error: unknown): string {
  return error instanceof LibraryUnavailableError ? error.message : EDIT_NOT_SAVED_MESSAGE;
}

/** Edits wait while Tagify asks how to open an empty library. */
export function assertEditsAllowed(): void {
  if (isLibraryChoicePending()) throw new LibraryUnavailableError(LIBRARY_CHOICE_PENDING_MESSAGE);
}

async function ensureLibraryReady(): Promise<void> {
  let ready = false;
  try {
    // init() reopens the saved library if its connection was closed.
    ready = (await storageService.initialize()).status === "ready" && (await indexedDBStorage.init());
  } catch (error) {
    console.error("Tagify: Could not open the saved library", error);
  }
  if (!ready) throw new LibraryUnavailableError();
}

/** Reads the saved library. A failed read throws; it never looks like an empty library. */
export async function readSavedLibrary(): Promise<TagDataStructure> {
  await ensureLibraryReady();
  try {
    return await indexedDBStorage.loadAllStrict();
  } catch (error) {
    console.error("Tagify: Could not read the saved library", error);
    throw new LibraryUnavailableError();
  }
}

/** One change requested by the user. Only the named fields and tags change. */
export interface AnnotationEdit {
  /** Sets the star rating; 0 clears it. */
  rating?: number;
  /** Sets the energy level; 0 clears it. */
  energy?: number;
  /** Sets this star rating, or clears it when the saved rating already has this value. */
  toggleRating?: number;
  /** Sets this energy level, or clears it when the saved energy already has this value. */
  toggleEnergy?: number;
  addTagIds?: readonly string[];
  removeTagIds?: readonly string[];
}

type AnnotatedRecord = TrackData | PlaylistData | ArtistData;

function applyAnnotationEdit<T extends AnnotatedRecord>(current: T, edit: AnnotationEdit): T {
  const next = { ...current, tagIds: Array.isArray(current.tagIds) ? [...current.tagIds] : [] };
  const rating = edit.toggleRating !== undefined
    ? ((Number(current.rating) || 0) === edit.toggleRating ? 0 : edit.toggleRating)
    : edit.rating;
  const energy = edit.toggleEnergy !== undefined
    ? ((Number(current.energy) || 0) === edit.toggleEnergy ? 0 : edit.toggleEnergy)
    : edit.energy;
  if (rating !== undefined && STAR_RATINGS.has(rating)) next.rating = rating;
  if (energy !== undefined && ENERGY_LEVELS.has(energy)) next.energy = energy;
  if (edit.removeTagIds?.length) next.tagIds = next.tagIds.filter((tagId) => !edit.removeTagIds!.includes(tagId));
  for (const tagId of edit.addTagIds ?? []) if (!next.tagIds.includes(tagId)) next.tagIds.push(tagId);
  return next;
}

function sameAnnotations(left: AnnotatedRecord, right: AnnotatedRecord): boolean {
  return (Number(left.rating) || 0) === (Number(right.rating) || 0)
    && (Number(left.energy) || 0) === (Number(right.energy) || 0)
    && JSON.stringify(left.tagIds ?? []) === JSON.stringify(right.tagIds ?? []);
}

/**
 * Applies one edit to a saved song. Returns the changed record, null to
 * remove a song left without ratings or tags, or undefined when nothing
 * changes. `details` describe a song that isn't saved yet.
 */
export function editSavedTrack(
  current: TrackData | null,
  edit: AnnotationEdit,
  now: number,
  details: Partial<TrackData> = {},
): TrackData | null | undefined {
  const base: TrackData = current ?? { bpm: null, camelotKey: null, ...details, rating: 0, energy: 0, tagIds: [] };
  const next = applyAnnotationEdit(base, edit);
  if (sameAnnotations(base, next)) return undefined;
  if (isTrackEmpty(next)) return current ? null : undefined;
  return { ...next, dateCreated: current?.dateCreated ?? now, dateModified: now };
}

/** Applies one edit to a saved playlist, album, or artist, like editSavedTrack. */
export function editSavedEntity<T extends PlaylistData | ArtistData>(
  current: T | null,
  edit: AnnotationEdit,
  now: number,
  details: Partial<T> = {},
): T | null | undefined {
  const base = current ?? ({ ...details, rating: 0, energy: 0, tagIds: [] } as unknown as T);
  const next = applyAnnotationEdit(base, edit);
  if (sameAnnotations(base, next)) return undefined;
  if (next.rating === 0 && next.energy === 0 && next.tagIds.length === 0) return current ? null : undefined;
  return { ...next, dateCreated: current?.dateCreated ?? now, dateModified: now };
}

/** Saves edits made on this page before applying a change made elsewhere. */
async function flushPageEdits(): Promise<void> {
  try {
    await flushLocalPersistence();
  } catch (error) {
    console.error("Tagify: Could not save edits waiting on the Tagify page", error);
    throw new Error(EDIT_NOT_SAVED_MESSAGE);
  }
}

/**
 * Applies one edit to each song's current saved record and resolves with the
 * saved results, including linked releases that changed with them.
 * `details` is asked only for songs that aren't saved yet.
 */
export async function saveTrackEdits(
  trackUris: readonly string[],
  edit: AnnotationEdit,
  options: { details?: (trackUri: string) => Partial<TrackData>; undoable?: boolean } = {},
): Promise<Record<string, TrackData | null>> {
  const uris = [...new Set(trackUris)].filter(Boolean);
  if (!uris.length) return {};
  assertEditsAllowed();
  const expectedDatabaseName = getTagifyDatabaseName();
  await ensureLibraryReady();
  await flushPageEdits();
  const now = Date.now();
  return indexedDBStorage.patchTracks(
    Object.fromEntries(uris.map((uri) => [uri, (current: TrackData | null) =>
      editSavedTrack(current, edit, now, current ? undefined : options.details?.(uri))])),
    { expectedDatabaseName, undoable: options.undoable },
  );
}

/** Applies one edit to a playlist, album, or artist's current saved record. */
export async function saveEntityEdit<T extends PlaylistData | ArtistData>(
  kind: "playlist" | "artist",
  uri: string,
  edit: AnnotationEdit,
  details: Partial<T> = {},
): Promise<Record<string, T | null>> {
  assertEditsAllowed();
  const expectedDatabaseName = getTagifyDatabaseName();
  await ensureLibraryReady();
  await flushPageEdits();
  const now = Date.now();
  return indexedDBStorage.patchEntities<T>(
    kind,
    { [uri]: (current) => editSavedEntity(current, edit, now, details) },
    { expectedDatabaseName },
  );
}

/**
 * Tells the Tagify page, Smart Playlists, and Spotify's views about saved
 * songs. Each song event carries the saved record, never a guess, so views
 * in this bundle show it without reading the whole library again.
 */
export function announceSavedTracks(saved: Record<string, TrackData | null>, type: TagDataUpdatedEventType = "save"): void {
  const entries = Object.entries(saved);
  if (!entries.length) return;
  dispatchTagDataUpdatedEvent(type, { recordsAnnounced: true });
  for (const [trackUri, trackData] of entries) {
    window.dispatchEvent(new CustomEvent("tagify:trackChanged", { detail: { trackUri, trackData, timestamp: Date.now() } }));
  }
}
