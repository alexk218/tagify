import type { DurableAppStateDocumentV2, DurableAppStateDomain } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import {
  clearConfirmedMembershipBaselines,
  clearExplicitSmartPlaylistClear,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { normalizeSmartPlaylistCriteriaList } from "@/features/tag-data/utils/tagData.schema";
import { preserveSmartPlaylistMembership } from "@/features/smart-playlists/utils/smartPlaylist.membership";
import { updateSmartPlaylistsInStorage } from "@/features/smart-playlists/utils/smartPlaylist.storage";

const LEGACY_SMART_PLAYLIST_KEY = "tagify:smartPlaylists";
const FILTER_KEYS = ["tracks", "albums", "playlists", "artists"].map((scope) => `tagify:filterState:${scope}`);
const PLAYLIST_RULES_KEY = "tagify:playlistSettings";
const ACCOUNT_DRAFT_PREFIX = "tagify:sync:durable-local:";
const PREFERENCE_KEYS = [
  "tagify:extensionSettings",
  "tagify:keyboardShortcutSettings",
  "tagify:autoFileBackupFrequency",
  "tagify:trackListSortBy",
  "tagify:trackListSortOrder",
  "tagify:playlistListSortBy",
  "tagify:playlistListSortOrder",
  "tagify:albumListSortBy",
  "tagify:albumListSortOrder",
  "tagify:artistListSortBy",
  "tagify:artistListSortOrder",
  "tagify:tagSelectorSortMode",
  "tagify:colorThemeSortMode",
  "tagify:tagFilterEditorMode",
  "tagify:basicTagFilterOperator",
  "tagify:showDefaultColorPalette",
] as const;

/** Saved settings that live in localStorage. File backups carry them too. */
export type LocalDurableAppState = Pick<Record<DurableAppStateDomain, unknown>, "filter-formulas" | "playlist-rules" | "preferences">;

export function readLocalDurableAppState(): LocalDurableAppState {
  return {
    "filter-formulas": Object.fromEntries(FILTER_KEYS.map((key) => [key.split(":").at(-1), readJson(key, null)]).filter(([, value]) => value !== null)),
    "playlist-rules": readJson(PLAYLIST_RULES_KEY, null),
    preferences: Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, readStoredValue(key)]).filter(([, value]) => value !== null)),
  };
}

export async function restoreLocalDurableAppState(state: Partial<LocalDurableAppState>): Promise<void> {
  const updatedAt = new Date().toISOString();
  await applyDurableAppStateDocuments((["filter-formulas", "playlist-rules", "preferences"] as const)
    .filter((domain) => domain in state)
    .map((domain) => ({ domain, value: state[domain], revision: 0, updatedAt })));
}

export async function readDurableAppState(): Promise<Record<DurableAppStateDomain, unknown>> {
  const [publicationPolicy, ownerIdentityMapping, installations, smartPlaylists] = await Promise.all([
    indexedDBStorage.getCommunityPublicationPolicy(),
    indexedDBStorage.getCommunityOwnerIdentityMapping(),
    indexedDBStorage.getCommunityInstallations(),
    indexedDBStorage.getAllSmartPlaylists(),
  ]);
  return {
    "smart-playlists": sanitizeSmartPlaylists(smartPlaylists),
    ...readLocalDurableAppState(),
    "community-provenance": { ownerIdentityMapping, installations, publicationPolicyVersion: publicationPolicy?.policyVersion ?? null },
  };
}

export async function buildDurableAppStateDocuments(revisions: Partial<Record<DurableAppStateDomain, number>> = {}): Promise<DurableAppStateDocumentV2[]> {
  const state = await readDurableAppState();
  const updatedAt = new Date().toISOString();
  return (Object.entries(state) as Array<[DurableAppStateDomain, unknown]>).map(([domain, value]) => ({
    domain, value, revision: revisions[domain] || 0, updatedAt,
  }));
}

