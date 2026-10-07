import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { normalizeSmartPlaylistCriteriaList } from "@/features/tag-data";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";

export const SMART_PLAYLIST_STORAGE_KEY = "tagify:smartPlaylists";
export const SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY =
  "tagify:smartPlaylistMembershipBaselines:v1";
const EXPLICIT_CLEAR_PREFIX = "tagify:smartPlaylists:explicit-clear:";
let pendingSmartPlaylistWrite: Promise<void> = Promise.resolve();

function explicitClearKey(): string | null {
  const activeAccount = localStorage.getItem("tagify:sync:account-id");
  if (activeAccount) return `${EXPLICIT_CLEAR_PREFIX}${activeAccount}`;
  try {
    const previous = JSON.parse(localStorage.getItem("tagify:sync:disconnected-provenance") || "null");
    return typeof previous?.accountId === "string"
      ? `${EXPLICIT_CLEAR_PREFIX}${previous.accountId}`
      : null;
  } catch {
    return null;
  }
}

export function markSmartPlaylistsExplicitlyCleared(): void {
  const key = explicitClearKey();
  if (key) localStorage.setItem(key, new Date().toISOString());
}

export function wereSmartPlaylistsExplicitlyCleared(): boolean {
  const key = explicitClearKey();
  return Boolean(key && localStorage.getItem(key));
}

export function clearExplicitSmartPlaylistClear(): void {
  const key = explicitClearKey();
  if (key) localStorage.removeItem(key);
}

function enqueueSmartPlaylistWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingSmartPlaylistWrite.then(operation, operation);
  pendingSmartPlaylistWrite = result.then(() => undefined, () => undefined);
  return result;
}

function membershipBaselineId(
  playlist: Pick<SmartPlaylistCriteria, "playlistId" | "createdAt">,
): string {
  return `${playlist.playlistId}:${playlist.createdAt}`;
}

function loadMembershipBaselines(): Set<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function hasConfirmedMembershipBaseline(
  playlist: Pick<SmartPlaylistCriteria, "playlistId" | "createdAt">,
): boolean {
  return loadMembershipBaselines().has(membershipBaselineId(playlist));
}

export function markConfirmedMembershipBaselines(
  playlists: SmartPlaylistCriteria[],
  confirmedPlaylistIds: Set<string>,
): void {
  const existing = loadMembershipBaselines();
  const currentBaselineIds = new Set(playlists.map(membershipBaselineId));
  const next = new Set(
    [...existing].filter((baselineId) => currentBaselineIds.has(baselineId)),
  );

  playlists.forEach((playlist) => {
    if (confirmedPlaylistIds.has(playlist.playlistId)) {
      next.add(membershipBaselineId(playlist));
    }
  });
  const serialized = JSON.stringify([...next]);
  if (localStorage.getItem(SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY) !== serialized) {
    localStorage.setItem(SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY, serialized);
  }
}

export function clearConfirmedMembershipBaselines(): void {
  localStorage.removeItem(SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY);
}

function loadLegacySmartPlaylists(): SmartPlaylistCriteria[] {
  try {
    const raw = localStorage.getItem(SMART_PLAYLIST_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeSmartPlaylistCriteriaList(parsed);
  } catch {
    return [];
  }
}

async function loadSmartPlaylistsUnqueued(): Promise<SmartPlaylistCriteria[]> {
  const stored = await indexedDBStorage.getAllSmartPlaylists();
  if (stored.length > 0) {
    return stored;
  }

  const legacy = loadLegacySmartPlaylists();
  if (legacy.length === 0) {
    return [];
  }

  if (!(await indexedDBStorage.saveSmartPlaylists(legacy))) {
    throw new Error("Failed to migrate smart playlists to unified storage");
  }
  localStorage.removeItem(SMART_PLAYLIST_STORAGE_KEY);
  return legacy;
}

export async function loadSmartPlaylistsFromStorage(): Promise<SmartPlaylistCriteria[]> {
  await pendingSmartPlaylistWrite;
  return loadSmartPlaylistsUnqueued();
}

async function saveSmartPlaylistsUnqueued(
  playlists: SmartPlaylistCriteria[],
): Promise<void> {
  if (!(await indexedDBStorage.saveSmartPlaylists(playlists))) {
    throw new Error("Failed to save smart playlists");
  }
  localStorage.removeItem(SMART_PLAYLIST_STORAGE_KEY);
  if (playlists.length > 0) clearExplicitSmartPlaylistClear();
}

export function saveSmartPlaylistsToStorage(
  playlists: SmartPlaylistCriteria[],
): Promise<void> {
  return enqueueSmartPlaylistWrite(() => saveSmartPlaylistsUnqueued(playlists));
}

export function updateSmartPlaylistsInStorage(
  updater: (current: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[],
): Promise<SmartPlaylistCriteria[]> {
  return enqueueSmartPlaylistWrite(async () => {
    const current = await loadSmartPlaylistsUnqueued();
    const updated = updater(current);
    if (updated !== current) await saveSmartPlaylistsUnqueued(updated);
    return updated;
  });
}