export async function applyDurableAppStateDocuments(
  documents: DurableAppStateDocumentV2[],
  options: { smartPlaylistsAlreadyPersisted?: boolean } = {},
): Promise<void> {
  const byDomain = new Map(documents.map((document) => [document.domain, document.value]));
  if (byDomain.has("smart-playlists")) {
    const rawSmartPlaylists = byDomain.get("smart-playlists");
    const smartPlaylists = sanitizeSmartPlaylists(rawSmartPlaylists);
    if (!Array.isArray(rawSmartPlaylists) ||
        normalizeSmartPlaylistCriteriaList(smartPlaylists).length !== rawSmartPlaylists.length) {
      throw new Error("The Community smart playlist backup is incomplete");
    }
    if (!options.smartPlaylistsAlreadyPersisted) {
      await updateSmartPlaylistsInStorage((previous) => preserveSmartPlaylistMembership(
        normalizeSmartPlaylistCriteriaList(smartPlaylists), previous,
      ));
    }
    localStorage.removeItem(LEGACY_SMART_PLAYLIST_KEY);
    if (smartPlaylists.length > 0) clearExplicitSmartPlaylistClear();
  }
  if (byDomain.has("filter-formulas")) {
    const filters = asRecord(byDomain.get("filter-formulas"));
    FILTER_KEYS.forEach((key) => {
      const scope = key.split(":").at(-1)!;
      if (filters[scope] !== undefined) localStorage.setItem(key, JSON.stringify(filters[scope]));
      else localStorage.removeItem(key);
    });
  }
  if (byDomain.has("playlist-rules")) writeStoredValue(PLAYLIST_RULES_KEY, byDomain.get("playlist-rules"));
  if (byDomain.has("preferences")) {
    const preferences = asRecord(byDomain.get("preferences"));
    PREFERENCE_KEYS.forEach((key) => preferences[key] === undefined ? localStorage.removeItem(key) : writeStoredValue(key, preferences[key]));
  }

  if (byDomain.has("community-provenance")) {
    const provenance = asRecord(byDomain.get("community-provenance"));
    const existingPolicy = await indexedDBStorage.getCommunityPublicationPolicy();
    await indexedDBStorage.restoreCommunityBackupState({
      publicationPolicy: existingPolicy,
      ownerIdentityMapping: isObject(provenance.ownerIdentityMapping) ? provenance.ownerIdentityMapping as never : null,
      installations: Array.isArray(provenance.installations) ? provenance.installations as never[] : [],
    });
  }
  window.dispatchEvent(new CustomEvent("tagify:durableStateRestored"));
  window.dispatchEvent(new CustomEvent("tagify:settingsChanged"));
  window.dispatchEvent(new CustomEvent("tagify:keyboardSettingsChanged"));
}

export function durableStateEquals(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function clearDurableLocalStateForAccountSwitch(): void {
  [LEGACY_SMART_PLAYLIST_KEY, ...FILTER_KEYS, PLAYLIST_RULES_KEY, ...PREFERENCE_KEYS].forEach((key) => localStorage.removeItem(key));
  clearConfirmedMembershipBaselines();
  window.dispatchEvent(new CustomEvent("tagify:durableStateRestored"));
}

export function captureDurableLocalState(): Record<string, unknown> {
  return {
    filterFormulas: Object.fromEntries(
      FILTER_KEYS.map((key) => [key, readJson(key, null)]),
    ),
    playlistRules: readStoredValue(PLAYLIST_RULES_KEY),
    preferences: Object.fromEntries(
      PREFERENCE_KEYS.map((key) => [key, readStoredValue(key)]),
    ),
  };
}

export function applyDurableLocalState(snapshot: Record<string, unknown>): void {
  clearConfirmedMembershipBaselines();
  const filterFormulas = asRecord(snapshot.filterFormulas);
  FILTER_KEYS.forEach((key) => writeStoredValue(key, filterFormulas[key]));

  writeStoredValue(PLAYLIST_RULES_KEY, snapshot.playlistRules);
  const preferences = asRecord(snapshot.preferences);
  PREFERENCE_KEYS.forEach((key) => writeStoredValue(key, preferences[key]));

  window.dispatchEvent(new CustomEvent("tagify:durableStateRestored"));
  window.dispatchEvent(new CustomEvent("tagify:settingsChanged"));
  window.dispatchEvent(new CustomEvent("tagify:keyboardSettingsChanged"));
}

export function stashDurableLocalStateForAccount(accountId: string): void {
  localStorage.setItem(
    `${ACCOUNT_DRAFT_PREFIX}${accountId}`,
    JSON.stringify(captureDurableLocalState()),
  );
}

export function restoreDurableLocalStateForAccount(accountId: string): boolean {
  try {
    const value = localStorage.getItem(`${ACCOUNT_DRAFT_PREFIX}${accountId}`);
    if (!value) return false;
    applyDurableLocalState(JSON.parse(value) as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeSmartPlaylists(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map(({ lastSyncAt: _lastSyncAt, smartPlaylistTrackUris: _membership, pendingTagChoices, ...durable }) => ({
    ...durable,
    ...(Array.isArray(pendingTagChoices) ? { pendingTagChoices: pendingTagChoices.filter((uri): uri is string =>
      typeof uri === "string" && /^spotify:track:[A-Za-z0-9]{10,64}$/.test(uri)) } : {}),
  }));
}

/**
 * Community stores app state as Postgres jsonb and limits each document by the
 * byte length of its jsonb text form, which adds a space after every ':' and
 * ','. Measure the same way so a document is never accepted here and then
 * rejected by the database on every retry.
 */
export function durableStateStoredByteLength(value: unknown): number {
  return new TextEncoder().encode(jsonbText(value)).byteLength;
}

function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  if (isObject(value)) return `{${Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`).join(", ")}}`;
  return JSON.stringify(value) ?? "null";
}

function readJson(key: string, fallback: unknown): unknown {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; }
}

function readStoredValue(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function writeStoredValue(key: string, value: unknown): void {
  if (value === null || value === undefined) localStorage.removeItem(key);
  else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
}

function asRecord(value: unknown): Record<string, unknown> { return isObject(value) ? value : {}; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
