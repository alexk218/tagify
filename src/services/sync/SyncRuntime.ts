import { syncClientHeaders } from "./SyncClientHeaders";
import type {
  AnnotationField,
  AnnotationPatchMutationV1,
  AnnotationSnapshotV1,
  CollectionSnapshotV1,
  CustomColorSnapshotV1,
  LibrarySnapshotV1,
  LibrarySnapshotV2,
  DurableAppStateDocumentV2,
  DurableAppStateDomain,
  AppStateReplaceMutationV2,
  SyncBatchV1,
  SyncChangeV1,
  SyncConflictV1,
  SyncCapabilitiesV1,
  SyncCapabilitiesV2,
  SyncMutationV1,
  SyncMutationV2,
  TagMembershipMutationV1,
  TaxonomyNodeSnapshotV1,
  InitialMergePlanV1,
  InitialMergeResultV1,
  InitialMergeSource,
} from "@tagify/sync-contracts";
import { assertLibrarySnapshotV1, assertLibrarySnapshotV2, assertSyncMutationV1, DURABLE_APP_STATE_DOMAINS, entityKeyV1, INITIAL_MERGE_REVIEW_VERSION, MAX_APP_STATE_DOCUMENT_BYTES, MAX_SYNC_BATCH_OPERATIONS, planInitialLibraryMerge, PLAYLIST_WRITE_REQUEST_EVENT, PRIVATE_SYNC_PROTOCOL_VERSION } from "@tagify/sync-contracts";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { storageService } from "@/services/storage/StorageService";
import { indexedDBStorage, type SyncTransactionContext, type SyncTransactionWrites } from "@/services/storage/IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import type { ArtistData, PlaylistData, TrackData } from "@/types/tagData";
import type { TagDataStructure, TagTaxonomy } from "@/types/tagData";
import { createEmptyTaxonomy, normalizeTaxonomyTree, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import { expandRecordingEdits } from "@/features/recording-reuse/utils/recordingReuse";
import {
  getDesktopSyncConfiguration,
  getTagifyDatabaseName,
  isSyncSafeId,
  normalizeSyncBpm,
  normalizeSyncEnergy,
  normalizeSyncKey,
  normalizeSyncRating,
  deviceTimestamp,
  editsInclude,
  entityEdits,
  hasEntityEdits,
  makeEntityReplaceIntent,
  syncTimestamps,
  LOCAL_FILES_CHANGED_EVENT,
  flushLocalPersistence,
  setLocalPersistencePaused,
  classifyLocalReplica,
  SESSION_REFRESH_AHEAD_MS,
  sessionNeedsRefresh,
  setDesktopSyncConfiguration,
  SYNC_OUTBOX_CHANGED_EVENT,
  SYNC_STORES,
  type DesktopSyncConfiguration,
  type EntityDeleteIntent,
  type EntityEdits,
  type EntityReplaceIntent,
  type LocalSyncIntent,
  type ReplicaManifest,
  type TaxonomyReplaceIntent,
} from "./SyncLocalState";
import { applyDurableAppStateDocuments, buildDurableAppStateDocuments, durableStateEquals, durableStateStoredByteLength, sanitizeSmartPlaylists } from "./DurableAppState";
import {
  clearExplicitSmartPlaylistClear,
  wereSmartPlaylistsExplicitlyCleared,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { knownCloudTaxonomy, rebuildDeviceTaxonomy } from "./PreserveLocalTaxonomyMetadata";
import { privateNoteBackupStatus, syncPrivateNotes } from "./PrivateNotes";
import { canReadSpotifyLibrary, isNewSpotifyLibraryRequest, markSpotifyLibraryRequestHandled, reportDesktopFeatures, runSpotifyLibrarySend, SPOTIFY_LISTS_FEATURE, type SendSession, type SpotifySendFailure, type SpotifySendOutcome } from "./SpotifyLibrarySender";
import { canSaveToLikedSongs, runSpotifySaves, SPOTIFY_SAVES_FEATURE, spotifySaveNotice } from "./SpotifySaveRunner";
import { canWritePlaylists, localCreatedPlaylists, PLAYLIST_WRITES_FEATURE, PlaylistWriteScheduler, playlistWriteNotice, runPlaylistWrites } from "./PlaylistWriteRunner";
import { runArtistCreditReports } from "./CommunityArtistCredits";
import { communityArtistCreditSources } from "./CommunityArtistCreditSources";
import { runSongReleaseReports } from "./CommunitySongReleases";
import { communitySongReleaseSources } from "./CommunitySongReleaseSources";
import { canPlayFromCommunity, DESKTOP_PLAY_FEATURE, DesktopPlayer, readDesktopPlayRequest } from "./DesktopPlay";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyAccountKey } from "@/services/SpotifyRequests";
import {
  chunkLocalFileEntries,
  LOCAL_FILE_BACKUP_SHADOW_KEY,
  localFileEntries,
  localFileTracks,
  planIncomingLocalFiles,
  planOutgoingLocalFiles,
  type LocalFileBackupShadow,
  type LocalFileEntries,
} from "./LocalFileBackup";
import { expandSyncTaxonomy, flattenTaxonomy, keepTaxonomyTombstones, taxonomyFromShadowRecord, type TaxonomyShadowRecord } from "./SyncTaxonomy";

export { expandSyncTaxonomy, type TaxonomyShadowRecord } from "./SyncTaxonomy";
import { syncPairingService } from "./SyncPairingService";
import { enrollDesktopRecovery } from "./SyncInstallRecovery";
import { isBusyStatus, retryAfterSeconds } from "./SyncRetryAfter";
import packageJson from "@/package";
import { downloadTagDataBackup } from "@/features/tag-data/utils/tagData.backup";
import { readCompleteBackupContents } from "@/features/tag-data/utils/tagData.backupContents";

export type SyncStatus = "unlinked" | "idle" | "syncing" | "publishing" | "offline" | "reauthorize" | "snapshot-required" | "merge-required" | "publication-review-required" | "recovery-available" | "restoring" | "restore-failed" | "error";
export interface InitialMergeReview extends InitialMergePlanV1 { labels: Record<string, string>; supported: boolean }
export interface RecoveryPreview { annotations: number; taxonomyNodes: number; appStateDocuments: number; smartPlaylists: number | null; lastBackupAt: string | null; protectedDomains: string[] }
export interface BackupHealth {
  lastBackupAt: string | null; annotations: number; taxonomyNodes: number; appStateDocuments: number; protectedDomains: string[];
  /** Saved settings too large for Community; they stay on this device only. */
  notBackedUp: DurableAppStateDomain[];
  /** Saved settings changed here and on another device; the user chooses which to keep. */
  needsChoice: DurableAppStateDomain[];
  /** Backups that failed and will be tried again. */
  retrying: Array<"local-files" | "notes">;
  /** Items with a value Community cannot hold, kept on this device only. */
  deviceOnlyChanges: number;
}
export interface CommunityRequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  /**
   * False for a Community route outside sync, such as /api/v2/device/profile. Those
   * answer CORS with Community's external API headers, which allow only
   * authorization, content-type and if-none-match, so Spotify can't send them
   * sync's client headers.
   */
  syncHeaders?: boolean;
}
export function canCombineInitialLibrariesWithoutReview(review: InitialMergeReview | null): boolean {
  return Boolean(review?.supported && review.conflicts.length === 0);
}
export function sameInitialMergeDeviceContent(left: LibrarySnapshotV2, right: LibrarySnapshotV2): boolean {
  const content = (snapshot: LibrarySnapshotV2) => JSON.stringify({
    libraryId: snapshot.libraryId,
    sourceStorageSchemaVersion: snapshot.sourceStorageSchemaVersion,
    taxonomy: snapshot.taxonomy,
    colors: snapshot.colors,
    collections: snapshot.collections,
    annotations: snapshot.annotations,
    appState: snapshot.appState.map(({ domain, value }) => ({ domain, value })),
  });
  return content(left) === content(right);
}
interface ShadowRecord { key: string; annotation: AnnotationSnapshotV1 }
interface CursorRecord { key: "cursor"; value: number }
interface PullBatch { cursor: number; batchId: string; operations: SyncMutationV2[]; committedAt: string }
/** One page of changes, from a pull or returned with a push. */
interface PullPage {
  unchanged?: boolean;
  snapshotRequired?: boolean;
  headCursor?: number;
  batches?: PullBatch[];
  conflicts?: SyncConflictV1[];
  /** `listenWhileHidden`: the member plays songs from Community in this Spotify (Community 9002). */
  liveSync?: { realtime?: unknown; listenWhileHidden?: unknown };
}
interface PushOutcome {
  sent: number; accepted: number; confirmed: number; snapshot: boolean;
  /** The push carried every later change back, so no pull is needed to confirm it. */
  laterApplied: boolean;
}
type AnnotationMutation = Extract<SyncMutationV1, { type: "annotation.patch" | "annotation.tag-membership" | "annotation.delete" }>;

/** Safety checks while the live connection is down: it may be missing announcements. */
const RECOVERY_POLL_INTERVALS_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000] as const;
/**
 * Safety checks while nothing can arrive unannounced: Realtime is live, or no
 * other device or website sign-in uses this library.
 */
export const QUIET_RECOVERY_POLL_INTERVALS_MS = [60 * 60_000, 90 * 60_000, 120 * 60_000] as const;
const MAX_PULL_PAGES = 5_000;
const PULL_PAGE_SIZE = 200;
/** The database function Tagify may call directly when Community advertises `directPull`. */
const DIRECT_PULL_FUNCTION = "pull_sync_changes_with_live_sync";
const APP_STATE_CHOICE_PREFIX = "app-state-choice:";
const DEVICE_ONLY_CHANGES_KEY = "device-only-changes";
/** Saved settings that changed here and on another device. `keep` records the user's choice until it is backed up. */
interface AppStateChoiceRecord { key?: string; domain: DurableAppStateDomain; createdAt: string; keep?: "device" }
interface DeviceOnlyChangesRecord { key: typeof DEVICE_ONLY_CHANGES_KEY; items: Record<string, { types: string[]; at: string }> }
const LIBRARY_SUMMARY_REFRESH_MS = 6 * 60 * 60_000;
const CAPABILITIES_CACHE_MS = 24 * 60 * 60_000;
const CLIENT_VERSION = packageJson.version;
/** Edits are backed up once typing pauses, and at least this often during continuous editing. */
export const EDIT_SYNC_DEBOUNCE_MS = 3_000;
export const EDIT_SYNC_MAX_WAIT_MS = 15_000;
/**
 * After a minute of steady tagging, edits are grouped into fewer, larger
 * backups. They are already saved on this device, and hiding Spotify backs
 * them up straight away.
 */
export const LONG_SESSION_EDIT_SYNC_DEBOUNCE_MS = 10_000;
export const LONG_SESSION_EDIT_SYNC_MAX_WAIT_MS = 60_000;
export const LONG_EDIT_SESSION_AFTER_MS = 60_000;
/** A pause this long between edits ends a tagging session. */
export const EDIT_SESSION_GAP_MS = 2 * 60_000;
/** Returning to Spotify only checks Community when the live connection may have missed something. */
export const VISIBLE_RESYNC_AFTER_MS = 5 * 60_000;
/** Spotify hidden this long releases its live Community connection until it is shown again. */
export const HIDDEN_REALTIME_CLOSE_MS = 2 * 60_000;
/**
 * A sync waits at most this long for a live connection that is opening, so
 * its one pull covers everything until Realtime starts announcing changes.
 */
export const REALTIME_JOIN_WAIT_MS = 10_000;
/** Per library: Community's latest word on whether anyone else uses it (`liveSync.realtime`). */
export const LIVE_SYNC_HINT_PREFIX = "tagify:sync:live-sync:";
/** The hint covers the last three hours; an older one can't say whether to connect before the first pull. */
export const LIVE_SYNC_HINT_MAX_AGE_MS = 3 * 60 * 60_000;
/** An unchanged hint is saved again at most this often. */
const LIVE_SYNC_HINT_SAVE_MS = 15 * 60_000;
/** setTimeout fires at once beyond about 24.8 days, so long waits are re-armed daily. */
const MAX_TIMER_MS = 24 * 60 * 60_000;
const SIDE_SYNC_BACKOFF_MAX_MS = 60 * 60_000;

/** Community's last word on whether another device or the website uses this library, while it is recent. */
export function liveSyncHint(libraryId: string, now = Date.now()): boolean | null {
  try {
    const value = JSON.parse(localStorage.getItem(`${LIVE_SYNC_HINT_PREFIX}${libraryId}`) || "null") as { realtime?: unknown; at?: unknown } | null;
    if (typeof value?.realtime !== "boolean" || typeof value.at !== "number") return null;
    const age = now - value.at;
    return age >= 0 && age < LIVE_SYNC_HINT_MAX_AGE_MS ? value.realtime : null;
  } catch {
    return null;
  }
}

/**
 * When a refreshed session expires, by this device's clock. Supabase names
 * the time by its own clock; counting `expires_in` from now as well keeps
 * refreshes early on a device whose clock is behind.
 */
export function sessionExpiresAt(session: { expires_at?: unknown; expires_in?: unknown }, now = Date.now()): number {
  const nowSeconds = Math.floor(now / 1_000);
  const byLifetime = typeof session.expires_in === "number" && Number.isFinite(session.expires_in) && session.expires_in > 0 ? nowSeconds + Math.floor(session.expires_in) : null;
  const byServer = typeof session.expires_at === "number" && Number.isFinite(session.expires_at) ? session.expires_at : null;
  if (byLifetime !== null && byServer !== null) return Math.min(byLifetime, byServer);
  // Supabase sends both; without either, assume its default one-hour session.
  return byLifetime ?? byServer ?? nowSeconds + 3_600;
}

export function safetySyncDelayMs(stage = 2, random = Math.random, quiet = false): number {
  const intervals = quiet ? QUIET_RECOVERY_POLL_INTERVALS_MS : RECOVERY_POLL_INTERVALS_MS;
  const interval = intervals[Math.min(Math.max(stage, 0), intervals.length - 1)];
  return Math.round(interval * (1 + random() * 0.2));
}

/**
 * Trailing debounce for edit-triggered sync, bounded by a maximum wait from
 * the first unsent edit. Both grow once a tagging session has lasted a minute.
 */
export function editSyncDelayMs(firstEditAt: number, now: number, sessionStartedAt = now): number {
  const long = now - sessionStartedAt >= LONG_EDIT_SESSION_AFTER_MS;
  const debounce = long ? LONG_SESSION_EDIT_SYNC_DEBOUNCE_MS : EDIT_SYNC_DEBOUNCE_MS;
  const maxWait = long ? LONG_SESSION_EDIT_SYNC_MAX_WAIT_MS : EDIT_SYNC_MAX_WAIT_MS;
  return Math.max(0, Math.min(debounce, firstEditAt + maxWait - now));
}

/**
 * How much the live connection covers:
 * - `live`: Realtime has stayed connected since this device last confirmed it
 *   was current, so every change since was announced;
 * - `quiet`: no live connection is needed (nobody else uses the library), or
 *   Realtime reconnected and a check is already on its way;
 * - `down`: a live connection is wanted but missing.
 */
export type RealtimeCoverage = "live" | "quiet" | "down";

export function shouldSyncWhenVisible({ hiddenForMs, realtime, msSinceLastSync }: {
  hiddenForMs: number;
  realtime: RealtimeCoverage;
  msSinceLastSync: number;
}): boolean {
  if (realtime === "live") return false;
  if (realtime === "down") return true;
  return hiddenForMs >= VISIBLE_RESYNC_AFTER_MS || msSinceLastSync >= VISIBLE_RESYNC_AFTER_MS;
}

/** Retry delay after consecutive local-file or note backup failures: 1, 2, 4 … minutes, at most an hour. */
export function sideSyncBackoffMs(failures: number, random = Math.random): number {
  const base = 60_000 * 2 ** Math.min(Math.max(failures - 1, 0), 6);
  return Math.min(SIDE_SYNC_BACKOFF_MAX_MS, Math.round(base * (1 + random() * 0.2)));
}

/** Skips a best-effort part of sync after failures until its back-off has passed. */
export class SideSyncBackoff {
  private failures = 0;
  private notBefore = 0;
  constructor(private readonly random: () => number = Math.random) {}
  shouldRun(now = Date.now(), force = false): boolean { return force || now >= this.notBefore; }
  succeeded(): void { this.failures = 0; this.notBefore = 0; }
  failed(now = Date.now()): void { this.failures++; this.notBefore = now + sideSyncBackoffMs(this.failures, this.random); }
}

export interface PullSideDocuments {
  localFilesRevision: number;
  privateNotesCursor: number;
  /** When the member last asked on Community for their Spotify lists (Community 0233), if ever. */
  spotifyLibraryRequestedAt?: string | null;
  /** Songs the member asked on Community to save to their Liked Songs are waiting, only when some are. */
  spotifySavesWaiting?: boolean;
}

/** Revisions of the separately stored backups, reported by newer Community pull responses. */
export function pullSideDocuments(response: unknown): PullSideDocuments | null {
  const value = (response as { sideDocuments?: { localFilesRevision?: unknown; privateNotesCursor?: unknown; spotifyLibraryRequestedAt?: unknown; spotifySavesWaiting?: unknown } } | null)?.sideDocuments;
  if (!value || !Number.isSafeInteger(value.localFilesRevision) || !Number.isSafeInteger(value.privateNotesCursor)) return null;
  return {
    localFilesRevision: Number(value.localFilesRevision), privateNotesCursor: Number(value.privateNotesCursor),
    ...(typeof value.spotifyLibraryRequestedAt === "string" ? { spotifyLibraryRequestedAt: value.spotifyLibraryRequestedAt } : {}),
    ...(value.spotifySavesWaiting === true ? { spotifySavesWaiting: true } : {}),
  };
}

const SEND_FAILURE_NOTICES: Record<SpotifySendFailure, string> = {
  spotify_busy: "Spotify asked Tagify to slow down, so your Spotify lists weren't all sent to Community. Try again there in a minute.",
  spotify_unavailable: "Tagify couldn't read your Spotify lists. Make sure Spotify is online, then try again on Community.",
  too_large: "Your Spotify lists are more than Community can keep. Remove some lists there, then try again.",
  daily_limit: "You've sent your Spotify lists to Community a lot today. Try again tomorrow.",
  paused: "Community isn't taking Spotify lists right now. Try again later.",
  signed_out: "Connect Tagify to Community again in Cloud Sync, then ask for your Spotify lists again.",
  network: "Tagify lost its connection to Community while sending your Spotify lists. Try again there once you're online.",
  unknown: "Tagify couldn't send your Spotify lists to Community. Try again there in a moment.",
};

/** What Tagify says in Spotify when a send ends; nothing when another computer has it or nothing was asked. */
export function spotifySendNotice(outcome: SpotifySendOutcome): { text: string; error: boolean } | null {
  switch (outcome.status) {
    case "done":
    case "sent":
      return { text: `Sent ${outcome.songs.toLocaleString()} songs in ${outcome.lists.toLocaleString()} lists to Tagify Community.`, error: false };
    case "cancelled":
      return { text: "Stopped sending your Spotify lists, as you asked on Community.", error: false };
    case "failed":
      return { text: SEND_FAILURE_NOTICES[outcome.failure], error: true };
    default:
      return null;
  }
}

/** What this Tagify tells Community it can do, from what this Spotify's desktop app offers. Each report replaces the last. */
export function desktopFeatures(
  platform: unknown = typeof Spicetify === "undefined" ? undefined : Spicetify.Platform,
  player: unknown = typeof Spicetify === "undefined" ? undefined : Spicetify.Player,
): string[] {
  return [
    ...(canReadSpotifyLibrary(platform) ? [SPOTIFY_LISTS_FEATURE] : []),
    ...(canSaveToLikedSongs(platform) ? [SPOTIFY_SAVES_FEATURE] : []),
    ...(canWritePlaylists(platform) ? [PLAYLIST_WRITES_FEATURE] : []),
    ...(canPlayFromCommunity(player) ? [DESKTOP_PLAY_FEATURE] : []),
  ];
}

/** Community and Supabase answers that mean this device must be reconnected, not retried. */
export function isDefinitiveSessionFailure(message: string): boolean {
  return /^(?:device_revoked|session_inactive)\b/.test(message);
}

export { syncClientHeaders } from "./SyncClientHeaders";

/** How often Tagify looks again for songs Community has no artists for. */
const ARTIST_CREDITS_INTERVAL_MS = 3 * 60 * 60_000;
/** How often Tagify looks again for songs Community knows no album for. */
const SONG_RELEASES_INTERVAL_MS = 3 * 60 * 60_000;

export function capabilitiesCacheKey(apiBaseUrl: string): string {
  return `tagify:sync-capabilities:${CLIENT_VERSION}:notes-v1:merge-v2:${new URL(apiBaseUrl).origin}`;
}

interface SyncLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export function accountSyncLockName(accountId: string): string {
  return `tagify:community-sync:${accountId}`;
}

export function runWithAccountSyncLock<T>(
  accountId: string,
  callback: () => Promise<T>,
  lockManager: SyncLockManager | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.locks as SyncLockManager | undefined,
): Promise<T> {
  if (!lockManager) return callback();
  return lockManager.request(accountSyncLockName(accountId), { mode: "exclusive" }, callback);
}

export async function gzipJsonBody(value: unknown): Promise<ArrayBuffer> {
  return gzipText(JSON.stringify(value));
}

async function gzipText(json: string): Promise<ArrayBuffer> {
  if (typeof CompressionStream === "undefined") throw new Error("This Spotify version cannot prepare a large Community library review");
  const source = new Response(json).body;
  if (!source) throw new Error("This Spotify version cannot prepare a large Community library review");
  return new Response(source.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

/** Gzipped request bodies stay under the website's 4.5 MB request limit with room for headers. */
export const MAX_COMPRESSED_REQUEST_BYTES = 4_000_000;
/** Requests for one reset while Community is still saving it (it waits up to 4 minutes per request). */
const RESET_INSTALL_ATTEMPTS = 4;
/** The Community capability that accepts a gzipped library reset. */
export const COMPRESSED_REPLACE_CAPABILITY = "compressedReplace";
/** Community's default limit for the expanded JSON of a compressed request. */
export const MAX_EXPANDED_REQUEST_BYTES = 64_000_000;

/**
 * Limits for a gzipped reset when Community advertises
 * `compressedReplace: { encoding: "gzip", maxCompressedBytes, maxExpandedBytes }`;
 * null means send it as plain JSON (older Community rejects gzip bytes).
 */
export function compressedReplaceLimits(capabilities: unknown): { maxCompressedBytes: number; maxExpandedBytes: number } | null {
  const value = (capabilities as Record<string, unknown> | null)?.[COMPRESSED_REPLACE_CAPABILITY] as { encoding?: unknown; maxCompressedBytes?: unknown; maxExpandedBytes?: unknown } | undefined;
  if (!value || typeof value !== "object" || value.encoding !== "gzip") return null;
  const limit = (advertised: unknown, ceiling: number) => {
    const bytes = Number(advertised);
    return Number.isSafeInteger(bytes) && bytes > 0 ? Math.min(bytes, ceiling) : ceiling;
  };
  return { maxCompressedBytes: limit(value.maxCompressedBytes, MAX_COMPRESSED_REQUEST_BYTES), maxExpandedBytes: limit(value.maxExpandedBytes, MAX_EXPANDED_REQUEST_BYTES) };
}

export interface OutboxGroup {
  key: string;
  /** The latest intent; a taxonomy intent carries the earliest queued base. */
  intent: LocalSyncIntent;
  /** Every queued intent this group covers, oldest first. */
  ids: string[];
  /** For an item: every field and tag this device changed across the group. */
  edits?: EntityEdits;
}

/**
 * Groups queued intents per item (and one taxonomy group) up to a
 * whole-library boundary. Each group sends the latest result for everything
 * any of its intents changed.
 */
export function coalesceOutboxIntents(intents: LocalSyncIntent[]): { intents: LocalSyncIntent[]; supersededIds: string[]; groups: OutboxGroup[] } {
  const snapshotIndex = intents.findIndex((intent) => intent.type === "library.snapshot");
  if (snapshotIndex === 0) return { intents: [intents[0]], supersededIds: [], groups: [{ key: "library", intent: intents[0], ids: [intents[0].id] }] };
  const segment = snapshotIndex < 0 ? intents : intents.slice(0, snapshotIndex);
  const byKey = new Map<string, LocalSyncIntent[]>();
  for (const intent of segment) {
    if (intent.type === "library.snapshot") continue;
    const key = intent.type === "taxonomy.replace"
      ? "taxonomy"
      : `entity:${entityKeyV1(intent.entity)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), intent]);
  }
  const groups = [...byKey.entries()].map(([key, members]): OutboxGroup => {
    const latest = members[members.length - 1];
    if (latest.type === "taxonomy.replace") {
      const earliest = members[0] as TaxonomyReplaceIntent;
      const intent: TaxonomyReplaceIntent = { ...latest };
      if (earliest.base) intent.base = earliest.base; else delete intent.base;
      return { key, intent, ids: members.map((member) => member.id) };
    }
    return {
      key, intent: latest, ids: members.map((intent) => intent.id),
      edits: entityEdits(members.filter((intent): intent is EntityReplaceIntent | EntityDeleteIntent => intent.type === "entity.replace" || intent.type === "entity.delete")),
    };
  }).sort((left, right) => left.intent.createdAt - right.intent.createdAt);
  return {
    intents: groups.map((group) => group.intent),
    supersededIds: groups.flatMap((group) => group.ids.filter((id) => id !== group.intent.id)),
    groups,
  };
}

/** How soon a change Community hasn't confirmed yet is sent again. */
const WAITING_CHANGE_RETRY_MS = 2 * 60_000;
/** A full cloud-copy refresh for unconfirmed changes runs at most this often. */
const SHADOW_REPAIR_INTERVAL_MS = 15 * 60_000;

export function syncFailureBackoffMs(status: number, retryAfterSeconds: number | null, failureCount: number, random = Math.random): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.min(retryAfterSeconds * 1000, 6 * 60 * 60_000);
  if (status === 402) return 6 * 60 * 60_000;
  const base = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(failureCount, 6));
  return Math.round(base * (1 + random() * 0.25));
}

export function shouldStampAnnotationDateModified(
  operation: AnnotationMutation,
): boolean {
  if (operation.type === "annotation.tag-membership") {
    return true;
  }

  if (operation.type === "annotation.delete") {
    return false;
  }

  return "rating" in operation.fields || "energy" in operation.fields;
}

export async function revokeDesktopSyncDevice(
  configuration: DesktopSyncConfiguration,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(
    `${configuration.apiBaseUrl}/api/v2/devices/${encodeURIComponent(configuration.deviceId)}`,
    {
      method: "DELETE",
      headers: syncClientHeaders(configuration.accessToken),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (response.ok || response.status === 401) return;
  throw new Error(
    payload.error?.message || "Tagify could not revoke this device from Community.",
  );
}

class SyncRuntime extends EventTarget {
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private status: SyncStatus = "unlinked";
  private realtime: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private realtimeConnecting = false;
  private realtimeSubscribedAt = 0;
  private initialMergePreview: InitialMergeReview | null = null;
  private initialMergeDeviceSnapshot: LibrarySnapshotV2 | null = null;
  private initialMergeOperationId: string | null = null;
  private recoveryPreview: RecoveryPreview | null = null;
  private lastRecovered: RecoveryPreview | null = null;
  private supportsV2 = false;
  private backupHealth: BackupHealth | null = null;
  private cloudReplacementArmed = false;
  private readonly oversizedAppStateDomains = new Set<DurableAppStateDomain>();
  private settingsChoices: DurableAppStateDomain[] = [];
  private localFilesRetrying = false;
  private deviceOnlyChangeCount = 0;
  /** Batches this device sent; their echo updates only the sync shadows. */
  private readonly ownBatchIds = new Set<string>();
  private batchSalt = "";
  private taxonomyRefreshRequested = false;
  private capabilities: SyncCapabilitiesV1 | SyncCapabilitiesV2 | null = null;
  private lastLibrarySummaryAt = 0;
  private automaticRetryNotBefore = 0;
  private lastShadowRepairAt = -Infinity;
  private consecutiveFailures = 0;
  private lastUserSyncAt = 0;
  private recoveryPollStage = 0;
  private projectionTargetCursor = 0;
  private projectionPending = false;
  private projectionReviewRequired = false;
  private backupHealthRefreshRequested = false;
  private editSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingEditAt = 0;
  /** The current tagging session: its first edit and its latest one. */
  private editSessionStartedAt = 0;
  private lastEditAt = 0;
  /** Committed local edits seen, and how many of them the last completed sync covered. */
  private localEditCount = 0;
  private settledEditCount = 0;
  /** Highest Community cursor announced by Realtime while a sync was already running. */
  private pendingRealtimeHead = 0;
  /** Whether the latest pull left this device at Community's newest cursor. */
  private lastPullReachedHead = false;
  /** When the latest reply that reached Community's newest cursor was asked for. */
  private headConfirmedAt = 0;
  /** Newest cursor another device or the website announced over Realtime. */
  private announcedHead = 0;
  /**
   * Whether another device or the website used this library recently, as
   * Community last reported; null until it has said. Only then is a live
   * connection worth holding open.
   */
  private realtimeWanted: boolean | null = null;
  /** When the next safety check is due; kept while Spotify is hidden. */
  private nextSafetySyncAt = 0;
  /** Local-file and note revisions from the latest pull, when Community reports them. */
  private lastSideDocuments: PullSideDocuments | null = null;
  private lastSuccessfulSyncAt = 0;
  private hiddenAt = 0;
  private realtimeSuspended = false;
  private realtimeSuspendTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeToken = "";
  /** The refresh token Community or Supabase rejected; automatic retries stop until the device reconnects. */
  private inactiveRefreshToken: string | null = null;
  private refreshing: { refreshToken: string; result: Promise<DesktopSyncConfiguration> } | null = null;
  /** An access token Community refused before this device's clock says it expires; the next use refreshes it. */
  private refusedAccessToken: string | null = null;
  /** Refreshes the session shortly before it expires while Realtime holds it. */
  private sessionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Syncs waiting for the live connection that is opening; it lets them go once it joins or fails. */
  private readonly realtimeJoinWaiters = new Set<() => void>();
  /** A channel subscription was sent and has not answered yet. */
  private realtimeJoinPending = false;
  /** Syncs started but not yet past their wait for the live connection; each pulls after any join. */
  private syncsBeforeJoin = 0;
  /** Community's live-sync hint as last saved for this library, and when. */
  private liveSyncHintSaved: { libraryId: string; realtime: boolean; at: number } | null = null;
  private readonly localFileBackoff = new SideSyncBackoff();
  private readonly privateNotesBackoff = new SideSyncBackoff();
  /** Set when Community stopped accepting the cursor in a pull's body during this session. */
  private pullRequestBodyUnavailable = false;
  /** Set when a direct read failed but Community's address worked, for the rest of the session. */
  private directPullUnavailable = false;
  /** Cleared when Spotify cannot read Community's "not modified" reply to a local-file check. */
  private conditionalLocalFileReads = true;
  /** Sending the member's Spotify lists to Community, which they asked for on the website. */
  private spotifyLibrarySend: Promise<void> | null = null;
  private readonly desktopPlayer = new DesktopPlayer();
  /** Community says the member plays songs from the website here, so the live channel stays open while Spotify is hidden. */
  private listenWhileHidden = false;
  /** The device whose features were reported to Community since this start, and that report. */
  private featuresReportedFor: string | null = null;
  private featuresReport: Promise<boolean> | null = null;
  /** Keeping playlists the member made on Community in their Spotify (PlaylistWriteRunner.ts). */
  private readonly playlistWrites = new PlaylistWriteScheduler({
    run: async (capability) => {
      const configuration = getDesktopSyncConfiguration();
      if (!configuration || !canWritePlaylists()) return { written: 0, failed: 0, created: [] };
      const run = await runPlaylistWrites(this.sideSession(configuration), spotifyApiService, capability, localCreatedPlaylists(spotifyAccountKey));
      const notice = playlistWriteNotice(run);
      if (notice) Spicetify.showNotification(notice);
      return run;
    },
  });
  /** Saving songs the member asked for on Community to their Liked Songs, and whether to look again after. */
  private spotifySaves: Promise<void> | null = null;
  private artistCredits: Promise<void> | null = null;
  private artistCreditsRanAt = 0;
  private artistCreditsUnsupported = false;
  private songReleases: Promise<void> | null = null;
  private songReleasesRanAt = 0;
  private songReleasesUnsupported = false;
  private spotifySavesAgain = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    const configuration = getDesktopSyncConfiguration();
    // When Community said recently that someone else uses this library, the
    // live connection joins before the first pull, so that pull is the only one.
    if (configuration && this.realtimeWanted === null) this.realtimeWanted = liveSyncHint(configuration.libraryId);
    this.setStatus(configuration ? this.recoveryPreview ? "recovery-available" : "idle" : "unlinked");
    window.addEventListener("online", this.handleOnline);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener(SYNC_OUTBOX_CHANGED_EVENT, this.handleOutboxChanged);
    window.addEventListener(LOCAL_FILES_CHANGED_EVENT, this.handleOutboxChanged);
    // Realtime triggers sync immediately; local edits sync once typing pauses.
    // Safety checks back off from 5 to 15 to 30 minutes while the live
    // connection is down, and from 60 to 90 to 120 minutes while it is live
    // or not needed. They pause while Spotify is hidden.
    this.hiddenAt = document.visibilityState === "visible" ? 0 : Date.now();
    this.scheduleSafetySync();
    this.installPublicApi();
    if (configuration) void this.syncNow();
  }

  stop(): void {
    this.started = false;
    this.featuresReportedFor = null;
    this.featuresReport = null;
    this.playlistWrites.stop();
    if (this.timer) clearTimeout(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.editSyncTimer) clearTimeout(this.editSyncTimer);
    if (this.realtimeSuspendTimer) clearTimeout(this.realtimeSuspendTimer);
    if (this.sessionRefreshTimer) clearTimeout(this.sessionRefreshTimer);
    this.sessionRefreshTimer = null;
    this.timer = null;
    this.nextSafetySyncAt = 0;
    this.reconnectTimer = null;
    this.editSyncTimer = null;
    this.firstPendingEditAt = 0;
    this.editSessionStartedAt = 0;
    this.lastEditAt = 0;
    this.realtimeSuspendTimer = null;
    this.realtimeSuspended = false;
    this.pendingRealtimeHead = 0;
    window.removeEventListener("online", this.handleOnline);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener(SYNC_OUTBOX_CHANGED_EVENT, this.handleOutboxChanged);
    window.removeEventListener(LOCAL_FILES_CHANGED_EVENT, this.handleOutboxChanged);
    if (this.channel && this.realtime) void this.realtime.removeChannel(this.channel);
    this.channel = null; this.realtime = null;
    this.settleRealtimeJoin();
  }

  getStatus(): SyncStatus { return this.status; }
  getInitialMergePreview(): InitialMergeReview | null { return this.initialMergePreview; }
  getRecoveryPreview(): RecoveryPreview | null { return this.recoveryPreview; }
  getLastRecovered(): RecoveryPreview | null { return this.lastRecovered; }
  getBackupHealth(): BackupHealth | null {
    if (!this.backupHealth) return null;
    const notBackedUp = [...this.oversizedAppStateDomains];
    return {
      ...this.backupHealth,
      appStateDocuments: Math.max(0, this.backupHealth.appStateDocuments - (this.backupHealth.protectedDomains.includes("preferences") ? 1 : 0)),
      protectedDomains: this.backupHealth.protectedDomains.filter((domain) => domain !== "preferences" && !notBackedUp.includes(domain as DurableAppStateDomain)),
      notBackedUp,
      needsChoice: [...this.settingsChoices],
      retrying: [...(this.localFilesRetrying ? ["local-files" as const] : []), ...(privateNoteBackupStatus() === "error" ? ["notes" as const] : [])],
      deviceOnlyChanges: this.deviceOnlyChangeCount,
    };
  }

  private notifyBackupHealthChanged(): void {
    window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status: this.status } }));
  }
  async commitInitialMerge(resolutions: Record<string, InitialMergeSource>): Promise<InitialMergeResultV1> {
    const configuration = getDesktopSyncConfiguration();
    let review = this.initialMergePreview;
    let deviceSnapshot = this.initialMergeDeviceSnapshot;
    if (!configuration || !review || !deviceSnapshot) throw new Error("The library review is no longer available");
    if (!review.supported) throw new Error("Combining libraries is paused while Tagify and Community finish updating. Please try again later.");
    if (review.conflicts.some((conflict) => !resolutions[conflict.id])) throw new Error("Choose which copy to keep before combining your libraries");
    this.setStatus("syncing");
    try {
      await flushLocalPersistence();
      const latestDeviceSnapshot = await this.captureInitialMergeDeviceSnapshot(configuration);
      if (!sameInitialMergeDeviceContent(deviceSnapshot, latestDeviceSnapshot)) {
        await this.prepareInitialMerge(configuration);
        review = this.initialMergePreview;
        deviceSnapshot = this.initialMergeDeviceSnapshot;
        if (!review || !deviceSnapshot || review.conflicts.length) {
          throw new Error("merge_review_required: Your device library changed. Check the refreshed choices before combining.");
        }
      }
      const outboxBeforeMerge = (await readOutbox()).map((intent) => intent.id).sort().join(",");
      const response = await this.requestCompressed(configuration, "/api/v2/sync/merge", {
        version: INITIAL_MERGE_REVIEW_VERSION,
        deviceId: configuration.deviceId,
        operationId: this.initialMergeOperationId || (this.initialMergeOperationId = crypto.randomUUID()),
        expectedCommunityHeadCursor: review.communityHeadCursor,
        expectedCommunityChecksum: review.communityChecksum,
        deviceSnapshot,
        resolutions,
      });
      const canonical = await this.downloadSnapshot(configuration, PRIVATE_SYNC_PROTOCOL_VERSION) as LibrarySnapshotV2;
      assertLibrarySnapshotV2(canonical);
      await flushLocalPersistence();
      const outboxAfterMerge = (await readOutbox()).map((intent) => intent.id).sort().join(",");
      const currentDeviceSnapshot = await this.captureInitialMergeDeviceSnapshot(configuration);
      if (outboxAfterMerge !== outboxBeforeMerge || !sameInitialMergeDeviceContent(deviceSnapshot, currentDeviceSnapshot)) {
        await this.prepareInitialMerge(configuration);
        throw new Error("merge_review_required: Your device library changed while Tagify was combining it. Check the refreshed choices before continuing.");
      }
      // Reconciliation date alignment: every replica adopts the reviewed saved
      // dates, while keeping device-only details and original normalized values.
      const saved = await indexedDBStorage.replaceCloudReplica(tagDataFromSnapshot(canonical), replicaManifest(configuration, canonical), stateRecordsFromSnapshot(canonical), canonical.appState, [], { annotationDates: "canonical" });
      if (!saved) throw new Error("Your combined library was saved to Community, but this device could not finish updating");
      await applyDurableAppStateDocuments(canonical.appState, { smartPlaylistsAlreadyPersisted: true });
      await markManifestAppStateApplied();
      await this.acknowledgeCursor(configuration, canonical.headCursor);
      this.initialMergePreview = null;
      this.initialMergeDeviceSnapshot = null;
      this.initialMergeOperationId = null;
      this.backupHealthRefreshRequested = true;
      dispatchSyncEvent("remote", crypto.randomUUID(), []);
      this.updateProjectionStatus(response.projection);
      this.setSettledStatus();
      return {
        ...(response.merge as InitialMergeResultV1),
        additionsFromDevice: review.additionsFromDevice,
        additionsFromCommunity: review.additionsFromCommunity,
        conflictsResolved: review.conflicts.length,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("merge_review_required:")) {
        this.setStatus("merge-required");
        throw error;
      }
      if (error instanceof SyncHttpError && error.status === 409) {
        await this.prepareInitialMerge(configuration);
        if (this.initialMergePreview?.conflicts.length) {
          this.setStatus("merge-required");
          throw new Error("merge_review_required: Community changed while you were reviewing. Check the refreshed differences before continuing.");
        }
        this.setStatus("syncing");
        throw new Error("Community changed while Tagify was combining your libraries. Tagify will try again.");
      }
      this.setStatus(review?.conflicts.length ? "merge-required" : "error");
      throw error;
    }
  }

  async downloadInitialMergeBackup(): Promise<void> {
    const data = await indexedDBStorage.loadAll();
    if (!data) throw new Error("Your Tagify backup could not be prepared");
    downloadTagDataBackup(data, await readCompleteBackupContents());
  }
  armCloudReplacement(): void { this.cloudReplacementArmed = true; }

  async unlinkLocal(): Promise<void> {
    this.stop();
    try {
      const configuration = getDesktopSyncConfiguration();
      if (configuration) {
        let activeConfiguration: DesktopSyncConfiguration | null = configuration;
        try {
          activeConfiguration = await this.refreshIfNeeded(configuration);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "session_inactive") throw error;
          activeConfiguration = null;
        }
        if (activeConfiguration) await revokeDesktopSyncDevice(activeConfiguration);
      }
      await syncPairingService.unlinkLocal();
      this.resetAccountState();
      this.backupHealth = null;
      this.initialMergePreview = null;
      this.initialMergeDeviceSnapshot = null;
      this.initialMergeOperationId = null;
      this.recoveryPreview = null;
      this.setStatus("unlinked");
    } catch (error) {
      this.start();
      throw error;
    }
  }

  async activateCurrentAccount(): Promise<void> {
    this.stop();
    this.resetAccountState();
    if (!(await storageService.switchAccountDatabase())) {
      throw new Error("The account-scoped Tagify database could not be opened");
    }
    this.start();
    await this.syncNow();
  }

  private resetAccountState(): void {
    this.taxonomyRefreshRequested = false;
    this.settingsChoices = [];
    this.localFilesRetrying = false;
    this.deviceOnlyChangeCount = 0;
    this.oversizedAppStateDomains.clear();
    this.ownBatchIds.clear();
    this.headConfirmedAt = 0;
    this.announcedHead = 0;
    this.realtimeWanted = null;
    this.liveSyncHintSaved = null;
    this.refusedAccessToken = null;
    // Another account's failed backups say nothing about this one.
    this.localFileBackoff.succeeded();
    this.privateNotesBackoff.succeeded();
    this.conditionalLocalFileReads = true;
    this.pullRequestBodyUnavailable = false;
    this.directPullUnavailable = false;
  }

  async replaceCloudWithCurrentLocalState(): Promise<void> {
    const configuration = getDesktopSyncConfiguration();
    if (!configuration) return;
    if (!this.cloudReplacementArmed) throw new Error("Cloud replacement requires the RESET TAGIFY confirmation");
    try {
      await flushLocalPersistence();
      const core = await buildLocalSnapshot(configuration.libraryId);
      const appState = await buildDurableAppStateDocuments();
      const operationId = crypto.randomUUID();
      const snapshot: LibrarySnapshotV2 = { ...core, protocolVersion: PRIVATE_SYNC_PROTOCOL_VERSION, appState };
      assertLibrarySnapshotV2(snapshot);
      const replacement = { deviceId: configuration.deviceId, operationId, confirmation: "RESET TAGIFY", snapshot };
      // The whole library goes in one request. Uncompressed, the website's
      // 4.5 MB request limit stops it at about 7,000 songs; newer Community
      // servers accept it gzipped, as the reviewed merge already is.
      // A Spotify version without CompressionStream keeps sending plain JSON.
      const compression = typeof CompressionStream === "undefined" ? null : compressedReplaceLimits(this.capabilities ?? await this.loadCapabilities(configuration));
      const send = () => compression
        ? this.requestCompressed(configuration, "/api/v2/sync/replace", replacement, {
          ...compression,
          tooLargeMessage: "This library is too large to reset from Tagify in one step. Download a backup and contact Tagify support.",
        })
        : this.request(configuration, "/api/v2/sync/replace", replacement);
      let result;
      for (let attempt = 1; ; attempt++) {
        try {
          result = await send();
          break;
        } catch (error) {
          // Community saves a very large library in the background and stops
          // waiting after a few minutes. Asking again with the same operation
          // waits for that same save instead of starting another one.
          if (attempt < RESET_INSTALL_ATTEMPTS && error instanceof SyncHttpError && error.status === 503 && /^library_install_pending\b/.test(error.message)) continue;
          throw error;
        }
      }
      this.updateProjectionStatus(result.projection);
      const canonical = await this.downloadSnapshot(configuration, PRIVATE_SYNC_PROTOCOL_VERSION) as LibrarySnapshotV2;
      assertLibrarySnapshotV2(canonical);
      const saved = await indexedDBStorage.replaceCloudReplica(tagDataFromSnapshot(canonical), replicaManifest(configuration, canonical), stateRecordsFromSnapshot(canonical), canonical.appState);
      if (!saved) throw new Error("The reset cloud snapshot was accepted but the local replica could not be finalized");
      await applyDurableAppStateDocuments(canonical.appState, { smartPlaylistsAlreadyPersisted: true });
      await markManifestAppStateApplied();
      await this.acknowledgeCursor(configuration, canonical.headCursor);
      dispatchSyncEvent("local", operationId, []);
      this.setSettledStatus();
    } finally {
      this.cloudReplacementArmed = false;
    }
  }

  async communityRequest(path: string, options: CommunityRequestOptions = {}): Promise<any> {
    const configuration = getDesktopSyncConfiguration();
    if (!configuration) throw new Error("Community Sync is not connected");
    const active = await this.refreshIfNeeded(configuration);
    const session = options.syncHeaders === false ? { authorization: `Bearer ${active.accessToken}` } : syncClientHeaders(active.accessToken);
    const response = await fetch(`${active.apiBaseUrl}${path}`, {
      method: options.method || (options.body === undefined ? "GET" : "POST"),
      headers: { ...session, ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      this.sessionRefused(response, payload, active.accessToken);
      throw Object.assign(new Error(payload.error?.message || response.statusText), { status: response.status });
    }
    return payload;
  }

  async syncNow(automatic = false): Promise<void> {
    if (automatic && Date.now() < this.automaticRetryNotBefore) return;
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    const configuration = getDesktopSyncConfiguration();
    if (!configuration) { this.setStatus("unlinked"); return; }
    if (this.recoveryPreview) {
      if (this.status !== "restoring" && this.status !== "restore-failed") {
        this.setStatus("recovery-available");
      }
      return;
    }
    // A rejected session cannot recover by retrying; only Sync Now or reconnecting tries again.
    if (automatic && this.inactiveRefreshToken === configuration.refreshToken) { this.setStatus("reauthorize"); return; }
    if (!navigator.onLine) { this.setStatus("offline"); return; }
    // Until Community says whether anyone else uses this library, connect
    // after the run instead, so a library used alone never opens a channel.
    if (this.realtimeWanted) this.ensureRealtime(configuration);
    // Counted from now, because the account lock may be granted only after a
    // quick join has already answered.
    let beforeJoin = true;
    const pastJoin = () => {
      if (beforeJoin) this.syncsBeforeJoin--;
      beforeJoin = false;
    };
    this.syncsBeforeJoin++;
    this.running = runWithAccountSyncLock(configuration.accountId, async () => {
      // A live connection that is opening joins first. Then this run's pull
      // covers everything until Realtime announces more, and joining needs no
      // catch-up pull of its own.
      await this.waitForRealtimeJoin();
      pastJoin();
      const activeConfiguration = getDesktopSyncConfiguration();
      if (!activeConfiguration || activeConfiguration.accountId !== configuration.accountId) return;
      await this.run(activeConfiguration, !automatic);
    }).finally(() => {
      pastJoin();
      this.running = null;
      const current = getDesktopSyncConfiguration();
      if (current && this.realtimeWanted !== false) this.ensureRealtime(current);
      const realtimeHead = this.pendingRealtimeHead;
      this.pendingRealtimeHead = 0;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.syncNow(true);
      } else if (realtimeHead) {
        // Realtime announcements during the run, including this device's own
        // backup, only need another run if Community is still ahead.
        void this.handleRemoteHead(realtimeHead);
      }
    });
    return this.running;
  }

  private userSyncNow(): Promise<void> {
    if (Date.now() - this.lastUserSyncAt < 30_000) return Promise.resolve();
    this.lastUserSyncAt = Date.now();
    return this.syncNow();
  }

  private async run(configuration: DesktopSyncConfiguration, explicit = false): Promise<void> {
    this.setStatus("syncing");
    try {
      const active = await this.refreshIfNeeded(configuration);
      const capabilities = this.capabilities ?? await this.loadCapabilities(active);
      this.capabilities = capabilities;
      if ("minimumEfficientClientVersion" in capabilities && typeof capabilities.minimumEfficientClientVersion === "string" && compareVersions(CLIENT_VERSION, capabilities.minimumEfficientClientVersion) < 0) {
        throw new Error("efficient_client_required: Update Tagify to keep Community Sync running.");
      }
      this.supportsV2 = Array.isArray(capabilities.supportedProtocolVersions) && capabilities.supportedProtocolVersions.includes(PRIVATE_SYNC_PROTOCOL_VERSION);
      const manifest = await readManifest();
      const shouldRefreshSummary = !manifest || !this.backupHealth || Date.now() - this.lastLibrarySummaryAt >= LIBRARY_SUMMARY_REFRESH_MS;
      const summary = shouldRefreshSummary ? (await this.request(active, "/api/v2/library")).library : {};
      if (shouldRefreshSummary) {
        this.backupHealth = backupHealthFromSummary(summary);
        this.lastLibrarySummaryAt = Date.now();
        this.noteLibrarySummary(summary);
      }
      if (!(await this.ensureReplicaReady(active, summary))) return;
      this.deviceOnlyChangeCount = Object.keys((await getState<DeviceOnlyChangesRecord>(DEVICE_ONLY_CHANGES_KEY))?.items ?? {}).length;
      await this.refreshSettingsChoices();
      await syncPairingService.recoverLegacyReplica(active.accountId);
      await this.settleLocalAndPublicSync(active, explicit);
      if (this.backupHealthRefreshRequested) {
        const confirmedSummary = (await this.request(active, "/api/v2/library")).library;
        this.backupHealth = backupHealthFromSummary(confirmedSummary);
        this.lastLibrarySummaryAt = Date.now();
        this.backupHealthRefreshRequested = false;
      }
      this.consecutiveFailures = 0;
      this.automaticRetryNotBefore = 0;
      this.lastSuccessfulSyncAt = Date.now();
      // This run was a check too; the next safety check counts from now.
      this.scheduleSafetySync(true);
      this.setSettledStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      if (/sync_waiting/i.test(message)) {
        // Only a change Community hasn't confirmed yet is waiting; everything
        // else backed up. Retry soon without slowing the rest of sync down.
        this.consecutiveFailures = 0;
        this.automaticRetryNotBefore = Date.now() + WAITING_CHANGE_RETRY_MS;
      } else {
        this.consecutiveFailures++;
        const status = error instanceof SyncHttpError ? error.status : 0;
        const retryAfterSeconds = error instanceof SyncHttpError ? error.retryAfterSeconds : null;
        this.automaticRetryNotBefore = Date.now() + syncFailureBackoffMs(status, retryAfterSeconds, this.consecutiveFailures - 1);
      }
      if (isDefinitiveSessionFailure(message)) this.markSessionInactive(configuration);
      if (/publication_review_required/i.test(message)) this.setStatus("publication-review-required");
      else if (/projection_pending/i.test(message)) this.setStatus("publishing");
      else if (/merge_review_required/i.test(message)) this.setStatus("merge-required");
      else if (/snapshot_required/i.test(message)) this.setStatus("snapshot-required");
      else if (/device_revoked|authentication_required|session_inactive/i.test(message)) this.setStatus("reauthorize");
      else this.setStatus(navigator.onLine ? "error" : "offline");
      if (/projection_pending/i.test(message)) console.info("Tagify sync:", message);
      else console.error("Tagify sync:", message);
    }
  }

  async restoreFromCloud(): Promise<void> {
    const configuration = getDesktopSyncConfiguration();
    if (!configuration || !this.recoveryPreview) throw new Error("No cloud recovery is waiting for confirmation");
    await flushLocalPersistence();
    const queued = (await readOutbox()).filter((intent) => intent.type !== "library.snapshot" || intent.reason !== "migration");
    if (queued.length) throw new Error("Export or reconcile queued offline changes before restoring this replica");
    this.setStatus("restoring");
    window.dispatchEvent(new CustomEvent("tagify:prepareRemoteRestore"));
    try {
      const snapshot = await this.downloadSnapshot(configuration, this.supportsV2 ? PRIVATE_SYNC_PROTOCOL_VERSION : 1);
      if (snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION) assertLibrarySnapshotV2(snapshot); else assertLibrarySnapshotV1(snapshot);
      const appState = snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION ? snapshot.appState : [];
      const data = tagDataFromSnapshot(snapshot);
      const manifest = replicaManifest(configuration, snapshot);
      const saved = await indexedDBStorage.replaceCloudReplica(data, manifest, stateRecordsFromSnapshot(snapshot), appState);
      if (!saved) throw new Error("The cloud snapshot could not be committed atomically");
      await applyDurableAppStateDocuments(appState, { smartPlaylistsAlreadyPersisted: true });
      await markManifestAppStateApplied();
      await this.acknowledgeCursor(configuration, snapshot.headCursor);
      this.lastRecovered = {
        ...this.recoveryPreview,
        smartPlaylists: smartPlaylistsFromAppState(appState).length,
      };
      this.recoveryPreview = null;
      dispatchSyncEvent("remote", crypto.randomUUID(), []);
      this.setSettledStatus();
    } catch (error) {
      this.setStatus("restore-failed");
      throw error;
    }
  }

  private async ensureReplicaReady(configuration: DesktopSyncConfiguration, summary: any): Promise<boolean> {
    const manifest = await readManifest();
    if (manifest?.accountId === configuration.accountId && manifest.libraryId === configuration.libraryId) {
      if (manifest.appStateAppliedAt === null) {
        await applyDurableAppStateDocuments(Object.values(await readAppStateShadow()));
        await markManifestAppStateApplied();
      }
      return true;
    }
    const cloudHasData = Number(summary?.counts?.annotations || 0) > 0 || Number(summary?.counts?.taxonomy || 0) > 0 || Number(summary?.counts?.appState || 0) > 0;
    if (!cloudHasData) return true;
    await flushLocalPersistence();
    const local = await storageService.loadAll();
    const classification = classifyLocalReplica(local, defaultTagData.taxonomy, null);
    const meaningfulOutbox = (await readOutbox()).some((intent) => intent.type !== "library.snapshot" || intent.reason !== "migration");
    if (classification === "fresh-default" && !meaningfulOutbox) {
      this.recoveryPreview = {
        annotations: Number(summary.counts.annotations || 0), taxonomyNodes: Number(summary.counts.taxonomy || 0),
        appStateDocuments: Number(summary.counts.appState || 0), lastBackupAt: summary.lastCommittedAt || null,
        smartPlaylists: null,
        protectedDomains: summary.backupHealth?.protectedDomains || [],
      };
      this.setStatus("recovery-available");
      return false;
    }
    // A queued clear is meaningful even after the last saved item is removed.
    if (classification === "meaningful-unlinked" || meaningfulOutbox) {
      return this.reconcileInitialLibraries(configuration);
    }
    return true;
  }

  private async reconcileInitialLibraries(configuration: DesktopSyncConfiguration): Promise<boolean> {
    await flushLocalPersistence();
    if (!this.initialMergePreview || !this.initialMergeDeviceSnapshot) await this.prepareInitialMerge(configuration);
    if (canCombineInitialLibrariesWithoutReview(this.initialMergePreview)) {
      await this.commitInitialMerge({});
      return true;
    }
    this.setStatus("merge-required");
    return false;
  }

  private async captureInitialMergeDeviceSnapshot(configuration: DesktopSyncConfiguration): Promise<LibrarySnapshotV2> {
    const core = await buildLocalSnapshot(configuration.libraryId, undefined, new Date(), { includeEmptyAnnotations: true });
    // A fully cleared item can be absent from storage but still waiting to
    // back up. Keep that explicit removal in the review instead of restoring it.
    const present = new Set(core.annotations.map((annotation) => entityKeyV1(annotation.entity)));
    const queued = await readOutbox();
    for (const intent of queued) {
      if (intent.type !== "entity.delete" || present.has(entityKeyV1(intent.entity))) continue;
      core.annotations.push({ ...emptyShadow(intent.entity), deleted: true });
      present.add(entityKeyV1(intent.entity));
    }
    const appState = await buildDurableAppStateDocuments();
    const deviceSnapshot: LibrarySnapshotV2 = { ...core, protocolVersion: PRIVATE_SYNC_PROTOCOL_VERSION, appState };
    assertLibrarySnapshotV2(deviceSnapshot);
    return deviceSnapshot;
  }

  private async prepareInitialMerge(configuration: DesktopSyncConfiguration): Promise<void> {
    await flushLocalPersistence();
    const data = await storageService.loadAll();
    const deviceSnapshot = await this.captureInitialMergeDeviceSnapshot(configuration);
    const communitySnapshot = await this.downloadSnapshot(configuration, PRIVATE_SYNC_PROTOCOL_VERSION) as LibrarySnapshotV2;
    assertLibrarySnapshotV2(communitySnapshot);
    const plan = planInitialLibraryMerge(deviceSnapshot, communitySnapshot);
    this.initialMergeDeviceSnapshot = deviceSnapshot;
    this.initialMergeOperationId = crypto.randomUUID();
    this.initialMergePreview = { ...plan, labels: mergeReviewLabels(data, deviceSnapshot, communitySnapshot, plan), supported: this.capabilities?.initialMergeReviewVersion === INITIAL_MERGE_REVIEW_VERSION };
  }

  /**
   * Pulls every Community batch after this device's cursor, page by page,
   * until it reaches the head. Returns true when anything was applied.
   */
  private async pull(configuration: DesktopSyncConfiguration): Promise<boolean> {
    this.lastPullReachedHead = false;
    let applied = false;
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const cursor = await readCursor();
      const requestedAt = Date.now();
      const response = await this.requestPullPage(configuration, cursor);
      const outcome = await this.applyPullPage(configuration, cursor, response, requestedAt);
      if (outcome.applied) applied = true;
      if (outcome.done) return applied;
    }
    throw new Error("sync_pull_incomplete: Tagify is still catching up with your other devices and will continue shortly.");
  }

  private async requestPullPage(configuration: DesktopSyncConfiguration, cursor: number): Promise<PullPage> {
    if (!this.canPullDirectly(configuration)) return this.requestPullPageFromCommunity(configuration, cursor);
    try {
      return await this.pullDirectly(configuration, cursor);
    } catch (error) {
      // Changes come through Community's own address for the rest of this session.
      this.directPullUnavailable = true;
      console.warn("Tagify sync: reading changes directly failed; using Community's address this session", error instanceof Error ? error.message : error);
      // A busy database (429 or 5xx) is busy behind Community's address too:
      // asking it at once would double the load during an outage. This sync
      // stops, and the next one waits out Retry-After or the usual back-off.
      if (error instanceof SyncHttpError && isBusyStatus(error.status)) throw error;
      // Refused or unreachable (switched off, CORS, a gateway's error page):
      // Community's address answers with the same page, or reports the failure
      // the usual way (an inactive session, a pause, an outage).
      return this.requestPullPageFromCommunity(configuration, cursor);
    }
  }

  /** Community advertises `directPull` once it has checked the database's API from Spotify (docs/DESKTOP_DIRECT_PULL.md). */
  private canPullDirectly(configuration: DesktopSyncConfiguration): boolean {
    const directPull = (this.capabilities as { directPull?: { rpc?: unknown } } | null)?.directPull;
    return !this.directPullUnavailable && directPull?.rpc === DIRECT_PULL_FUNCTION && Boolean(configuration.supabaseUrl && configuration.supabasePublishableKey);
  }

  /**
   * Reads the same page from the database's API (PostgREST), without a
   * website request. The function checks this device's session itself.
   */
  private async pullDirectly(configuration: DesktopSyncConfiguration, cursor: number): Promise<PullPage> {
    const response = await fetch(`${configuration.supabaseUrl}/rest/v1/rpc/${DIRECT_PULL_FUNCTION}`, {
      method: "POST",
      headers: { apikey: configuration.supabasePublishableKey, authorization: `Bearer ${configuration.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ p_device_id: configuration.deviceId, p_after_cursor: cursor, p_limit: PULL_PAGE_SIZE, p_direct: true }),
    });
    if (!response.ok) {
      throw new SyncHttpError(
        `${isBusyStatus(response.status) ? "sync_unavailable" : "direct_pull_refused"}: reading changes directly answered ${response.status}`,
        response.status,
        retryAfterSeconds(response.headers.get("retry-after")),
      );
    }
    const page: unknown = await response.json();
    if (!isPullPage(page)) throw new Error("direct pull returned an unexpected page");
    return page as PullPage;
  }

  /**
   * Spotify checks with Community before every signed-in request (a CORS
   * preflight) and remembers the answer per address for up to two hours. A
   * cursor in the address made every pull a new address and a second request;
   * newer Community servers read it from the body, so one address serves all.
   */
  private async requestPullPageFromCommunity(configuration: DesktopSyncConfiguration, cursor: number): Promise<PullPage> {
    const ifNoneMatch = `"sync-cursor-${cursor}"`;
    const query = `/api/v2/sync/pull?deviceId=${encodeURIComponent(configuration.deviceId)}&after=${cursor}&limit=${PULL_PAGE_SIZE}`;
    if (!this.hasCapability("pullRequestBody") || this.pullRequestBodyUnavailable) return this.request(configuration, query, undefined, ifNoneMatch);
    try {
      return await this.request(configuration, "/api/v2/sync/pull", { deviceId: configuration.deviceId, after: cursor, limit: PULL_PAGE_SIZE }, ifNoneMatch);
    } catch (error) {
      // Community answered, and not because the route is missing or refuses POST.
      if (error instanceof SyncHttpError && error.status !== 404 && error.status !== 405) throw error;
      // A Community rolled back after advertising it (a refused POST may also
      // surface as a failed request): read changes the older way this session.
      const response = await this.request(configuration, query, undefined, ifNoneMatch);
      this.pullRequestBodyUnavailable = true;
      console.warn("Tagify sync: Community did not accept the newer change request; using the earlier one");
      return response;
    }
  }

  /**
   * Applies one page of Community changes after `cursor`, from a pull or from
   * the later changes a push returned. `done` once nothing more is waiting.
   */
  private async applyPullPage(configuration: DesktopSyncConfiguration, cursor: number, response: PullPage, requestedAt: number): Promise<{ applied: boolean; done: boolean }> {
    this.lastPullReachedHead = false;
    this.lastSideDocuments = this.hasCapability("pullSideDocuments") && !response.snapshotRequired ? pullSideDocuments(response) : null;
    // Community learns what this Tagify can do once per start, after a pull shows the session works.
    this.reportDesktopFeaturesOnce(configuration);
    // A request made while this computer was off is answered on its next pull.
    this.handleSpotifyLibraryRequest(this.lastSideDocuments?.spotifyLibraryRequestedAt);
    if (this.lastSideDocuments?.spotifySavesWaiting) this.handleSpotifySaves();
    this.handleArtistCredits(configuration);
    this.handleSongReleases(configuration);
    this.pollPlaylistWrites();
    this.noteLiveSync(response);
    if (response.unchanged) {
      this.noteHeadReached(requestedAt);
      return { applied: false, done: true };
    }
    // A remote update can arrive during the UI's short save debounce. Commit
    // those edits first so rehydrating from IndexedDB cannot discard them.
    await flushLocalPersistence();
    if (response.snapshotRequired) {
      await this.replaceWithRequiredSnapshot(configuration);
      return { applied: true, done: true };
    }
    let applied = false;
    const batches = response.batches || [];
    for (const batch of batches) {
      if (await this.applyPulledBatch(batch, response.conflicts || [])) applied = true;
    }
    const appliedCursor = Math.max(cursor, batches.at(-1)?.cursor ?? cursor);
    if (batches.length || cursor < Number(response.headCursor || 0)) {
      await this.acknowledgeCursor(configuration, appliedCursor);
    }
    if (batches.length) this.resetRecoverySchedule();
    if (!batches.length || appliedCursor >= Number(response.headCursor || 0)) {
      // A reply that names no cursor never counts as caught up.
      const headCursor = response.headCursor;
      if (typeof headCursor === "number" && Number.isSafeInteger(headCursor) && appliedCursor >= headCursor) this.noteHeadReached(requestedAt);
      return { applied, done: true };
    }
    return { applied, done: false };
  }

  /** `requestedAt` is when the answer was asked for: anything committed after it is still to come. */
  private noteHeadReached(requestedAt: number): void {
    this.lastPullReachedHead = true;
    this.headConfirmedAt = Math.max(this.headConfirmedAt, requestedAt);
  }

  /**
   * True when this device already holds Community's newest changes: a reply
   * reached the head while Realtime was connected, the connection has stayed
   * up since, and it has announced nothing newer. Only then can an edit run
   * skip its catch-up pull, because the push brings back anything later.
   */
  private async knownToBeAtHead(): Promise<boolean> {
    return this.hasCapability("pushReturnsLaterBatches")
      && this.headConfirmedAt > 0
      && this.realtimeCoverage() !== "down"
      && (this.isRealtimeLive() || this.realtimeWanted === false)
      && this.announcedHead <= await readCursor();
  }

  private async replaceWithRequiredSnapshot(configuration: DesktopSyncConfiguration): Promise<void> {
    // A whole-library upload must go through the library review instead.
    if ((await readOutbox()).some((intent) => intent.type === "library.snapshot")) throw new Error("snapshot_required: export or reconcile queued offline changes before replacing this replica");
    const snapshot = await this.downloadSnapshot(configuration, this.supportsV2 ? PRIVATE_SYNC_PROTOCOL_VERSION : 1);
    if (snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION) assertLibrarySnapshotV2(snapshot); else assertLibrarySnapshotV1(snapshot);
    const appState = snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION ? snapshot.appState : [];
    // Save edits made during the download so they are queued and kept.
    await flushLocalPersistence();
    window.dispatchEvent(new CustomEvent("tagify:prepareRemoteRestore"));
    const localDrafts = await capturePendingAppState();
    const saved = await indexedDBStorage.replaceCloudReplica(tagDataFromSnapshot(snapshot), replicaManifest(configuration, snapshot), [
      ...stateRecordsFromSnapshot(snapshot), ...localDrafts.map((draft) => ({ key: `pending-app-state:${draft.domain}`, ...draft })),
    ], appState, localDrafts, { keepQueuedEdits: true, annotationDates: "canonical" });
    if (!saved) throw new Error("The compacted cloud snapshot could not be committed atomically");
    if ((await readOutbox()).some((intent) => intent.type === "taxonomy.replace")) this.taxonomyRefreshRequested = true;
    await applyDurableAppStateDocuments([
      ...appState.filter((document) => !localDrafts.some((draft) => draft.domain === document.domain)), ...localDrafts,
    ], { smartPlaylistsAlreadyPersisted: true });
    await markManifestAppStateApplied();
    await this.acknowledgeCursor(configuration, snapshot.headCursor);
    dispatchSyncEvent("remote", crypto.randomUUID(), []);
    console.info("Tagify sync: replaced a compacted replica with the canonical snapshot", { headCursor: snapshot.headCursor, annotationCount: snapshot.annotations.length });
    this.resetRecoverySchedule();
  }

  /** Applies one pulled batch atomically. Returns false when it was already applied. */
  private async applyPulledBatch(batch: PullBatch, conflicts: SyncConflictV1[]): Promise<boolean> {
    if (batch.cursor <= await readCursor()) return false;
    const own = this.ownBatchIds.has(batch.batchId);
    const appStateOperations = batch.operations.filter((operation): operation is AppStateReplaceMutationV2 => operation.type === "app-state.replace");
    const keepLocalAppState = own ? new Map<DurableAppStateDomain, DurableAppStateDocumentV2 | null>() : await this.applyRemoteAppState(appStateOperations);
    const annotations = batch.operations.filter(isAnnotationMutation);
    const urisFor = (key: keyof LibraryRecords) => annotations.filter((operation) => recordKeyFor(operation.entity) === key).map((operation) => entityUri(operation.entity));
    const hasTaxonomy = batch.operations.some((operation) => operation.type !== "app-state.replace" && !isAnnotationMutation(operation));
    const outcome = await indexedDBStorage.runSyncTransaction({
      tracks: urisFor("tracks"), playlists: urisFor("playlists"), artists: urisFor("artists"),
      taxonomy: hasTaxonomy,
      stateKeys: ["cursor", "replica-manifest", ...(hasTaxonomy ? ["taxonomy-shadow"] : []), ...annotations.map((operation) => `entity:${entityKeyV1(operation.entity)}`)],
      appStateDomains: appStateOperations.map((operation) => operation.domain),
    }, (context) => planPulledBatch(context, batch, { own, keepLocalAppState, conflicts }));
    if (outcome.skipped) return false;
    if (outcome.taxonomyShadowOnly) this.taxonomyRefreshRequested = true;
    // Changes this device sent are already shown; only other devices' changes
    // ask the open views to reload.
    if (!own) dispatchSyncEvent("remote", batch.batchId, batch.operations);
    return true;
  }

  /**
   * Shows another device's saved settings unless this device changed the same
   * settings and has not backed them up; that local copy is kept and returned
   * so it can be offered as a choice instead of being overwritten.
   */
  private async applyRemoteAppState(operations: AppStateReplaceMutationV2[]): Promise<Map<DurableAppStateDomain, DurableAppStateDocumentV2 | null>> {
    const decisions = new Map<DurableAppStateDomain, DurableAppStateDocumentV2 | null>();
    if (!operations.length) return decisions;
    const shadow = await readAppStateShadow();
    const local = new Map((await buildDurableAppStateDocuments()).map((document) => [document.domain, document]));
    for (const operation of operations) {
      if (operation.domain === "preferences") continue;
      const saved = shadow[operation.domain];
      const pending = await getState<DurableAppStateDocumentV2>(`pending-app-state:${operation.domain}`);
      const document = local.get(operation.domain);
      const changedHere = Boolean(pending) || Boolean(saved && document && !durableStateEquals(saved.value, document.value));
      if (document && changedHere && !durableStateEquals(document.value, operation.value)) {
        decisions.set(operation.domain, { ...document, revision: pending?.revision ?? saved?.revision ?? 0 });
      } else {
        const applied: DurableAppStateDocumentV2 = { domain: operation.domain, value: operation.value, revision: acceptedRevision(operation.expectedRevision, saved?.revision ?? 0), updatedAt: new Date().toISOString() };
        await applyDurableAppStateDocuments([applied]);
        decisions.set(operation.domain, null);
        if (document) local.set(operation.domain, { ...document, value: operation.value });
      }
      shadow[operation.domain] = { domain: operation.domain, value: operation.value, revision: acceptedRevision(operation.expectedRevision, saved?.revision ?? 0), updatedAt: new Date().toISOString() };
    }
    return decisions;
  }

  private hasCapability(name: "pullSideDocuments" | "pullAcknowledgesCursor" | "pushReturnsLaterBatches" | "pullRequestBody" | "liveSyncHints"): boolean {
    return (this.capabilities as Record<string, unknown> | null)?.[name] === true;
  }

  /**
   * Newer Community servers record the cursor each pull starts from, so the
   * next pull acknowledges what this device applied without another request.
   */
  private async acknowledgeCursor(configuration: DesktopSyncConfiguration, cursor: number): Promise<void> {
    if (this.hasCapability("pullAcknowledgesCursor")) return;
    await this.request(configuration, "/api/v2/sync/ack", { deviceId: configuration.deviceId, cursor });
  }

  private async settleLocalAndPublicSync(configuration: DesktopSyncConfiguration, explicit = false): Promise<void> {
    let passes = 0;
    let unconfirmedPasses = 0;
    let repaired = false;
    let waiting = false;
    let caughtUp = false;
    // A run that sends nothing while this device is current makes no request,
    // so it relies on the revisions from the latest reply.
    if (!(await this.knownToBeAtHead())) this.lastSideDocuments = null;
    for (;;) {
      // Whether the latest pull of this round reached Community's newest cursor.
      let pulledToHead = false;
      let editsBeforeLastCheck = this.localEditCount;
      // Send queued edits until Community confirms every one of them.
      while (passes++ < 1_000) {
        await flushLocalPersistence();
        // Every edit committed before this point is in the outbox, local
        // tracks, or notes read below, so a pending edit-triggered sync for it
        // can be skipped once this round settles.
        editsBeforeLastCheck = this.localEditCount;
        const firstIntent = (await readOutbox())[0];
        if (!firstIntent) break;
        // Catch up first so only this device's own changes are sent and a
        // confirmed copy is compared with Community's latest state. Realtime
        // already says when this device is current; then the push alone
        // brings back anything that arrived in the meantime.
        if (firstIntent.type !== "library.snapshot" && !caughtUp) {
          if (await this.knownToBeAtHead()) pulledToHead = true;
          else {
            await this.pull(configuration);
            pulledToHead = this.lastPullReachedHead;
          }
        }
        const outcome = await this.push(configuration);
        // Confirming queued edits sends nothing, so there is nothing new to pull.
        caughtUp = outcome.sent === 0 && !outcome.snapshot;
        if (!caughtUp) {
          // Newer Community servers return the changes after this device's
          // cursor, its own included, with the push.
          if (!outcome.laterApplied) await this.pull(configuration);
          pulledToHead = this.lastPullReachedHead;
        }
        caughtUp = true;
        await this.refreshDeviceTaxonomyAfterBackup();
        if (outcome.accepted || outcome.confirmed || outcome.snapshot) { unconfirmedPasses = 0; continue; }
        // Community accepted nothing twice in a row. Its revisions may differ
        // from this device's copy: refresh that copy once, then wait.
        unconfirmedPasses++;
        if (unconfirmedPasses === 2 && !repaired && Date.now() - this.lastShadowRepairAt >= SHADOW_REPAIR_INTERVAL_MS) {
          repaired = true;
          this.lastShadowRepairAt = Date.now();
          await this.repairShadowFromCloud(configuration);
          continue;
        }
        if (unconfirmedPasses >= 3) { waiting = true; break; }
      }
      if (passes > 1_000) throw new Error("snapshot_required: local changes continued arriving before Sync Now could settle");

      // A pull after a backup reached Community's newest cursor moments ago.
      // While Realtime is live, anything committed since then is announced and
      // handled once this sync finishes, so another pull here would come back
      // unchanged; the same holds when nobody else uses the library. Without
      // a live connection, or after a newer announcement, pull as usual.
      const skipPull = pulledToHead && (this.isRealtimeSubscribed() || this.realtimeWanted === false) && this.pendingRealtimeHead <= await readCursor();
      if (!skipPull) await this.pull(configuration);
      await this.pushDurableAppState(configuration);
      // Community's pull reports whether local files or notes changed elsewhere;
      // unchanged ones are not read again, while local changes still upload.
      // (Read through a cast: TypeScript keeps the reset above narrowed across the awaits.)
      const sideDocuments = this.lastSideDocuments as PullSideDocuments | null;
      if (this.localFileBackoff.shouldRun(Date.now(), explicit)) {
        if (await this.syncLocalFileBackup(configuration, sideDocuments?.localFilesRevision)) this.localFileBackoff.succeeded();
        else this.localFileBackoff.failed();
      }
      if (this.privateNotesBackoff.shouldRun(Date.now(), explicit)) {
        if (await syncPrivateNotes(configuration, (this.capabilities as { privateNotes?: { enabled?: boolean } })?.privateNotes?.enabled === true, { remoteCursor: sideDocuments?.privateNotesCursor })) this.privateNotesBackoff.succeeded();
        else this.privateNotesBackoff.failed();
      }
      this.notifyBackupHealthChanged();
      await flushLocalPersistence();
      if (waiting) throw new Error("sync_waiting: Some changes are still waiting to back up. They stay on this device and Tagify will try again.");
      if (!(await readOutbox()).length) {
        this.settledEditCount = Math.max(this.settledEditCount, editsBeforeLastCheck);
        return;
      }
    }
  }

  /**
   * Sends queued edits. An intent leaves the outbox only once Community's
   * confirmed copy (the shadow, current after a pull) already holds every
   * change it describes; anything rejected, skipped, or unconfirmed is sent
   * again with Community's latest revisions instead of being dropped.
   */
  private async push(configuration: DesktopSyncConfiguration): Promise<PushOutcome> {
    const intents = await readOutbox();
    if (!intents.length) return { sent: 0, accepted: 0, confirmed: 0, snapshot: false, laterApplied: false };
    const plan = coalesceOutboxIntents(intents);
    const snapshotIntent = plan.intents[0]?.type === "library.snapshot" ? plan.intents[0] : null;
    if (snapshotIntent) {
      if (snapshotIntent.reason === "reset") throw new Error("intentional_cloud_reset_requires_confirmation");
      await this.bootstrap(configuration, snapshotIntent.id, snapshotIntent.batchId, snapshotIntent.createdAt);
      await deleteOutbox([snapshotIntent.id]);
      return { sent: 0, accepted: 0, confirmed: 1, snapshot: true, laterApplied: false };
    }
    const operations: SyncMutationV1[] = [];
    const confirmedIds: string[] = [];
    const deviceOnly = new Map<string, Array<{ operation: SyncMutationV1; reason: string }>>();
    // One read for every item's confirmed copy instead of one per item.
    const shadows = await indexedDBStorage.runSyncTransaction({
      stateKeys: plan.groups.flatMap((group) => group.intent.type === "entity.replace" || group.intent.type === "entity.delete" ? [`entity:${entityKeyV1(group.intent.entity)}`] : []),
    }, (context) => ({ result: context.state }));
    for (const group of plan.groups) {
      const entity = group.intent.type === "entity.replace" || group.intent.type === "entity.delete" ? group.intent.entity : null;
      const shadow = entity ? (shadows[`entity:${entityKeyV1(entity)}`] as ShadowRecord | undefined)?.annotation ?? emptyShadow(entity) : undefined;
      const { supported, unsupported } = partitionSupportedOperations(await materializeIntent(group.intent, group.edits, shadow));
      deviceOnly.set(group.key, unsupported);
      if (!supported.length) {
        confirmedIds.push(...group.ids);
        // An edit Community already holds may still leave other devices'
        // taxonomy changes to show here.
        if (group.intent.type === "taxonomy.replace") this.taxonomyRefreshRequested = true;
        continue;
      }
      if (operations.length + supported.length > MAX_SYNC_BATCH_OPERATIONS) {
        // A single edit larger than one batch sends a first slice; the rest
        // follows once the pull confirms it.
        if (!operations.length) operations.push(...supported.slice(0, MAX_SYNC_BATCH_OPERATIONS));
        break;
      }
      operations.push(...supported);
    }
    await this.noteDeviceOnlyChanges(deviceOnly);
    if (confirmedIds.length) await deleteOutbox(confirmedIds);
    if (!operations.length) return { sent: 0, accepted: 0, confirmed: confirmedIds.length, snapshot: false, laterApplied: false };
    const sent = await withContentOperationIds(operations);
    const batchId = await stableUuid(`push:${this.batchSalt}`, await sha256Hex(stableJson(sent)));
    this.rememberOwnBatch(batchId);
    const baseCursor = await readCursor();
    const batch: SyncBatchV1 = {
      protocolVersion: 1,
      batchId,
      deviceId: configuration.deviceId,
      baseCursor,
      operations: sent,
    };
    const askForLater = this.hasCapability("pushReturnsLaterBatches");
    const requestedAt = Date.now();
    let result;
    try {
      result = await this.request(configuration, `/api/v2/sync/push${askForLater ? "?later=1" : ""}`, batch);
    } catch (error) {
      // Community already holds a different batch under this name: nothing
      // was applied, so send the same changes again under a new name.
      if (/batch_id_reused/i.test(error instanceof Error ? error.message : "")) {
        this.batchSalt = crypto.randomUUID();
        return { sent: sent.length, accepted: 0, confirmed: confirmedIds.length, snapshot: false, laterApplied: false };
      }
      throw error;
    }
    this.updateProjectionStatus(result.projection);
    // Community can save new changes under its own batch name; its echo is
    // still this device's own change.
    if (typeof result.batchId === "string" && result.batchId !== batchId) this.rememberOwnBatch(result.batchId);
    const sentIds = new Set(sent.map((operation) => operation.operationId));
    const accepted = ((result.changes || []) as SyncMutationV1[]);
    if (result.duplicate === true && accepted.some((operation) => !sentIds.has(operation.operationId))) {
      // Community holds a different batch under this name. Nothing is counted
      // as sent; the next attempt uses a new name.
      console.error("Tagify sync: Community confirmed a different batch; sending again", { batchId });
      this.batchSalt = crypto.randomUUID();
      return { sent: sent.length, accepted: 0, confirmed: confirmedIds.length, snapshot: false, laterApplied: false };
    }
    dispatchSyncEvent("local", batchId, accepted.filter((operation) => sentIds.has(operation.operationId)));
    // The changes after this device's cursor, its own echo included, answer
    // the same question a pull would. Without them (an older Community, or a
    // read that failed after the save) the caller pulls instead.
    let laterApplied = false;
    if (askForLater && isPullPage(result.later) && await readCursor() === baseCursor) {
      laterApplied = (await this.applyPullPage(configuration, baseCursor, result.later as PullPage, requestedAt)).done;
    }
    return { sent: sent.length, accepted: accepted.length, confirmed: confirmedIds.length, snapshot: false, laterApplied };
  }

  private rememberOwnBatch(batchId: string): void {
    this.ownBatchIds.add(batchId);
    while (this.ownBatchIds.size > 1_000) this.ownBatchIds.delete(this.ownBatchIds.values().next().value as string);
  }

  /**
   * Values Community cannot hold stay on this device. Keep a visible count of
   * the items affected; it clears once an item's later changes back up.
   */
  private async noteDeviceOnlyChanges(changes: Map<string, Array<{ operation: SyncMutationV1; reason: string }>>): Promise<void> {
    const hasUnsupported = [...changes.values()].some((unsupported) => unsupported.length);
    if (!hasUnsupported && this.deviceOnlyChangeCount === 0) return;
    const record = await getState<DeviceOnlyChangesRecord>(DEVICE_ONLY_CHANGES_KEY);
    const items = { ...(record?.items ?? {}) };
    let changed = false;
    for (const [key, unsupported] of changes) {
      if (unsupported.length) {
        for (const { operation, reason } of unsupported) console.warn("Tagify sync: kept an unsupported change on this device only", { type: operation.type, reason });
        if (items[key]) continue;
        items[key] = { types: [...new Set(unsupported.map(({ operation }) => operation.type))], at: new Date().toISOString() };
        changed = true;
      } else if (items[key]) {
        delete items[key];
        changed = true;
      }
    }
    if (!changed) return;
    const keys = Object.keys(items);
    for (const old of keys.slice(0, Math.max(0, keys.length - 500))) delete items[old];
    await putState({ key: DEVICE_ONLY_CHANGES_KEY, items } as DeviceOnlyChangesRecord);
    this.deviceOnlyChangeCount = Object.keys(items).length;
    this.notifyBackupHealthChanged();
  }

  /**
   * When Community keeps rejecting changes, this device's record of
   * Community's revisions may be out of date (older versions could count a
   * change twice). Refresh the records the queued edits depend on from the
   * current cloud copy. Library records on this device are not changed.
   */
  private async repairShadowFromCloud(configuration: DesktopSyncConfiguration): Promise<void> {
    const cursor = await readCursor();
    const snapshot = await this.downloadSnapshot(configuration, this.supportsV2 ? PRIVATE_SYNC_PROTOCOL_VERSION : 1);
    if (snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION) assertLibrarySnapshotV2(snapshot); else assertLibrarySnapshotV1(snapshot);
    // A newer cloud copy also holds changes this device has not shown yet.
    if (snapshot.headCursor !== cursor) return;
    const queued = new Set((await readOutbox()).flatMap((intent) => intent.type === "entity.replace" || intent.type === "entity.delete" ? [entityKeyV1(intent.entity)] : []));
    const annotations = snapshot.annotations.filter((annotation) => queued.has(entityKeyV1(annotation.entity)));
    const previous = await readTaxonomyShadow();
    const records = stateRecordsFromSnapshot({ ...snapshot, annotations }).filter((record) => (record as { key?: string }).key !== "cursor");
    const repaired = records.map((record) => (record as { key?: string }).key === "taxonomy-shadow"
      ? keepTaxonomyTombstones(record as TaxonomyShadowRecord, previous)
      : record);
    await indexedDBStorage.runSyncTransaction({ stateKeys: ["cursor"] }, (context) => {
      if (((context.state.cursor as CursorRecord | undefined)?.value ?? 0) !== cursor) return { result: undefined };
      return { state: repaired, result: undefined };
    });
    console.info("Tagify sync: refreshed Community revisions for queued changes", { annotations: annotations.length });
  }

  /**
   * While this device had an unsent taxonomy edit, incoming taxonomy changes
   * were recorded only in the sync shadow. Once every taxonomy edit is backed
   * up, show the combined result on this device. Items Community has never
   * received stay; only items it removed disappear.
   */
  private async refreshDeviceTaxonomyAfterBackup(): Promise<void> {
    if (!this.taxonomyRefreshRequested) return;
    await flushLocalPersistence();
    const outcome = await indexedDBStorage.runSyncTransaction({ taxonomy: true, stateKeys: ["taxonomy-shadow"] }, (context) => {
      if (context.outbox.some((intent) => intent.type === "taxonomy.replace" || intent.type === "library.snapshot")) return { result: "waiting" as const };
      const shadow = (context.state["taxonomy-shadow"] as TaxonomyShadowRecord | undefined) ?? emptyTaxonomyShadow();
      const current = context.taxonomy ?? createEmptyTaxonomy();
      const next = rebuildDeviceTaxonomy(taxonomyFromShadowRecord(shadow), current, knownCloudTaxonomy(shadow));
      return stableTaxonomyJson(next) === stableTaxonomyJson(current) ? { result: "unchanged" as const } : { taxonomy: next, result: "changed" as const };
    });
    if (outcome === "waiting") return;
    this.taxonomyRefreshRequested = false;
    if (outcome === "changed") dispatchSyncEvent("remote", crypto.randomUUID(), []);
  }

  /**
   * Local files sit outside the Spotify-ID protocol and use Community's
   * separate owner-only backup. A failure here is retried with back-off and
   * never stops the rest of the library from backing up.
   */
  private async syncLocalFileBackup(configuration: DesktopSyncConfiguration, remoteRevision?: number): Promise<boolean> {
    const capability = (this.capabilities as { localFileBackup?: { enabled?: boolean; maxRequestBytes?: number; knownRevisionQuery?: boolean } } | null)?.localFileBackup;
    if (!capability?.enabled) return true;
    try {
      await flushLocalPersistence();
      const shadow = await getState<LocalFileBackupShadow>(LOCAL_FILE_BACKUP_SHADOW_KEY);
      let known = shadow?.entries ?? {};
      let revision = shadow?.revision ?? -1;
      let readRevision = shadow?.readRevision;
      const knownRevisionQuery = capability.knownRevisionQuery === true;
      // This device already applied the revision Community just reported. With
      // `known=` reads, Community must also have recorded this device reading
      // it: after this device's own write, one small confirming read does that.
      const unchanged = revision >= 0 && remoteRevision === revision && (!knownRevisionQuery || readRevision === revision);
      const remote = unchanged ? null : await this.readLocalFileBackup(configuration, revision, knownRevisionQuery);
      if (!unchanged && !remote) readRevision = revision;
      if (remote) {
        const plan = planIncomingLocalFiles(remote.entries, localFileTracks((await storageService.loadAll()).tracks), known);
        for (const uri of plan.remove) {
          if (!(await storageService.deleteTrack(uri, { captureSync: false }))) throw new Error("A local file from Community could not be removed on this device");
        }
        for (const [uri, track] of Object.entries(plan.save)) {
          if (!(await storageService.saveTrack(uri, track, { captureSync: false }))) throw new Error("A local file from Community could not be saved on this device");
        }
        if (plan.remove.length || Object.keys(plan.save).length) dispatchSyncEvent("remote", crypto.randomUUID(), []);
        known = remote.entries;
        revision = remote.revision;
        readRevision = remote.revision;
      }
      const outgoing = planOutgoingLocalFiles(localFileEntries((await storageService.loadAll()).tracks), known, Date.now());
      if (Object.keys(outgoing).length) {
        let expected = revision;
        for (const chunk of chunkLocalFileEntries(outgoing, Math.max(10_000, (capability.maxRequestBytes ?? 1_000_000) - 100_000))) {
          const result = await this.sendLocalFileBackup(configuration, chunk);
          if (result.changed) expected += 1;
          revision = result.revision;
        }
        known = { ...known, ...outgoing };
        // Another device wrote meanwhile: read the whole backup next time.
        if (revision !== expected) revision = -1;
      }
      await putState({ key: LOCAL_FILE_BACKUP_SHADOW_KEY, revision, entries: known, ...(readRevision === undefined ? {} : { readRevision }) } as LocalFileBackupShadow);
      this.localFilesRetrying = false;
      return true;
    } catch (error) {
      this.localFilesRetrying = true;
      console.warn("Tagify sync: local-file backup will retry", error instanceof Error ? error.message : error);
      return false;
    }
  }

  private async readLocalFileBackup(configuration: DesktopSyncConfiguration, knownRevision: number, knownRevisionQuery = false): Promise<{ revision: number; entries: LocalFileEntries } | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const entries: LocalFileEntries = {};
      let after: string | null = null;
      let revision: number | null = null;
      let restarted = false;
      do {
        // Newer servers answer `known=<revision>` with a small unchanged reply;
        // older ones only understand If-None-Match.
        const askKnown = after === null && knownRevision >= 0 && knownRevisionQuery;
        const query: URLSearchParams = new URLSearchParams({ deviceId: configuration.deviceId, ...(after ? { after } : {}), ...(askKnown ? { known: String(knownRevision) } : {}) });
        const url = `${configuration.apiBaseUrl}/api/v2/sync/local-files?${query}`;
        const conditional = after === null && knownRevision >= 0 && !knownRevisionQuery && this.conditionalLocalFileReads;
        let response: Response;
        try {
          response = await fetch(url, {
            headers: { ...syncClientHeaders(configuration.accessToken), ...(conditional ? { "if-none-match": `"local-files-${knownRevision}"` } : {}) },
          });
        } catch (error) {
          if (!conditional) throw error;
          // Spotify reports Community's empty "not modified" reply as a failed
          // request. If a plain read works, keep using plain reads this session.
          response = await fetch(url, { headers: syncClientHeaders(configuration.accessToken) });
          this.conditionalLocalFileReads = false;
        }
        if (response.status === 304) return null;
        const payload: { unchanged?: unknown; revision?: unknown; entries?: LocalFileEntries; nextAfter?: unknown; error?: { code?: string; message?: string } } = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.sessionRefused(response, payload, configuration.accessToken);
          throw syncResponseError(response, payload);
        }
        // Community may answer an unchanged backup with a small success reply instead of a 304.
        if (after === null && payload.unchanged === true) return null;
        if (revision !== null && payload.revision !== revision) { restarted = true; break; }
        revision = Number(payload.revision);
        Object.assign(entries, payload.entries || {});
        after = typeof payload.nextAfter === "string" ? payload.nextAfter : null;
      } while (after);
      if (!restarted && revision !== null) return { revision, entries };
    }
    throw new Error("The local-file backup kept changing while it was read");
  }

  private async sendLocalFileBackup(configuration: DesktopSyncConfiguration, entries: LocalFileEntries): Promise<{ revision: number; changed: boolean }> {
    const response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/local-files`, {
      method: "PUT",
      headers: { ...syncClientHeaders(configuration.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: configuration.deviceId, entries }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      this.sessionRefused(response, payload, configuration.accessToken);
      throw syncResponseError(response, payload);
    }
    return { revision: Number(payload.revision), changed: payload.changed === true };
  }

  /**
   * Backs up changed saved settings. Community's copy is recorded as soon as
   * it accepts a document, so later edits build on this device's own write.
   * When the same settings also changed on another device, this device's copy
   * is never overwritten: it stays here and the user chooses which to keep.
   */
  private async pushDurableAppState(configuration: DesktopSyncConfiguration): Promise<void> {
    if (!this.supportsV2) return;
    await indexedDBStorage.runSyncTransaction({}, () => ({ deleteState: ["pending-app-state:preferences", `${APP_STATE_CHOICE_PREFIX}preferences`], result: undefined }));
    const shadow = await readAppStateShadow();
    const savedSmartPlaylists = shadow["smart-playlists"];
    if (Array.isArray(savedSmartPlaylists?.value) &&
        savedSmartPlaylists.value.length > 0 &&
        !wereSmartPlaylistsExplicitlyCleared() &&
        (await indexedDBStorage.getAllSmartPlaylists()).length === 0) {
      await applyDurableAppStateDocuments([savedSmartPlaylists]);
    }
    const documents = await buildDurableAppStateDocuments();
    const changed: DurableAppStateDocumentV2[] = [];
    const oversized = new Set<DurableAppStateDomain>();
    for (const document of documents) {
      const saved = shadow[document.domain];
      const pending = await getState<DurableAppStateDocumentV2>(`pending-app-state:${document.domain}`);
      const choice = await getState<AppStateChoiceRecord>(`${APP_STATE_CHOICE_PREFIX}${document.domain}`);
      const matchesCloud = Boolean(saved) && durableStateEquals(saved?.value, document.value);
      if (matchesCloud) {
        // Nothing left to send; any earlier choice is settled.
        if (pending || choice) await indexedDBStorage.runSyncTransaction({}, () => ({ deleteState: [`pending-app-state:${document.domain}`, `${APP_STATE_CHOICE_PREFIX}${document.domain}`], result: undefined }));
        continue;
      }
      if (choice && choice.keep !== "device") continue;
      if (durableStateStoredByteLength(document.value) > MAX_APP_STATE_DOCUMENT_BYTES) {
        oversized.add(document.domain);
        if (!this.oversizedAppStateDomains.has(document.domain)) {
          console.warn("Tagify sync: a saved-settings document is too large for Community and stays on this device", { domain: document.domain, bytes: durableStateStoredByteLength(document.value) });
        }
        continue;
      }
      // Keeping this device's copy replaces Community's latest one.
      const revision = choice?.keep === "device" ? saved?.revision ?? 0 : pending?.revision ?? saved?.revision ?? 0;
      changed.push({ ...document, revision });
    }
    this.setOversizedAppStateDomains(oversized);
    if (!changed.length) {
      if (Array.isArray(savedSmartPlaylists?.value) && savedSmartPlaylists.value.length === 0) clearExplicitSmartPlaylistClear();
      await this.refreshSettingsChoices();
      return;
    }
    const conflicted: DurableAppStateDocumentV2[] = [];
    for (const group of appStatePushGroups(changed)) {
      const seed = crypto.randomUUID();
      const operations: AppStateReplaceMutationV2[] = await Promise.all(group.map(async (document) => ({
        type: "app-state.replace" as const,
        operationId: await stableUuid(seed, document.domain),
        origin: "desktop" as const,
        domain: document.domain,
        value: document.value,
        expectedRevision: document.revision,
      })));
      this.rememberOwnBatch(seed);
      const result = await this.request(configuration, "/api/v2/sync/push", {
        protocolVersion: PRIVATE_SYNC_PROTOCOL_VERSION,
        batchId: seed,
        deviceId: configuration.deviceId,
        baseCursor: await readCursor(),
        operations,
      });
      this.updateProjectionStatus(result.projection);
      const acceptedIds = new Set(((result.changes || []) as AppStateReplaceMutationV2[]).map((operation) => operation.operationId));
      const accepted = group.filter((_, index) => acceptedIds.has(operations[index].operationId));
      const rejected = group.filter((_, index) => !acceptedIds.has(operations[index].operationId));
      const updatedAt = new Date().toISOString();
      await indexedDBStorage.runSyncTransaction({}, () => ({
        appState: accepted.map((document) => ({ ...document, revision: document.revision + 1, updatedAt })),
        deleteState: accepted.flatMap((document) => [`pending-app-state:${document.domain}`, `${APP_STATE_CHOICE_PREFIX}${document.domain}`]),
        state: rejected.flatMap((document) => [
          { key: `pending-app-state:${document.domain}`, ...document },
          { key: `${APP_STATE_CHOICE_PREFIX}${document.domain}`, domain: document.domain, createdAt: updatedAt } as AppStateChoiceRecord,
        ]),
        result: undefined,
      }));
      if (accepted.some((document) => document.domain === "smart-playlists")) clearExplicitSmartPlaylistClear();
      conflicted.push(...rejected);
    }
    await this.refreshSettingsChoices();
    if (conflicted.length) {
      Spicetify.showNotification("Some saved settings changed on another device too. Open Cloud Sync to choose which to keep.", false, 10000);
    }
  }

  private setOversizedAppStateDomains(domains: Set<DurableAppStateDomain>): void {
    const same = domains.size === this.oversizedAppStateDomains.size && [...domains].every((domain) => this.oversizedAppStateDomains.has(domain));
    if (same) return;
    this.oversizedAppStateDomains.clear();
    domains.forEach((domain) => this.oversizedAppStateDomains.add(domain));
    this.notifyBackupHealthChanged();
  }

  private async refreshSettingsChoices(): Promise<void> {
    const choices: DurableAppStateDomain[] = [];
    for (const domain of DURABLE_APP_STATE_DOMAINS.filter((domain) => domain !== "preferences")) {
      const choice = await getState<AppStateChoiceRecord>(`${APP_STATE_CHOICE_PREFIX}${domain}`);
      if (choice && choice.keep !== "device") choices.push(domain);
    }
    if (choices.join() === this.settingsChoices.join()) return;
    this.settingsChoices = choices;
    this.notifyBackupHealthChanged();
  }

  /**
   * Settles saved settings that changed on this device and another device.
   * "device" sends this device's copy over Community's; "cloud" shows
   * Community's copy here.
   */
  async resolveSettingsChoice(domain: DurableAppStateDomain, keep: "device" | "cloud"): Promise<void> {
    const key = `${APP_STATE_CHOICE_PREFIX}${domain}`;
    const choice = await getState<AppStateChoiceRecord>(key);
    if (!choice) return;
    if (keep === "cloud") {
      const saved = (await readAppStateShadow())[domain];
      if (!saved) throw new Error("Tagify is still getting the copy from your other device. Try again in a moment.");
      await applyDurableAppStateDocuments([saved]);
      await indexedDBStorage.runSyncTransaction({}, () => ({ deleteState: [key, `pending-app-state:${domain}`], result: undefined }));
    } else {
      await putState({ ...choice, keep: "device" } as AppStateChoiceRecord);
    }
    await this.refreshSettingsChoices();
    void this.syncNow();
  }

  private async bootstrap(configuration: DesktopSyncConfiguration, intentId: string, batchId: string, queuedAt: number): Promise<void> {
    // A retry of an unchanged library produces the same checksum and resumes
    // its upload; a changed library gets its own upload instead of being
    // rejected as a different payload under the same key.
    const snapshot = await buildLocalSnapshot(configuration.libraryId, undefined, new Date(queuedAt));
    const chunks = snapshotChunks(snapshot);
    const checksum = await sha256Hex(JSON.stringify(snapshot));
    const startRequest = {
      deviceId: configuration.deviceId, idempotencyKey: await stableUuid(batchId, checksum), mode: "initialize",
      sourceStorageSchemaVersion: snapshot.sourceStorageSchemaVersion, checksum, expectedChunks: chunks.length,
    };
    const summary = (await this.request(configuration, "/api/v2/library")).library;
    const cloudHasData = Number(summary?.counts?.annotations || 0) > 0 || Number(summary?.counts?.taxonomy || 0) > 0;
    const localHasData = snapshot.annotations.length > 0 || snapshot.taxonomy.length > 0;
    if (cloudHasData && !localHasData) {
      throw new Error("snapshot_required: confirm Restore from cloud before replacing this replica");
    }
    if (cloudHasData && localHasData) {
      // An earlier attempt may have saved this very library after its reply was
      // lost (a dropped connection while Community finished a large first
      // sync). Community recognizes the same upload and confirms it, instead of
      // this device asking the user to combine the library with itself.
      const resumedCursor = await this.resumeFinishedBootstrap(configuration, startRequest, checksum);
      if (resumedCursor !== null) {
        await this.completeBootstrap(configuration, snapshot, resumedCursor, intentId);
        return;
      }
      if (await this.reconcileInitialLibraries(configuration)) return;
      throw new Error("merge_review_required");
    }
    let start;
    try {
      start = await this.request(configuration, "/api/v2/sync/bootstrap", startRequest);
    } catch (error) {
      // Community holds something this device's check above doesn't count
      // (such as colors). Combine the libraries instead of replacing them.
      if (/merge_required/i.test(error instanceof Error ? error.message : "")) {
        if (await this.reconcileInitialLibraries(configuration)) return;
        throw new Error("merge_review_required");
      }
      throw error;
    }
    const uploadId = start.upload.id as string;
    for (let index = Number(start.upload.receivedChunks || 0); index < chunks.length; index++) {
      const payload = chunks[index];
      const response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/bootstrap/${uploadId}/chunks`, {
        method: "PUT", headers: { ...syncClientHeaders(configuration.accessToken), "content-type": "application/json" },
        body: JSON.stringify({ deviceId: configuration.deviceId, index, checksum: await sha256Hex(JSON.stringify(payload)), payload }),
      });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error?.message || "Snapshot upload failed"); }
    }
    const result = await this.request(configuration, `/api/v2/sync/bootstrap/${uploadId}/finalize`, { deviceId: configuration.deviceId, checksum });
    await this.completeBootstrap(configuration, snapshot, result.bootstrap.headCursor || 0, intentId);
  }

  /**
   * Starts the same upload again. Returns its cursor when Community already
   * finished it (finalizing a finished upload only reports it), or null when
   * the cloud library holds something else and needs the reviewed merge.
   */
  private async resumeFinishedBootstrap(configuration: DesktopSyncConfiguration, startRequest: Record<string, unknown>, checksum: string): Promise<number | null> {
    let start;
    try {
      start = await this.request(configuration, "/api/v2/sync/bootstrap", startRequest);
    } catch (error) {
      if (/merge_required/i.test(error instanceof Error ? error.message : "")) return null;
      throw error;
    }
    if (start?.upload?.status !== "complete" || typeof start.upload.id !== "string") return null;
    const result = await this.request(configuration, `/api/v2/sync/bootstrap/${start.upload.id}/finalize`, { deviceId: configuration.deviceId, checksum });
    const headCursor = result?.bootstrap?.headCursor;
    if (!Number.isSafeInteger(headCursor)) return null;
    console.info("Tagify sync: confirmed a first backup Community had already saved", { headCursor });
    return headCursor;
  }

  private async completeBootstrap(configuration: DesktopSyncConfiguration, snapshot: LibrarySnapshotV1, appliedCursor: number, intentId: string): Promise<void> {
    const canonical: LibrarySnapshotV1 | LibrarySnapshotV2 = { ...snapshot, headCursor: appliedCursor };
    await seedShadowFromSnapshot(canonical, appliedCursor);
    await writeManifest(replicaManifest(configuration, canonical));
    await this.acknowledgeCursor(configuration, appliedCursor);
    this.backupHealthRefreshRequested = true;
    this.initialMergePreview = null;
    this.initialMergeDeviceSnapshot = null;
    this.initialMergeOperationId = null;
    console.info("Tagify sync: private library bootstrap complete", { mode: "initialize", annotationCount: canonical.annotations.length, taxonomyNodeCount: canonical.taxonomy.length, operationId: intentId });
  }

  private async request(configuration: DesktopSyncConfiguration, path: string, body?: unknown, ifNoneMatch?: string): Promise<any> {
    const response = await fetch(`${configuration.apiBaseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...syncClientHeaders(configuration.accessToken), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 304) return { unchanged: true };
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      this.sessionRefused(response, payload, configuration.accessToken);
      throw syncResponseError(response, payload);
    }
    return payload;
  }

  private async requestCompressed(configuration: DesktopSyncConfiguration, path: string, body: unknown, {
    maxCompressedBytes = MAX_COMPRESSED_REQUEST_BYTES,
    maxExpandedBytes = MAX_EXPANDED_REQUEST_BYTES,
    tooLargeMessage = "This library is too large to combine in one review. Download a backup and contact Tagify support.",
  }: { maxCompressedBytes?: number; maxExpandedBytes?: number; tooLargeMessage?: string } = {}): Promise<any> {
    const json = JSON.stringify(body);
    // Community refuses what it would have to expand beyond this; stop before compressing.
    if (new TextEncoder().encode(json).byteLength > maxExpandedBytes) throw new Error(tooLargeMessage);
    const compressed = await gzipText(json);
    if (compressed.byteLength > maxCompressedBytes) throw new Error(tooLargeMessage);
    const response = await fetch(`${configuration.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        ...syncClientHeaders(configuration.accessToken),
        "content-type": "application/octet-stream",
        "x-tagify-content-encoding": "gzip",
      },
      body: compressed,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      this.sessionRefused(response, payload, configuration.accessToken);
      throw syncResponseError(response, payload);
    }
    return payload;
  }

  private async loadCapabilities(configuration: DesktopSyncConfiguration): Promise<SyncCapabilitiesV1 | SyncCapabilitiesV2> {
    const cacheKey = capabilitiesCacheKey(configuration.apiBaseUrl);
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as { cachedAt?: unknown; value?: unknown } | null;
      if (cached && typeof cached.cachedAt === "number" && Date.now() - cached.cachedAt < CAPABILITIES_CACHE_MS && isSyncCapabilities(cached.value)) return cached.value;
    } catch { /* An unavailable cache must never block sync. */ }
    const response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/capabilities`, { headers: syncClientHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw syncResponseError(response, payload);
    if (!isSyncCapabilities(payload)) throw new Error("invalid_capabilities: Community returned an invalid sync capability document");
    try { localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), value: payload })); } catch { /* Best-effort deployment metadata cache. */ }
    return payload;
  }

  private async downloadSnapshot(configuration: DesktopSyncConfiguration, protocolVersion: number): Promise<LibrarySnapshotV1 | LibrarySnapshotV2> {
    const path = `/api/v2/sync/snapshot?deviceId=${encodeURIComponent(configuration.deviceId)}&protocolVersion=${protocolVersion}&delivery=direct-gzip-v1`;
    const descriptor = await this.request(configuration, path);
    if (descriptor.snapshot) return librarySnapshotWithoutPreferences(descriptor.snapshot as LibrarySnapshotV1 | LibrarySnapshotV2);
    const download = descriptor.download as { url?: unknown; encoding?: unknown; checksum?: unknown } | undefined;
    if (!download || typeof download.url !== "string" || download.encoding !== "gzip" || typeof download.checksum !== "string") {
      throw new Error("invalid_snapshot_response: Community returned an invalid snapshot download");
    }
    const response = await fetch(download.url, { cache: "no-store" });
    if (!response.ok || !response.body) throw new Error("snapshot_download_failed: The cloud snapshot could not be downloaded");
    if (typeof DecompressionStream === "undefined") throw new Error("snapshot_download_failed: This Spotify version cannot open compressed cloud backups");
    const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(decompressed).arrayBuffer());
    const checksum = await sha256HexBytes(bytes);
    if (checksum !== download.checksum) throw new Error("snapshot_checksum_mismatch: The cloud snapshot failed its integrity check");
    try {
      return librarySnapshotWithoutPreferences(JSON.parse(new TextDecoder().decode(bytes)) as LibrarySnapshotV1 | LibrarySnapshotV2);
    } catch {
      throw new Error("invalid_snapshot_response: The cloud snapshot was not valid JSON");
    }
  }

  /**
   * Community refused a session this device's clock still counts as current
   * (the clock may be off). The next use refreshes it instead of sending it again.
   */
  private sessionRefused(response: Response, payload: { error?: { code?: string } }, accessToken: string): void {
    if (response.status === 401 && payload.error?.code === "authentication_required") this.refusedAccessToken = accessToken;
  }

  private async refreshIfNeeded(configuration: DesktopSyncConfiguration): Promise<DesktopSyncConfiguration> {
    if (!sessionNeedsRefresh(configuration) && this.refusedAccessToken !== configuration.accessToken) return configuration;
    // Supabase already rejected this refresh token; asking again cannot succeed.
    if (this.inactiveRefreshToken === configuration.refreshToken) throw new Error("session_inactive");
    // Sync and Realtime may both need a fresh session; a refresh token is spent once.
    if (this.refreshing?.refreshToken === configuration.refreshToken) return this.refreshing.result;
    const result = this.refreshSession(configuration).finally(() => {
      if (this.refreshing?.result === result) this.refreshing = null;
    });
    this.refreshing = { refreshToken: configuration.refreshToken, result };
    return result;
  }

  private async refreshSession(configuration: DesktopSyncConfiguration): Promise<DesktopSyncConfiguration> {
    const response = await fetch(`${configuration.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: configuration.supabasePublishableKey },
      body: JSON.stringify({ refresh_token: configuration.refreshToken }),
    });
    const session = await response.json().catch(() => ({}));
    if (!response.ok || !session.access_token) {
      // Supabase answers 400/401 for a revoked, expired, or already-replaced
      // refresh token (refresh_token_not_found, session_not_found, …).
      if (response.status === 400 || response.status === 401) {
        this.markSessionInactive(configuration);
        throw new Error("session_inactive");
      }
      throw new Error("refresh_failed");
    }
    const next = { ...configuration, accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: sessionExpiresAt(session) };
    setDesktopSyncConfiguration(next);
    this.refusedAccessToken = null;
    await this.realtime?.realtime.setAuth(next.accessToken);
    this.scheduleSessionRefresh();
    void enrollDesktopRecovery(next);
    return next;
  }

  /**
   * While Realtime holds this device's session, refreshes it shortly before
   * it expires. Realtime closes a channel once its token expires, which cost
   * a reconnect, a new join and a catch-up pull about every hour. Requests
   * refresh the session themselves when it is close to expiring.
   */
  private scheduleSessionRefresh(): void {
    if (this.sessionRefreshTimer) clearTimeout(this.sessionRefreshTimer);
    this.sessionRefreshTimer = null;
    const configuration = getDesktopSyncConfiguration();
    if (!this.started || !this.channel || !configuration || this.inactiveRefreshToken === configuration.refreshToken) return;
    const delay = Math.min(MAX_TIMER_MS, Math.max(0, configuration.expiresAt * 1_000 - SESSION_REFRESH_AHEAD_MS - Date.now()));
    this.sessionRefreshTimer = setTimeout(() => {
      this.sessionRefreshTimer = null;
      const current = getDesktopSyncConfiguration();
      if (!this.started || !this.channel || !current) return;
      // A refresh that failed is tried again by the next sync or reconnect; a
      // rejected one stops automatic retries.
      void this.refreshIfNeeded(current).then(() => this.scheduleSessionRefresh(), () => undefined);
    }, delay);
  }

  /** Resolves once a live connection that is opening has joined or failed, or after `timeoutMs`. */
  private waitForRealtimeJoin(timeoutMs = REALTIME_JOIN_WAIT_MS): Promise<void> {
    if (!this.realtimeConnecting && !this.realtimeJoinPending) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.realtimeJoinWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.realtimeJoinWaiters.add(done);
    });
  }

  /** The opening connection joined or failed. Returns whether a sync was waiting for it. */
  private settleRealtimeJoin(): boolean {
    this.realtimeJoinPending = false;
    const waiting = this.realtimeJoinWaiters.size > 0;
    for (const done of [...this.realtimeJoinWaiters]) done();
    return waiting;
  }

  /** Connects Realtime with a current session unless it is connected, reconnecting, or paused. */
  private ensureRealtime(configuration: DesktopSyncConfiguration): void {
    if (!this.started || this.channel || this.realtimeConnecting || this.reconnectTimer || this.realtimeSuspended || this.realtimeWanted === false) return;
    if (this.inactiveRefreshToken === configuration.refreshToken) return;
    this.realtimeConnecting = true;
    void this.refreshIfNeeded(configuration)
      .then((active) => {
        this.realtimeConnecting = false;
        return this.connectRealtime(active);
      })
      .catch((error) => {
        this.realtimeConnecting = false;
        if (!(error instanceof Error && isDefinitiveSessionFailure(error.message))) this.scheduleRealtimeReconnect(configuration);
      })
      .finally(() => {
        // No subscription went out (or it already answered): a waiting sync goes ahead.
        if (!this.realtimeConnecting && !this.realtimeJoinPending) this.settleRealtimeJoin();
      });
  }

  /** The device session for side requests, refreshed shortly before it expires. */
  private sideSession(fallback: DesktopSyncConfiguration): SendSession {
    return () => this.refreshIfNeeded(getDesktopSyncConfiguration() ?? fallback);
  }

  private reportDesktopFeaturesOnce(configuration: DesktopSyncConfiguration): void {
    if (!this.started || this.featuresReportedFor === configuration.deviceId) return;
    this.featuresReportedFor = configuration.deviceId;
    this.featuresReport = reportDesktopFeatures(this.sideSession(configuration), undefined, desktopFeatures());
  }

  /**
   * Asks Community for playlists to write once Community knows this Tagify can (Community offers
   * them only to computers that reported `playlistWrites`): when Tagify starts, then at most every
   * `pollMinutes`. Nothing when Community doesn't advertise playlist writes.
   */
  private pollPlaylistWrites(): void {
    const capabilities = canWritePlaylists() ? this.capabilities : null;
    const report = this.featuresReport;
    if (!report) { this.playlistWrites.poll(capabilities); return; }
    void report.then(() => { if (this.started) this.playlistWrites.poll(capabilities); });
  }

  /**
   * Sends Community the artists of songs and albums in this library it has none for, read through
   * Spotify's desktop app in the background (Community migration 0252). Once a start, then at most
   * every few hours; a Community without the feature is left alone until the next start.
   */
  private handleArtistCredits(configuration: DesktopSyncConfiguration): void {
    // One background Spotify reader at a time; a skipped run starts on a later pull.
    if (!this.started || this.artistCredits || this.songReleases || this.artistCreditsUnsupported) return;
    if (!(this.capabilities as { artistCredits?: { protocolVersion?: unknown } } | null)?.artistCredits) return;
    if (Date.now() - this.artistCreditsRanAt < ARTIST_CREDITS_INTERVAL_MS) return;
    this.artistCreditsRanAt = Date.now();
    this.artistCredits = runArtistCreditReports(this.sideSession(configuration), communityArtistCreditSources())
      .then((run) => { if (run.stopped === "unsupported") this.artistCreditsUnsupported = true; })
      .catch((error) => { console.warn("Tagify sync: artist names were not sent", error instanceof Error ? error.message : error); })
      .finally(() => { this.artistCredits = null; });
  }

  /**
   * Sends Community the ISRC and album of songs in this library it knows no release for, read
   * through Spotify's desktop app in the background (Community migration 0261), so song pages name
   * their album and every version of a song shares one page. Only when Community advertises
   * `songReleases`; once a start, then at most every few hours, never beside the artist credits run.
   */
  private handleSongReleases(configuration: DesktopSyncConfiguration): void {
    if (!this.started || this.songReleases || this.artistCredits || this.songReleasesUnsupported) return;
    if ((this.capabilities as { songReleases?: { protocolVersion?: unknown } } | null)?.songReleases?.protocolVersion !== 1) return;
    if (Date.now() - this.songReleasesRanAt < SONG_RELEASES_INTERVAL_MS) return;
    this.songReleasesRanAt = Date.now();
    this.songReleases = runSongReleaseReports(this.sideSession(configuration), communitySongReleaseSources())
      .then((run) => { if (run.stopped === "unsupported") this.songReleasesUnsupported = true; })
      .catch((error) => { console.warn("Tagify sync: album details were not sent", error instanceof Error ? error.message : error); })
      .finally(() => { this.songReleases = null; });
  }

  /**
   * The member asked on Community to save songs to their Liked Songs. Saves every waiting song
   * through Spotify's desktop app in the background, then looks again if more were asked meanwhile.
   */
  private handleSpotifySaves(): void {
    const configuration = getDesktopSyncConfiguration();
    if (!this.started || !configuration || !canSaveToLikedSongs()) return;
    if (this.spotifySaves) { this.spotifySavesAgain = true; return; }
    this.spotifySaves = (async () => {
      const total = { saved: 0, alreadySaved: 0, failed: 0 };
      try {
        do {
          this.spotifySavesAgain = false;
          const run = await runSpotifySaves(this.sideSession(configuration), spotifyApiService);
          total.saved += run.saved; total.alreadySaved += run.alreadySaved; total.failed += run.failed;
          if (run.stopped) break;
        } while (this.spotifySavesAgain && this.started);
      } catch (error) {
        console.warn("Tagify sync: songs were not saved to Liked Songs", error instanceof Error ? error.message : error);
      } finally {
        this.spotifySaves = null;
      }
      const notice = spotifySaveNotice(total);
      if (notice) Spicetify.showNotification(notice.text, notice.error);
    })();
  }

  /**
   * The member asked on Community for their Spotify lists. Picks the send up, reads Liked Songs
   * and every playlist through Spotify's desktop APIs and sends them as it goes, in the background,
   * with progress Community shows. A send that ends (done, failed, stopped or another computer's)
   * answers the request; one cut off because Spotify closed is picked up again on the next start.
   */
  private handleSpotifyLibraryRequest(requestedAt: string | null | undefined): void {
    const configuration = getDesktopSyncConfiguration();
    if (!this.started || !configuration || !requestedAt || this.spotifyLibrarySend || !isNewSpotifyLibraryRequest(configuration, requestedAt)) return;
    this.spotifyLibrarySend = (async () => {
      let outcome: SpotifySendOutcome = { status: "failed", failure: "unknown" };
      try {
        outcome = await runSpotifyLibrarySend(this.sideSession(configuration), spotifyApiService, {
          onStarted: () => Spicetify.showNotification("Sending your Spotify lists to Tagify Community. You can keep using Spotify."),
        });
      } catch (error) {
        console.warn("Tagify sync: Spotify lists were not sent to Community", error instanceof Error ? error.message : error);
      } finally {
        markSpotifyLibraryRequestHandled(configuration, requestedAt);
        this.spotifyLibrarySend = null;
      }
      const notice = spotifySendNotice(outcome);
      if (notice) Spicetify.showNotification(notice.text, notice.error);
    })();
  }

  /**
   * The member pressed Play on Community with "My Spotify app" chosen. Only the computer Community
   * asked plays the song, once, and only a request from the last minute (DesktopPlay.ts).
   */
  private handleDesktopPlayRequest(payload: unknown): void {
    const configuration = getDesktopSyncConfiguration();
    if (!this.started || !configuration) return;
    const request = readDesktopPlayRequest(payload, configuration);
    if (!request) return;
    void this.desktopPlayer.handle(request, this.sideSession(configuration)).then((outcome) => {
      if (outcome === "failed") Spicetify.showNotification("Spotify couldn't play the song from Tagify Community. Try again in a moment.", true);
    });
  }

  private async connectRealtime(configuration: DesktopSyncConfiguration) {
    if (!configuration.supabaseUrl || !configuration.supabasePublishableKey || this.channel || this.realtimeConnecting || this.realtimeSuspended || this.realtimeWanted === false) return;
    this.realtimeConnecting = true;
    try {
      // Realtime asks for a token after joining and on every heartbeat. Without
      // this callback supabase-js answers with the publishable key (there is no
      // Supabase Auth session here), which replaces the device session on the
      // private library channel. A token callback also disables supabase.auth,
      // which this client never uses.
      this.realtime ??= createClient(configuration.supabaseUrl, configuration.supabasePublishableKey, {
        accessToken: async () => this.realtimeAccessToken(),
      });
      const realtime = this.realtime;
      this.realtimeToken = configuration.accessToken;
      await realtime.realtime.setAuth(configuration.accessToken);
      // Read through a cast: TypeScript keeps the check above narrowed across the await.
      if (!this.started || this.realtime !== realtime || this.realtimeSuspended || (this.realtimeWanted as boolean | null) === false) return;
      const channel = realtime.channel(`tagify-library:${configuration.libraryId}`, { config: { private: true } });
      this.channel = channel;
      this.realtimeJoinPending = true;
      channel
        .on("broadcast", { event: "head_cursor" }, ({ payload }) => {
          if (payload?.libraryId !== configuration.libraryId || !Number.isSafeInteger(payload?.headCursor)) return;
          // Community names the device that wrote the change; this device's own
          // backup was already confirmed by the sync that sent it.
          if (typeof payload.deviceId === "string" && payload.deviceId === configuration.deviceId) return;
          this.announcedHead = Math.max(this.announcedHead, Number(payload.headCursor));
          void this.handleRemoteHead(Number(payload.headCursor));
        })
        .on("broadcast", { event: "spotify_library_request" }, ({ payload }) => {
          if (payload?.libraryId !== configuration.libraryId) return;
          this.handleSpotifyLibraryRequest(typeof payload.requestedAt === "string" ? payload.requestedAt : null);
        })
        .on("broadcast", { event: "spotify_save_request" }, ({ payload }) => {
          if (payload?.libraryId !== configuration.libraryId) return;
          this.handleSpotifySaves();
        })
        .on("broadcast", { event: PLAYLIST_WRITE_REQUEST_EVENT }, ({ payload }) => {
          if (payload?.libraryId !== configuration.libraryId) return;
          this.playlistWrites.request();
        })
        .on("broadcast", { event: "desktop_play_request" }, ({ payload }) => this.handleDesktopPlayRequest(payload))
        .on("broadcast", { event: "projection_cursor" }, ({ payload }) => {
          if (payload?.libraryId !== configuration.libraryId || !Number.isSafeInteger(payload?.projectionCursor)) return;
          if (Number(payload.projectionCursor) < this.projectionTargetCursor) return;
          this.projectionPending = false;
          this.projectionReviewRequired = false;
          this.projectionTargetCursor = Number(payload.projectionCursor);
          // A finished projection also means the member chose what to share, possibly on Community.
          if (this.status === "publishing" || this.status === "publication-review-required") this.setStatus("idle");
        })
        .subscribe((status) => {
          // Removing an old channel also emits CLOSED. It must not schedule a new retry.
          if (this.channel !== channel) return;
          if (status === "SUBSCRIBED") {
            this.realtimeSubscribedAt = Date.now();
            // A sync that waited for this join, or is about to start, pulls
            // next. Otherwise announcements made before joining were not
            // heard: check once, after which Realtime covers every change.
            const syncPullsNext = this.settleRealtimeJoin() || this.syncsBeforeJoin > 0;
            if (!syncPullsNext && this.headConfirmedAt < this.realtimeSubscribedAt) void this.syncNow(true);
            this.scheduleSafetySync(true);
            this.scheduleSessionRefresh();
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") this.settleRealtimeJoin();
          if (this.started && (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")) {
            if (this.realtimeSubscribedAt && Date.now() - this.realtimeSubscribedAt >= 30_000) this.reconnectAttempts = 0;
            this.realtimeSubscribedAt = 0;
            console.warn("Tagify sync: Realtime hint channel unavailable; recovery pulls remain active");
            this.scheduleSafetySync(true);
            this.scheduleRealtimeReconnect(configuration);
          }
        });
    } finally {
      this.realtimeConnecting = false;
      // Stopped before subscribing, or the subscription couldn't be sent.
      if (!this.realtimeJoinPending) this.settleRealtimeJoin();
    }
  }

  private setStatus(status: SyncStatus) {
    // Waiting for a Community choice or retry must never disable local saves.
    // Only the atomic replacement itself needs a short persistence barrier.
    setLocalPersistencePaused(status === "restoring");
    if (this.status === status) return;
    this.status = status;
    this.dispatchEvent(new CustomEvent("status", { detail: status }));
    window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status } }));
  }

  /**
   * Arms the next safety check. Its due time survives Spotify being hidden
   * and shown again, so switching apps neither postpones it nor brings it
   * forward; `restart` counts a new interval from now.
   */
  private scheduleSafetySync(restart = false) {
    if (!this.started) return;
    if (restart || !this.nextSafetySyncAt) {
      this.nextSafetySyncAt = Date.now() + safetySyncDelayMs(this.recoveryPollStage, Math.random, this.realtimeCoverage() !== "down");
    }
    if (document.visibilityState !== "visible") return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextSafetySyncAt = 0;
      if (document.visibilityState === "visible" && navigator.onLine) {
        this.recoveryPollStage = Math.min(this.recoveryPollStage + 1, RECOVERY_POLL_INTERVALS_MS.length - 1);
        void this.syncNow(true);
      }
      this.scheduleSafetySync();
    }, Math.max(0, this.nextSafetySyncAt - Date.now()));
  }

  private resetRecoverySchedule() { this.recoveryPollStage = 0; this.scheduleSafetySync(true); }
  private handleOnline = () => { this.resetRecoverySchedule(); void this.syncNow(true); };
  private handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.hiddenAt ||= Date.now();
      this.scheduleRealtimeSuspend();
      // Leaving Spotify (perhaps for another device) backs up waiting edits now.
      if (this.editSyncTimer) {
        clearTimeout(this.editSyncTimer);
        void this.flushEditSync();
      }
      return;
    }
    const hiddenForMs = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = 0;
    if (this.realtimeSuspendTimer) clearTimeout(this.realtimeSuspendTimer);
    this.realtimeSuspendTimer = null;
    if (this.realtimeSuspended) {
      // Reconnect once and catch up on anything announced while disconnected.
      this.realtimeSuspended = false;
      const configuration = getDesktopSyncConfiguration();
      if (configuration) this.ensureRealtime(configuration);
      this.scheduleSafetySync();
      void this.syncNow(true);
      return;
    }
    // Realtime already delivers changes while connected; only check Community
    // when that connection may have missed something.
    this.scheduleSafetySync();
    if (shouldSyncWhenVisible({ hiddenForMs, realtime: this.realtimeCoverage(), msSinceLastSync: Date.now() - this.lastSuccessfulSyncAt })) {
      void this.syncNow(true);
    }
  };
  private handleOutboxChanged = () => {
    if (this.initialMergePreview) {
      this.initialMergePreview = null;
      this.initialMergeDeviceSnapshot = null;
      this.initialMergeOperationId = null;
    }
    this.localEditCount++;
    this.resetRecoverySchedule();
    this.scheduleEditSync();
  };

  /**
   * Committed edits are already durable in the outbox, local tracks, or notes,
   * so they back up together once editing pauses instead of one request run
   * per change. Closing Spotify before then backs them up on the next start.
   */
  private scheduleEditSync(): void {
    if (!this.started) return;
    const now = Date.now();
    this.firstPendingEditAt ||= now;
    if (!this.lastEditAt || now - this.lastEditAt >= EDIT_SESSION_GAP_MS) this.editSessionStartedAt = now;
    this.lastEditAt = now;
    if (this.editSyncTimer) clearTimeout(this.editSyncTimer);
    // The edit shows as being saved right away, as before.
    if ((this.status === "idle" || this.status === "publishing") && this.canSyncAutomatically()) this.setStatus("syncing");
    this.editSyncTimer = setTimeout(() => void this.flushEditSync(), editSyncDelayMs(this.firstPendingEditAt, now, this.editSessionStartedAt));
  }

  private async flushEditSync(): Promise<void> {
    this.editSyncTimer = null;
    this.firstPendingEditAt = 0;
    // A sync already running may pick these edits up in its final pass.
    while (this.running) await this.running.catch(() => undefined);
    if (!this.started || this.editSyncTimer) return;
    if (this.localEditCount > this.settledEditCount) await this.syncNow(true);
    if (!this.running && !this.editSyncTimer && this.status === "syncing") this.setSettledStatus();
  }

  private canSyncAutomatically(): boolean {
    const configuration = getDesktopSyncConfiguration();
    return Boolean(configuration) && !this.recoveryPreview && navigator.onLine &&
      Date.now() >= this.automaticRetryNotBefore && this.inactiveRefreshToken !== configuration?.refreshToken;
  }

  /** Runs one sync for a Realtime announcement, after any sync already in progress. */
  private async handleRemoteHead(headCursor: number): Promise<void> {
    if (this.running) {
      this.pendingRealtimeHead = Math.max(this.pendingRealtimeHead, headCursor);
      return;
    }
    if (headCursor <= await readCursor()) return;
    if (this.running) {
      this.pendingRealtimeHead = Math.max(this.pendingRealtimeHead, headCursor);
      return;
    }
    this.resetRecoverySchedule();
    void this.syncNow(true);
  }

  private isRealtimeSubscribed(): boolean {
    return Boolean(this.channel) && this.realtimeSubscribedAt > 0;
  }

  /** Realtime has stayed connected since this device last confirmed it was current. */
  private isRealtimeLive(): boolean {
    return this.isRealtimeSubscribed() && this.headConfirmedAt > 0 && this.headConfirmedAt >= this.realtimeSubscribedAt;
  }

  private realtimeCoverage(): RealtimeCoverage {
    if (this.isRealtimeLive()) return "live";
    return this.realtimeWanted === false || this.isRealtimeSubscribed() ? "quiet" : "down";
  }

  /** Pull pages from Community with `liveSyncHints` say whether anyone else uses this library. */
  private noteLiveSync(response: PullPage): void {
    const realtime = response?.liveSync?.realtime;
    if (this.hasCapability("liveSyncHints") && typeof realtime === "boolean") this.noteRealtimeWanted(realtime);
    if (this.hasCapability("liveSyncHints")) this.listenWhileHidden = response?.liveSync?.listenWhileHidden === true;
    if (this.listenWhileHidden && this.realtimeSuspendTimer) {
      clearTimeout(this.realtimeSuspendTimer);
      this.realtimeSuspendTimer = null;
    }
  }

  /**
   * Older Community servers: a library with only this device connected has
   * nobody else to hear from. Its other devices may be unused, so this only
   * ever saves a connection that is certainly idle.
   */
  private noteLibrarySummary(summary: { devices?: unknown } | null | undefined): void {
    const devices = summary?.devices;
    if (this.hasCapability("liveSyncHints") || typeof devices !== "number" || !Number.isSafeInteger(devices)) return;
    this.noteRealtimeWanted(devices > 1);
  }

  /** Follows Community's word and keeps it for the next start (see `liveSyncHint`). */
  private noteRealtimeWanted(wanted: boolean): void {
    this.setRealtimeWanted(wanted);
    const libraryId = getDesktopSyncConfiguration()?.libraryId;
    if (!libraryId) return;
    const now = Date.now();
    const saved = this.liveSyncHintSaved;
    if (saved?.libraryId === libraryId && saved.realtime === wanted && now - saved.at < LIVE_SYNC_HINT_SAVE_MS) return;
    try {
      localStorage.setItem(`${LIVE_SYNC_HINT_PREFIX}${libraryId}`, JSON.stringify({ realtime: wanted, at: now }));
      this.liveSyncHintSaved = { libraryId, realtime: wanted, at: now };
    } catch {
      // Without the hint the next start pulls first, as before.
    }
  }

  private setRealtimeWanted(wanted: boolean): void {
    if (this.realtimeWanted === wanted) return;
    this.realtimeWanted = wanted;
    if (wanted) {
      const configuration = getDesktopSyncConfiguration();
      if (configuration) this.ensureRealtime(configuration);
    } else {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      if (this.realtimeSuspendTimer) clearTimeout(this.realtimeSuspendTimer);
      this.realtimeSuspendTimer = null;
      this.closeRealtimeChannel();
    }
    this.scheduleSafetySync(true);
  }

  private realtimeAccessToken(): string {
    return getDesktopSyncConfiguration()?.accessToken || this.realtimeToken;
  }

  private scheduleRealtimeSuspend(): void {
    if (!this.started || this.realtimeSuspended || this.realtimeSuspendTimer) return;
    // Nothing to release, and nothing to catch up on when shown again.
    if (this.realtimeWanted === false) return;
    // The member plays songs here from Community, usually while Spotify is behind their browser.
    if (this.listenWhileHidden) return;
    this.realtimeSuspendTimer = setTimeout(() => {
      this.realtimeSuspendTimer = null;
      if (!this.started || document.visibilityState === "visible") return;
      // Nothing is polled while Spotify is hidden either; showing it again reconnects and catches up.
      this.realtimeSuspended = true;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.closeRealtimeChannel();
    }, HIDDEN_REALTIME_CLOSE_MS);
  }

  private closeRealtimeChannel(): void {
    const channel = this.channel;
    this.channel = null;
    this.realtimeSubscribedAt = 0;
    if (this.sessionRefreshTimer) clearTimeout(this.sessionRefreshTimer);
    this.sessionRefreshTimer = null;
    this.settleRealtimeJoin();
    // Removing the last channel also closes the socket.
    if (channel && this.realtime) void this.realtime.removeChannel(channel);
  }

  /** Stops automatic retries until the user reconnects this device or chooses Sync Now. */
  private markSessionInactive(configuration: DesktopSyncConfiguration): void {
    this.inactiveRefreshToken = getDesktopSyncConfiguration()?.refreshToken ?? configuration.refreshToken;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.closeRealtimeChannel();
    this.setStatus("reauthorize");
  }

  private scheduleRealtimeReconnect(configuration: DesktopSyncConfiguration) {
    if (!this.started || this.reconnectTimer || this.realtimeSuspended || this.realtimeWanted === false) return;
    if (this.inactiveRefreshToken === (getDesktopSyncConfiguration() || configuration).refreshToken) return;
    const delay = Math.round(Math.min(5 * 60_000, 1_000 * 2 ** Math.min(this.reconnectAttempts++, 8)) * (1 + Math.random() * 0.25));
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const previous = this.channel;
      this.channel = null;
      if (previous && this.realtime) await this.realtime.removeChannel(previous);
      if (!this.started || !navigator.onLine || this.realtimeSuspended || this.realtimeWanted === false) return;
      try {
        const current = getDesktopSyncConfiguration() || configuration;
        const active = await this.refreshIfNeeded(current);
        await this.connectRealtime(active);
      } catch (error) {
        // A rejected session needs reconnecting; retrying would only repeat the rejection.
        if (error instanceof Error && isDefinitiveSessionFailure(error.message)) return;
        this.scheduleRealtimeReconnect(getDesktopSyncConfiguration() || configuration);
      }
    }, delay);
  }

  private updateProjectionStatus(projection: unknown) {
    if (!projection || typeof projection !== "object") return;
    const value = projection as Record<string, unknown>;
    if (Number.isSafeInteger(value.targetCursor)) this.projectionTargetCursor = Math.max(this.projectionTargetCursor, Number(value.targetCursor));
    this.projectionReviewRequired = value.errorCode === "publication_review_required";
    this.projectionPending = value.complete !== true && !this.projectionReviewRequired;
    if (this.projectionReviewRequired) this.setStatus("publication-review-required");
    else if (this.projectionPending) this.setStatus("publishing");
  }

  private setSettledStatus() {
    this.setStatus(this.projectionReviewRequired ? "publication-review-required" : this.projectionPending ? "publishing" : "idle");
  }

  /**
   * The member's saved sharing choice is no longer waiting for review, chosen
   * here or on Community. A sync with nothing to send makes no request, so
   * without this the last reply's review flag would keep asking.
   */
  notePublicationReviewed(): void {
    this.projectionReviewRequired = false;
    if (this.status === "publication-review-required") this.setSettledStatus();
  }

  private installPublicApi() {
    window.TagifySync = {
      beginPairing: (apiBaseUrl, name, platform) => syncPairingService.begin(apiBaseUrl, name, platform),
      pollPairing: () => syncPairingService.poll(),
      completePairing: (approval, options) => syncPairingService.complete(approval, options),
      cancelPairing: () => syncPairingService.cancelPending(),
      syncNow: () => this.userSyncNow(),
      activateCurrentAccount: () => this.activateCurrentAccount(),
      getStatus: () => this.getStatus(),
      getInitialMergePreview: () => this.getInitialMergePreview(),
      getRecoveryPreview: () => this.getRecoveryPreview(),
      getLastRecovered: () => this.getLastRecovered(),
      getBackupHealth: () => this.getBackupHealth(),
      resolveSettingsChoice: (domain, keep) => this.resolveSettingsChoice(domain, keep),
      restoreFromCloud: () => this.restoreFromCloud(),
      commitInitialMerge: (resolutions) => this.commitInitialMerge(resolutions),
      downloadInitialMergeBackup: () => this.downloadInitialMergeBackup(),
      armCloudReplacement: () => this.armCloudReplacement(),
      replaceCloudWithCurrentLocalState: () => this.replaceCloudWithCurrentLocalState(),
      communityRequest: (path, options) => this.communityRequest(path, options),
      unlinkLocal: () => this.unlinkLocal(),
    };
  }
}

/**
 * Community rejects a whole batch when one operation is invalid, and the
 * runtime retries that batch indefinitely. Keep a value Community cannot hold
 * on this device only, so every other change still backs up.
 */
// Community accepts request bodies up to 1,000,000 bytes.
const APP_STATE_REQUEST_BUDGET_BYTES = 900_000;

/** Splits changed app-state documents into requests that stay under the push body limit. */
export function appStatePushGroups(documents: DurableAppStateDocumentV2[]): DurableAppStateDocumentV2[][] {
  const groups: DurableAppStateDocumentV2[][] = [];
  let current: DurableAppStateDocumentV2[] = [];
  let currentBytes = 0;
  for (const document of documents) {
    const bytes = durableStateStoredByteLength(document.value) + 512;
    if (current.length && currentBytes + bytes > APP_STATE_REQUEST_BUDGET_BYTES) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(document);
    currentBytes += bytes;
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Splits changes into those Community accepts and those that stay on this device. */
export function partitionSupportedOperations(operations: SyncMutationV1[]): { supported: SyncMutationV1[]; unsupported: Array<{ operation: SyncMutationV1; reason: string }> } {
  const supported: SyncMutationV1[] = [];
  const unsupported: Array<{ operation: SyncMutationV1; reason: string }> = [];
  for (const operation of operations) {
    try {
      assertSyncMutationV1(operation);
      supported.push(operation);
    } catch (error) {
      unsupported.push({ operation, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { supported, unsupported };
}

export function withoutUnsupportedOperations(operations: SyncMutationV1[]): SyncMutationV1[] {
  const { supported, unsupported } = partitionSupportedOperations(operations);
  for (const { operation, reason } of unsupported) {
    console.warn("Tagify sync: kept an unsupported change on this device only", { type: operation.type, reason });
  }
  return supported;
}

async function materializeIntent(intent: LocalSyncIntent, edits?: EntityEdits, knownShadow?: AnnotationSnapshotV1): Promise<SyncMutationV1[]> {
  if (intent.type === "library.snapshot") return [];
  if (intent.type === "taxonomy.replace") return materializeTaxonomy(intent);
  const shadow = knownShadow ?? await readShadow(intent.entity);
  if (intent.type === "entity.delete") {
    // Nothing to remove when Community never had the item or already removed it.
    if (shadow.deleted || !annotationExists(shadow)) return [];
    return [{
      type: "annotation.delete", operationId: await stableUuid(intent.id, "delete"), origin: "desktop",
      entity: intent.entity, expectedEntityRevision: shadow.entityRevision,
    }];
  }
  return materializeEntity(intent, shadow, edits);
}

function annotationExists(shadow: AnnotationSnapshotV1): boolean {
  return shadow.entityRevision > 0
    || Object.values(shadow.fields).some((field) => field.revision > 0 || field.value !== null)
    || Object.keys(shadow.tagMemberships).length > 0;
}

async function materializeTaxonomy(intent: TaxonomyReplaceIntent): Promise<SyncMutationV1[]> {
  const desired = flattenTaxonomy(intent.taxonomy);
  const base = intent.base ? flattenTaxonomy(intent.base) : null;
  const shadow = await readTaxonomyShadow();
  const operations: SyncMutationV1[] = [];
  const parentRevisions = { ...shadow.parentRevisions };
  const allNodeIds = new Set([...Object.keys(shadow.nodes), ...Object.keys(desired.nodes)]);
  // Without a base (intents from older versions) the whole taxonomy is desired.
  const editedHere = <T>(baseItems: Record<string, T> | undefined, desiredItems: Record<string, T>, id: string, same: (left: T, right: T) => boolean) => {
    if (!baseItems) return true;
    const before = baseItems[id]; const after = desiredItems[id];
    return !before || !after ? before !== after : !same(before, after);
  };
  const sameNode = (left: TaxonomyNodeSnapshotV1, right: TaxonomyNodeSnapshotV1) => left.name === right.name && left.parentId === right.parentId && left.accentId === right.accentId && left.position === right.position && left.kind === right.kind;
  const sameColor = (left: CustomColorSnapshotV1, right: CustomColorSnapshotV1) => left.name === right.name && left.color === right.color;
  const sameCollection = (left: CollectionSnapshotV1, right: CollectionSnapshotV1) => left.name === right.name && left.position === right.position && JSON.stringify(left.colorIds) === JSON.stringify(right.colorIds);
  // The base is this device's tags before its first unsent edit. Send what
  // the user changed here, plus anything this device has that Community is
  // missing; never revert or delete a change made elsewhere that this device
  // has not shown yet.
  // An item Community marks deleted was removed on another device; only
  // items Community has never had are sent again.
  const missingInCloud = <T extends { deleted: boolean }>(cloudItems: Record<string, T>, desiredItems: Record<string, unknown>, id: string) =>
    Boolean(desiredItems[id]) && !cloudItems[id];
  for (const id of [...allNodeIds].sort()) {
    if (!editedHere(base?.nodes, desired.nodes, id, sameNode) && !missingInCloud(shadow.nodes, desired.nodes, id)) continue;
    const before = shadow.nodes[id]; const after = desired.nodes[id];
    if (after && (!before || before.name !== after.name || before.parentId !== after.parentId || before.accentId !== after.accentId || before.position !== after.position || before.deleted)) {
      const parentKey = after.parentId || "__root__"; const expectedParent = parentRevisions[parentKey] || 0;
      operations.push({ type: "taxonomy.upsert", operationId: await stableUuid(intent.id, `node:${id}`), origin: "desktop", node: after, expectedNodeRevision: before?.nodeRevision || 0, expectedParentListRevision: expectedParent });
      parentRevisions[parentKey] = expectedParent + 1;
    } else if (before && !after && !before.deleted) {
      const parentKey = before.parentId || "__root__"; const expectedParent = parentRevisions[parentKey] || 0;
      operations.push({ type: "taxonomy.delete", operationId: await stableUuid(intent.id, `delete:${id}`), origin: "desktop", node: before, expectedNodeRevision: before.nodeRevision, expectedParentListRevision: expectedParent });
      parentRevisions[parentKey] = expectedParent + 1;
    }
  }
  for (const [id, color] of Object.entries(desired.colors)) {
    if (!editedHere(base?.colors, desired.colors, id, sameColor) && !missingInCloud(shadow.colors, desired.colors, id)) continue;
    const before = shadow.colors[id];
    if (!before || before.name !== color.name || before.color !== color.color || before.deleted) operations.push({ type: "color.upsert", operationId: await stableUuid(intent.id, `color:${id}`), origin: "desktop", color, expectedRevision: before?.revision || 0 });
  }
  for (const [id, color] of Object.entries(shadow.colors)) if (!desired.colors[id] && !color.deleted && editedHere(base?.colors, desired.colors, id, sameColor)) operations.push({ type: "color.delete", operationId: await stableUuid(intent.id, `color-delete:${id}`), origin: "desktop", color, expectedRevision: color.revision });
  for (const [id, collection] of Object.entries(desired.collections)) {
    if (!editedHere(base?.collections, desired.collections, id, sameCollection) && !missingInCloud(shadow.collections, desired.collections, id)) continue;
    const before = shadow.collections[id];
    if (!before || before.name !== collection.name || before.position !== collection.position || JSON.stringify(before.colorIds) !== JSON.stringify(collection.colorIds) || before.deleted) operations.push({ type: "collection.upsert", operationId: await stableUuid(intent.id, `collection:${id}`), origin: "desktop", collection, expectedRevision: before?.revision || 0 });
  }
  for (const [id, collection] of Object.entries(shadow.collections)) if (!desired.collections[id] && !collection.deleted && editedHere(base?.collections, desired.collections, id, sameCollection)) operations.push({ type: "collection.delete", operationId: await stableUuid(intent.id, `collection-delete:${id}`), origin: "desktop", collection, expectedRevision: collection.revision });
  return operations;
}

/**
 * The changes that bring Community's copy of one item to this device's
 * result. Only fields and tags in `edits` (what this device changed; by
 * default the intent's own changes) are sent, so another device's concurrent
 * edits to the same item are kept. An item Community removed gets this
 * device's whole annotation back.
 */
export async function materializeEntity(intent: EntityReplaceIntent, shadow: AnnotationSnapshotV1, edits: EntityEdits = intent.base ? entityEdits([intent]) : "all"): Promise<SyncMutationV1[]> {
  const scope: EntityEdits = shadow.deleted ? "all" : edits;
  const operations: SyncMutationV1[] = [];
  const fields: AnnotationPatchMutationV1["fields"] = {};
  const expectedRevisions: AnnotationPatchMutationV1["expectedRevisions"] = {};
  const desired = intent.desired;
  // Intents queued by older versions may hold values Community cannot accept.
  const pairs = [["rating", normalizeSyncRating(desired.rating)], ["energy", normalizeSyncEnergy(desired.energy)], ["bpm", normalizeSyncBpm(desired.bpm)], ["key", normalizeSyncKey(desired.key)]] as const;
  for (const [field, value] of pairs) {
    if (!editsInclude(scope, { field })) continue;
    if (shadow.fields[field].value !== value) { fields[field] = value; expectedRevisions[field] = shadow.fields[field].revision; }
  }
  // Older Community servers ignore these fields.
  const timestamps = { ...(desired.createdAt ? { createdAt: desired.createdAt } : {}), ...(desired.modifiedAt ? { modifiedAt: desired.modifiedAt } : {}) };
  if (Object.keys(fields).length) operations.push({ type: "annotation.patch", operationId: await stableUuid(intent.id, "fields"), origin: "desktop", entity: intent.entity, fields, expectedRevisions, ...timestamps });
  const desiredTags = new Set(desired.tagIds.filter(isSyncSafeId));
  const knownTags = new Set([...Object.keys(shadow.tagMemberships), ...desiredTags]);
  for (const tagId of [...knownTags].sort()) {
    if (!editsInclude(scope, { tagId })) continue;
    const known = shadow.tagMemberships[tagId] || { value: false, revision: 0 };
    const present = desiredTags.has(tagId);
    if (known.value !== present) operations.push({
      type: "annotation.tag-membership", operationId: await stableUuid(intent.id, `tag:${tagId}`), origin: "desktop",
      entity: intent.entity, tagId, present, expectedRevision: known.revision, ...timestamps,
    } as TagMembershipMutationV1);
  }
  return operations;
}

/** Community's revision once it accepted a change made against `expected`. */
function acceptedRevision(expected: unknown, current: number): number {
  return typeof expected === "number" && Number.isSafeInteger(expected) && expected >= 0 ? expected + 1 : current + 1;
}

/**
 * Records a confirmed change in this device's copy of Community's state. Each
 * accepted change was made against the revision it names, so the result is
 * Community's own revision, and replaying a change cannot count it twice.
 */
export function applyOperationToShadow(shadow: AnnotationSnapshotV1, operation: AnnotationMutation): AnnotationSnapshotV1 {
  const next: AnnotationSnapshotV1 = { ...shadow, fields: { ...shadow.fields }, tagMemberships: { ...shadow.tagMemberships } };
  if (operation.type === "annotation.patch") {
    const fields = Object.keys(operation.fields) as AnnotationField[];
    for (const field of fields) {
      next.fields[field] = { value: (operation.fields[field] ?? null) as never, revision: acceptedRevision(operation.expectedRevisions?.[field], shadow.fields[field]?.revision ?? 0) };
    }
    // Community counts every accepted field as one change to the item.
    next.entityRevision = shadow.entityRevision + fields.length;
    next.deleted = false;
  } else if (operation.type === "annotation.tag-membership") {
    const current = shadow.tagMemberships[operation.tagId];
    next.tagMemberships[operation.tagId] = { value: operation.present, revision: acceptedRevision(operation.expectedRevision, current?.revision ?? 0) };
    next.entityRevision = shadow.entityRevision + 1;
    next.deleted = false;
  } else {
    next.entityRevision = acceptedRevision(operation.expectedEntityRevision, shadow.entityRevision);
    next.deleted = true;
  }
  return next;
}

export function applyTaxonomyOperationToShadow(shadow: TaxonomyShadowRecord, operation: Exclude<SyncMutationV1, AnnotationMutation>): TaxonomyShadowRecord {
  const next: TaxonomyShadowRecord = {
    ...shadow, nodes: { ...shadow.nodes }, colors: { ...shadow.colors }, collections: { ...shadow.collections }, parentRevisions: { ...shadow.parentRevisions },
  };
  if (operation.type === "taxonomy.upsert" || operation.type === "taxonomy.delete") {
    const before = shadow.nodes[operation.node.id];
    const parentKey = operation.node.parentId || "__root__";
    const parentListRevision = acceptedRevision(operation.expectedParentListRevision, shadow.parentRevisions[parentKey] || 0);
    next.parentRevisions[parentKey] = parentListRevision;
    next.nodes[operation.node.id] = {
      ...operation.node, nodeRevision: acceptedRevision(operation.expectedNodeRevision, before?.nodeRevision || 0),
      parentListRevision, deleted: operation.type === "taxonomy.delete",
    };
  } else if (operation.type === "taxonomy.reorder") {
    const parentKey = operation.parentId || "__root__";
    next.parentRevisions[parentKey] = acceptedRevision(operation.expectedParentListRevision, shadow.parentRevisions[parentKey] || 0);
    operation.orderedNodeIds.forEach((id, position) => {
      const node = next.nodes[id];
      if (node && (node.parentId || null) === (operation.parentId || null)) next.nodes[id] = { ...node, position, nodeRevision: node.nodeRevision + 1 };
    });
  } else if (operation.type === "color.upsert" || operation.type === "color.delete") {
    const before = shadow.colors[operation.color.id];
    next.colors[operation.color.id] = { ...operation.color, revision: acceptedRevision(operation.expectedRevision, before?.revision || 0), deleted: operation.type === "color.delete" };
  } else if (operation.type === "collection.upsert" || operation.type === "collection.delete") {
    const before = shadow.collections[operation.collection.id];
    next.collections[operation.collection.id] = { ...operation.collection, revision: acceptedRevision(operation.expectedRevision, before?.revision || 0), deleted: operation.type === "collection.delete" };
  }
  return next;
}

interface PulledBatchOutcome { skipped: boolean; taxonomyShadowOnly: boolean }
type LibraryRecords = { tracks: Record<string, TrackData>; playlists: Record<string, PlaylistData>; artists: Record<string, ArtistData> };
type LibraryChanges = { tracks: Record<string, TrackData | null>; playlists: Record<string, PlaylistData | null>; artists: Record<string, ArtistData | null> };

function recordKeyFor(entity: AnnotationSnapshotV1["entity"]): keyof LibraryRecords {
  return entity.kind === "track" ? "tracks" : entity.kind === "artist" ? "artists" : "playlists";
}

function entityUri(entity: AnnotationSnapshotV1["entity"]): string {
  return `spotify:${entity.kind}:${entity.providerId}`;
}

/**
 * Plans one pulled Community batch inside a single IndexedDB transaction:
 * device records, sync shadows, durable-state shadows, and the cursor commit
 * together, so a quit midway never applies a change twice. Queued edits are
 * read in the same transaction; a field or tag this device changed and has
 * not backed up yet keeps its local value. Changes this device sent itself
 * update only the shadows.
 */
export function planPulledBatch(
  context: SyncTransactionContext,
  batch: PullBatch,
  options: { own: boolean; keepLocalAppState: Map<DurableAppStateDomain, DurableAppStateDocumentV2 | null>; conflicts: SyncConflictV1[] },
): SyncTransactionWrites<PulledBatchOutcome> {
  const storedCursor = (context.state.cursor as CursorRecord | undefined)?.value ?? 0;
  if (batch.cursor <= storedCursor) return { result: { skipped: true, taxonomyShadowOnly: false } };
  const snapshotPending = context.outbox.some((intent) => intent.type === "library.snapshot");
  const taxonomyPending = snapshotPending || context.outbox.some((intent) => intent.type === "taxonomy.replace");
  const intentsByEntity = new Map<string, Array<EntityReplaceIntent | EntityDeleteIntent>>();
  for (const intent of context.outbox) {
    if (intent.type !== "entity.replace" && intent.type !== "entity.delete") continue;
    const key = entityKeyV1(intent.entity);
    intentsByEntity.set(key, [...(intentsByEntity.get(key) ?? []), intent]);
  }
  const working: LibraryRecords = { tracks: { ...context.tracks }, playlists: { ...context.playlists }, artists: { ...context.artists } };
  const changes: LibraryChanges = { tracks: {}, playlists: {}, artists: {} };
  const shadows = new Map<string, AnnotationSnapshotV1>();
  const appState = new Map<string, DurableAppStateDocumentV2>();
  let taxonomyShadow = context.state["taxonomy-shadow"] as TaxonomyShadowRecord | undefined;
  let taxonomyChanged = false;
  const state: unknown[] = [];
  const deleteState: string[] = [];
  for (const operation of batch.operations) {
    if (operation.type === "app-state.replace") {
      if (operation.domain === "preferences") continue;
      const current = appState.get(operation.domain) ?? context.appState[operation.domain];
      appState.set(operation.domain, {
        domain: operation.domain, value: operation.value,
        revision: acceptedRevision(operation.expectedRevision, current?.revision ?? 0),
        updatedAt: batch.committedAt || new Date().toISOString(),
      });
      if (options.own) continue;
      const keptLocal = options.keepLocalAppState.get(operation.domain);
      if (keptLocal) state.push({ key: `pending-app-state:${operation.domain}`, ...keptLocal });
      else deleteState.push(`pending-app-state:${operation.domain}`, `${APP_STATE_CHOICE_PREFIX}${operation.domain}`);
      continue;
    }
    if (!isAnnotationMutation(operation)) {
      taxonomyShadow = applyTaxonomyOperationToShadow(taxonomyShadow ?? emptyTaxonomyShadow(), operation);
      taxonomyChanged = true;
      continue;
    }
    const key = entityKeyV1(operation.entity);
    const shadow = shadows.get(key) ?? (context.state[`entity:${key}`] as ShadowRecord | undefined)?.annotation ?? emptyShadow(operation.entity);
    shadows.set(key, applyOperationToShadow(shadow, operation));
    if (options.own) continue;
    const pending = intentsByEntity.get(key) ?? [];
    // An unsent removal, a whole-library upload, or an older full-record
    // edit keeps the whole item as this device has it.
    const edits: EntityEdits = snapshotPending || pending.at(-1)?.type === "entity.delete" ? "all" : entityEdits(pending);
    applyRemoteAnnotation(working, changes, operation, edits);
  }

  const intents: LocalSyncIntent[] = [];
  if (Object.keys(changes.tracks).length) {
    // Linked releases share tagging; queue the copies this change reaches so
    // they back up like any other edit.
    let expanded: Record<string, TrackData | null> = changes.tracks;
    try { expanded = expandRecordingEdits(context.tracks, changes.tracks); } catch { /* Unconfirmed links keep each release as it is. */ }
    for (const [uri, track] of Object.entries(expanded)) {
      if (uri in changes.tracks || !track) continue;
      changes.tracks[uri] = track;
      const intent = makeEntityReplaceIntent(uri, "track", track, batch.batchId, context.tracks[uri] ?? null);
      if (intent) intents.push(intent);
    }
  }
  let taxonomy: TagTaxonomy | undefined;
  if (taxonomyChanged && taxonomyShadow) {
    state.push(taxonomyShadow);
    if (!options.own && !taxonomyPending) {
      taxonomy = rebuildDeviceTaxonomy(taxonomyFromShadowRecord(taxonomyShadow), context.taxonomy, knownCloudTaxonomy(taxonomyShadow));
    }
  }
  for (const [key, annotation] of shadows) state.push({ key: `entity:${key}`, annotation } as ShadowRecord);
  state.push({ key: "cursor", value: batch.cursor } as CursorRecord);
  const manifest = context.state["replica-manifest"] as ReplicaManifest | undefined;
  if (manifest) state.push({ ...manifest, appliedCursor: batch.cursor, updatedAt: new Date().toISOString() });
  return {
    ...changes, ...(taxonomy ? { taxonomy } : {}), state, deleteState, intents,
    appState: [...appState.values()], conflicts: options.conflicts,
    result: { skipped: false, taxonomyShadowOnly: taxonomyChanged && !options.own && taxonomyPending },
  };
}

/** Applies another device's change to this device's record, except what this device changed and has not backed up. */
function applyRemoteAnnotation(working: LibraryRecords, changes: LibraryChanges, operation: AnnotationMutation, edits: EntityEdits): void {
  const uri = entityUri(operation.entity);
  const recordKey = recordKeyFor(operation.entity);
  const records = working[recordKey] as Record<string, TrackData | PlaylistData | ArtistData>;
  const recordChanges = changes[recordKey] as Record<string, TrackData | PlaylistData | ArtistData | null>;
  const current = records[uri];
  if (operation.type === "annotation.delete") {
    if (hasEntityEdits(edits) || !current) return;
    delete records[uri];
    recordChanges[uri] = null;
    return;
  }
  const isTrack = recordKey === "tracks";
  const next = { ...(current ?? { rating: 0, energy: 0, tagIds: [], ...(isTrack ? { bpm: null, camelotKey: null } : {}) }) } as TrackData;
  const appliedFields: AnnotationField[] = [];
  let tagsChanged = false;
  if (operation.type === "annotation.patch") {
    for (const field of Object.keys(operation.fields) as AnnotationField[]) {
      if (editsInclude(edits, { field })) continue;
      const value = operation.fields[field] ?? null;
      // A device value Community stores in this same form stays as typed.
      if (field === "rating" && normalizeSyncRating(next.rating) !== value) next.rating = Number(value ?? 0);
      else if (field === "energy" && normalizeSyncEnergy(next.energy) !== value) next.energy = Number(value ?? 0);
      else if (field === "bpm" && isTrack && normalizeSyncBpm(next.bpm) !== value) next.bpm = value as number | null;
      else if (field === "key" && isTrack && normalizeSyncKey(next.camelotKey) !== value) next.camelotKey = value as string | null;
      else continue;
      appliedFields.push(field);
    }
  } else if (!editsInclude(edits, { tagId: operation.tagId })) {
    const tags = new Set(next.tagIds);
    if (tags.has(operation.tagId) !== operation.present) {
      if (operation.present) tags.add(operation.tagId); else tags.delete(operation.tagId);
      next.tagIds = [...tags];
      tagsChanged = true;
    }
  }
  if (!appliedFields.length && !tagsChanged) return;
  const applied = operation.type === "annotation.patch"
    ? { ...operation, fields: Object.fromEntries(appliedFields.map((field) => [field, operation.fields[field]])) }
    : operation;
  // Use the other device's edit time when it sent one.
  if (shouldStampAnnotationDateModified(applied)) next.dateModified = deviceTimestamp((operation as { modifiedAt?: unknown }).modifiedAt) ?? Date.now();
  if (!current) {
    const dateCreated = deviceTimestamp((operation as { createdAt?: unknown }).createdAt);
    if (dateCreated !== undefined) next.dateCreated = dateCreated;
  }
  records[uri] = next;
  recordChanges[uri] = next;
}

function emptyTaxonomyShadow(): TaxonomyShadowRecord {
  return { key: "taxonomy-shadow", nodes: {}, colors: {}, collections: {}, parentRevisions: {} };
}

function isAnnotationMutation(operation: SyncMutationV2): operation is AnnotationMutation {
  return operation.type === "annotation.patch" || operation.type === "annotation.tag-membership" || operation.type === "annotation.delete";
}

function emptyShadow(entity: AnnotationSnapshotV1["entity"]): AnnotationSnapshotV1 {
  return { entity, fields: { rating: { value: null, revision: 0 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } }, tagMemberships: {}, entityRevision: 0, deleted: false };
}

async function readShadow(entity: AnnotationSnapshotV1["entity"]): Promise<AnnotationSnapshotV1> {
  const record = await getState<ShadowRecord>(`entity:${entityKeyV1(entity)}`);
  return record?.annotation || emptyShadow(entity);
}
async function readTaxonomyShadow(): Promise<TaxonomyShadowRecord> {
  return await getState<TaxonomyShadowRecord>("taxonomy-shadow") || { key: "taxonomy-shadow", nodes: {}, colors: {}, collections: {}, parentRevisions: {} };
}
async function readCursor() { return (await getState<CursorRecord>("cursor"))?.value || 0; }
async function readManifest() { return await getState<ReplicaManifest>("replica-manifest") || null; }
async function writeManifest(manifest: ReplicaManifest) { await putState(manifest); }

async function capturePendingAppState(): Promise<DurableAppStateDocumentV2[]> {
  const shadow = await readAppStateShadow();
  const local = await buildDurableAppStateDocuments();
  const drafts: DurableAppStateDocumentV2[] = [];
  for (const document of local) {
    const pending = await getState<DurableAppStateDocumentV2>(`pending-app-state:${document.domain}`);
    const previous = shadow[document.domain];
    if (pending || (previous && !durableStateEquals(previous.value, document.value))) {
      drafts.push({ ...document, revision: pending?.revision ?? previous?.revision ?? 0 });
    }
  }
  return drafts;
}
async function readAppStateShadow(): Promise<Partial<Record<DurableAppStateDomain, DurableAppStateDocumentV2>>> {
  const db = await openSyncDb();
  const documents = await requestResult<DurableAppStateDocumentV2[]>(db.transaction(SYNC_STORES.APP_STATE).objectStore(SYNC_STORES.APP_STATE).getAll());
  return Object.fromEntries(documents.map((document) => [document.domain, document]));
}
async function readOutbox(): Promise<LocalSyncIntent[]> { const db = await openSyncDb(); return requestResult(db.transaction(SYNC_STORES.OUTBOX).objectStore(SYNC_STORES.OUTBOX).index("by-created-at").getAll()); }
async function deleteOutbox(ids: string[]) { const db = await openSyncDb(); await completeTransaction(db.transaction(SYNC_STORES.OUTBOX, "readwrite"), (transaction) => ids.forEach((id) => transaction.objectStore(SYNC_STORES.OUTBOX).delete(id))); }
async function getState<T>(key: string): Promise<T | undefined> { const db = await openSyncDb(); return requestResult(db.transaction(SYNC_STORES.STATE).objectStore(SYNC_STORES.STATE).get(key)); }
async function putState(value: unknown) { const db = await openSyncDb(); await completeTransaction(db.transaction(SYNC_STORES.STATE, "readwrite"), (transaction) => transaction.objectStore(SYNC_STORES.STATE).put(value)); }

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const request = indexedDB.open(getTagifyDatabaseName()); request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); }; request.onerror = () => reject(request.error); });
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function completeTransaction(transaction: IDBTransaction, populate: (transaction: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => { populate(transaction); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
}
async function stableUuid(seed: string, suffix: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${seed}:${suffix}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
/**
 * Names each change by its content as well as its edit, so a change made
 * again against newer revisions (after a conflict) is a new change rather
 * than one Community already recorded, while a retry of the same request is
 * recognized as a repeat.
 */
async function withContentOperationIds<T extends SyncMutationV1>(operations: T[]): Promise<T[]> {
  return Promise.all(operations.map(async (operation) => {
    const { operationId, ...content } = operation;
    return { ...operation, operationId: await stableUuid(operationId, await sha256Hex(stableJson(content))) };
  }));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** A refreshed cloud copy lists only live items; keep what this device knows was removed. */

async function sha256Hex(value: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function sha256HexBytes(value: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

export async function buildLocalSnapshot(libraryId: string, sourceData?: TagDataStructure, generatedAt = new Date(), options: { includeEmptyAnnotations?: boolean } = {}): Promise<LibrarySnapshotV1> {
  const data = sourceData ?? await storageService.loadAll();
  const taxonomy = flattenTaxonomy(data.taxonomy);
  const annotations: AnnotationSnapshotV1[] = [];
  const add = (uri: string, value: TrackData | PlaylistData | ArtistData) => {
    const match = uri.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{10,64})$/); if (!match) return;
    const track = match[1] === "track" ? value as TrackData : null;
    if (!options.includeEmptyAnnotations && !(value.rating > 0 || value.energy > 0 || value.tagIds.length || track?.bpm || track?.camelotKey)) return;
    annotations.push({
      entity: { provider: "spotify", kind: match[1] as AnnotationSnapshotV1["entity"]["kind"], providerId: match[2] },
      fields: { rating: { value: normalizeSyncRating(value.rating), revision: 0 }, energy: { value: normalizeSyncEnergy(value.energy), revision: 0 }, bpm: { value: normalizeSyncBpm(track?.bpm), revision: 0 }, key: { value: normalizeSyncKey(track?.camelotKey), revision: 0 } },
      tagMemberships: Object.fromEntries([...new Set(value.tagIds)].filter(isSyncSafeId).map((tagId) => [tagId, { value: true, revision: 0 }])), entityRevision: 0, deleted: false,
      ...syncTimestamps(value),
    });
  };
  Object.entries(data.tracks).forEach(([uri, value]) => add(uri, value)); Object.entries(data.playlists).forEach(([uri, value]) => add(uri, value)); Object.entries(data.artists).forEach(([uri, value]) => add(uri, value));
  const snapshot: LibrarySnapshotV1 = { protocolVersion: 1, sourceStorageSchemaVersion: data.schemaVersion, libraryId, headCursor: 0, generatedAt: generatedAt.toISOString(), taxonomy: Object.values(taxonomy.nodes), colors: Object.values(taxonomy.colors), collections: Object.values(taxonomy.collections), annotations };
  assertLibrarySnapshotV1(snapshot); return snapshot;
}

function snapshotChunks(snapshot: LibrarySnapshotV1) {
  const chunks: Array<{ kind: "taxonomy" | "colors" | "collections" | "annotations"; items: unknown[] }> = [];
  const add = (kind: (typeof chunks)[number]["kind"], items: unknown[]) => { for (let index=0; index<items.length; index+=250) chunks.push({ kind, items: items.slice(index,index+250) }); };
  add("taxonomy", snapshot.taxonomy); add("colors", snapshot.colors); add("collections", snapshot.collections); add("annotations", snapshot.annotations);
  return chunks.length ? chunks : [{ kind: "annotations" as const, items: [] }];
}

async function seedShadowFromSnapshot(snapshot: LibrarySnapshotV1, cursor: number) {
  const db = await openSyncDb();
  await completeTransaction(db.transaction([SYNC_STORES.STATE, SYNC_STORES.CONFLICTS, SYNC_STORES.TOMBSTONES], "readwrite"), (transaction) => {
    const store = transaction.objectStore(SYNC_STORES.STATE);
    store.clear();
    transaction.objectStore(SYNC_STORES.CONFLICTS).clear();
    transaction.objectStore(SYNC_STORES.TOMBSTONES).clear();
    store.put({ key: "cursor", value: cursor });
    const parentRevisions = parentRevisionsFromSnapshot(snapshot.taxonomy, snapshotListRevisions(snapshot));
    store.put({ key: "taxonomy-shadow", nodes: Object.fromEntries(snapshot.taxonomy.map((node) => [node.id,node])), colors: Object.fromEntries(snapshot.colors.map((color) => [color.id,color])), collections: Object.fromEntries(snapshot.collections.map((collection) => [collection.id,collection])), parentRevisions } as TaxonomyShadowRecord);
    snapshot.annotations.forEach((annotation) => store.put({ key: `entity:${entityKeyV1(annotation.entity)}`, annotation } as ShadowRecord));
  });
}

function stateRecordsFromSnapshot(snapshot: LibrarySnapshotV1 | LibrarySnapshotV2): unknown[] {
  return [
    { key: "cursor", value: snapshot.headCursor },
    {
      key: "taxonomy-shadow",
      nodes: Object.fromEntries(snapshot.taxonomy.map((node) => [node.id, node])),
      colors: Object.fromEntries(snapshot.colors.map((color) => [color.id, color])),
      collections: Object.fromEntries(snapshot.collections.map((collection) => [collection.id, collection])),
      parentRevisions: parentRevisionsFromSnapshot(snapshot.taxonomy, snapshotListRevisions(snapshot)),
    } as TaxonomyShadowRecord,
    ...snapshot.annotations.map((annotation) => ({ key: `entity:${entityKeyV1(annotation.entity)}`, annotation } as ShadowRecord)),
  ];
}

/**
 * The library as the cloud copy holds it. replaceCloudReplica combines it with
 * the device's current records inside its transaction (dates, details, and
 * original values Community stores normalized), so no earlier read is needed.
 */
function tagDataFromSnapshot(snapshot: LibrarySnapshotV1 | LibrarySnapshotV2): TagDataStructure {
  const tracks: TagDataStructure["tracks"] = {};
  const playlists: TagDataStructure["playlists"] = {};
  const artists: TagDataStructure["artists"] = {};
  for (const annotation of snapshot.annotations) {
    if (annotation.deleted) continue;
    const uri = `spotify:${annotation.entity.kind}:${annotation.entity.providerId}`;
    // The snapshot carries saved dates, never the time it was downloaded.
    const dateCreated = deviceTimestamp(annotation.createdAt);
    const dateModified = deviceTimestamp(annotation.modifiedAt);
    const base = {
      rating: Number(annotation.fields.rating.value || 0), energy: Number(annotation.fields.energy.value || 0),
      tagIds: Object.entries(annotation.tagMemberships).filter(([, membership]) => membership.value).map(([tagId]) => tagId),
      ...(dateCreated === undefined ? {} : { dateCreated }),
      ...(dateModified === undefined ? {} : { dateModified }),
    };
    if (annotation.entity.kind === "track") tracks[uri] = { ...base, bpm: annotation.fields.bpm.value as number | null, camelotKey: annotation.fields.key.value as string | null };
    else if (annotation.entity.kind === "artist") artists[uri] = { ...base };
    else playlists[uri] = { ...base };
  }
  return { schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy: expandSyncTaxonomy(snapshot), tracks, playlists, artists, smartPlaylists: [] };
}

function mergeReviewLabels(data: TagDataStructure, device: LibrarySnapshotV2, community: LibrarySnapshotV2, plan: InitialMergePlanV1): Record<string, string> {
  const taxonomy = data.taxonomy;
  const smartPlaylists = data.smartPlaylists || [];
  const labels = Object.fromEntries(plan.conflicts.map((conflict) => {
    if (conflict.subjectId.startsWith("spotify:track:")) return [conflict.id, data.tracks[conflict.subjectId]?.name || "Saved song"];
    if (conflict.subjectId.startsWith("spotify:artist:")) return [conflict.id, data.artists[conflict.subjectId]?.name || "Saved artist"];
    if (conflict.subjectId.startsWith("spotify:playlist:") || conflict.subjectId.startsWith("spotify:album:")) return [conflict.id, data.playlists[conflict.subjectId]?.name || "Saved playlist or album"];
    if (conflict.kind === "taxonomy") return [conflict.id, taxonomy.categoriesById[conflict.subjectId]?.name || taxonomy.subcategoriesById[conflict.subjectId]?.name || taxonomy.tagsById[conflict.subjectId]?.name || "Tag organization"];
    if (conflict.kind === "smart-playlist") {
      const deviceValue = conflict.deviceValue as { playlistName?: unknown };
      const communityValue = conflict.communityValue as { playlistName?: unknown };
      return [conflict.id, String(deviceValue?.playlistName || communityValue?.playlistName || smartPlaylists.find((playlist) => playlist.id === conflict.subjectId)?.playlistName || "Smart Playlist")];
    }
    return [conflict.id, friendlySavedSetting(conflict.field || conflict.subjectId)];
  }));
  for (const [source, snapshot] of [["device", device], ["community", community]] as const) {
    for (const node of snapshot.taxonomy) labels[`taxonomy-path:${source}:${node.id}`] = taxonomyPath(snapshot, node.id);
    for (const color of snapshot.colors) labels[`color:${source}:${color.id}`] = color.name;
  }
  return labels;
}

function taxonomyPath(snapshot: LibrarySnapshotV2, nodeId: string): string {
  const nodes = new Map(snapshot.taxonomy.map((node) => [node.id, node]));
  const names: string[] = [];
  const visited = new Set<string>();
  let current = nodes.get(nodeId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return names.join(" › ") || "another group";
}

function friendlySavedSetting(value: string): string {
  return value
    .replace(/^tagify:/, "")
    .replace(/[-_:]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function replicaManifest(configuration: DesktopSyncConfiguration, snapshot: { protocolVersion: number; headCursor: number; checksum?: string }): ReplicaManifest {
  const now = new Date().toISOString();
  return {
    key: "replica-manifest", accountId: configuration.accountId, libraryId: configuration.libraryId,
    storageSchemaVersion: TAG_DATA_SCHEMA_VERSION, protocolVersion: snapshot.protocolVersion,
    appliedCursor: snapshot.headCursor, snapshotChecksum: snapshot.checksum || null,
    appStateAppliedAt: snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION ? null : now,
    initializedAt: now, updatedAt: now,
  };
}

async function markManifestAppStateApplied(): Promise<void> {
  const manifest = await readManifest();
  if (manifest) await writeManifest({ ...manifest, appStateAppliedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

function backupHealthFromSummary(summary: any): BackupHealth {
  return {
    lastBackupAt: summary?.lastCommittedAt || null,
    annotations: Number(summary?.counts?.annotations || 0),
    taxonomyNodes: Number(summary?.counts?.taxonomy || 0),
    appStateDocuments: Number(summary?.counts?.appState || 0),
    protectedDomains: summary?.backupHealth?.protectedDomains || [],
    notBackedUp: [], needsChoice: [], retrying: [], deviceOnlyChanges: 0,
  };
}

function smartPlaylistsFromAppState(appState: DurableAppStateDocumentV2[]): unknown[] {
  return sanitizeSmartPlaylists(
    appState.find((document) => document.domain === "smart-playlists")?.value,
  );
}

/**
 * Community's revision of each parent list. Nodes carry their own list's
 * revision, but a list whose children were all deleted has no node left to
 * carry it, so Community also sends every list's revision; without it the next
 * tag added to such a list would be refused on every retry.
 */
export function parentRevisionsFromSnapshot(nodes: TaxonomyNodeSnapshotV1[], listRevisions?: unknown): Record<string, number> {
  const revisions: Record<string, number> = {};
  nodes.forEach((node) => {
    const key = node.parentId || "__root__";
    revisions[key] = Math.max(revisions[key] || 0, node.parentListRevision);
  });
  if (listRevisions && typeof listRevisions === "object" && !Array.isArray(listRevisions)) {
    for (const [key, revision] of Object.entries(listRevisions as Record<string, unknown>)) {
      if ((key === "__root__" || isSyncSafeId(key)) && Number.isSafeInteger(revision) && (revision as number) >= 0) {
        revisions[key] = Math.max(revisions[key] || 0, revision as number);
      }
    }
  }
  return revisions;
}

const snapshotListRevisions = (snapshot: LibrarySnapshotV1 | LibrarySnapshotV2): unknown =>
  (snapshot as { parentListRevisions?: unknown }).parentListRevisions;

function stableTaxonomyJson(taxonomy: TagTaxonomy): string {
  return JSON.stringify(flattenTaxonomy(normalizeTaxonomyTree(taxonomy)));
}

function dispatchSyncEvent(origin: "local" | "remote", batchId: string, operations: SyncMutationV2[]) {
  window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "sync", origin, batchId, operationIds: operations.map((operation) => operation.operationId), entities: operations.filter((operation): operation is SyncChangeV1["operation"] & { entity: AnnotationSnapshotV1["entity"] } => "entity" in operation).map((operation) => entityKeyV1(operation.entity)) } }));
}

declare global {
  interface Window {
    TagifySync?: {
      beginPairing(apiBaseUrl: string, name: string, platform: string): ReturnType<typeof syncPairingService.begin>;
      pollPairing(): ReturnType<typeof syncPairingService.poll>;
      completePairing(...args: Parameters<typeof syncPairingService.complete>): ReturnType<typeof syncPairingService.complete>;
      cancelPairing(): void;
      syncNow(): Promise<void>;
      activateCurrentAccount(): Promise<void>;
      getStatus(): SyncStatus;
      getInitialMergePreview(): InitialMergeReview | null;
      getRecoveryPreview(): RecoveryPreview | null;
      getLastRecovered(): RecoveryPreview | null;
      getBackupHealth(): BackupHealth | null;
      resolveSettingsChoice(domain: DurableAppStateDomain, keep: "device" | "cloud"): Promise<void>;
      restoreFromCloud(): Promise<void>;
      commitInitialMerge(resolutions: Record<string, InitialMergeSource>): Promise<InitialMergeResultV1>;
      downloadInitialMergeBackup(): Promise<void>;
      armCloudReplacement(): void;
      replaceCloudWithCurrentLocalState(): Promise<void>;
      communityRequest(path: string, options?: CommunityRequestOptions): Promise<any>;
      unlinkLocal(): Promise<void>;
    };
  }
}

class SyncHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds: number | null) {
    super(message);
  }
}

/** The error a failed Community answer becomes; its Retry-After sets the back-off. */
function syncResponseError(response: Response, payload: { error?: { code?: string; message?: string } }): SyncHttpError {
  return new SyncHttpError(
    `${payload.error?.code || "sync_error"}: ${payload.error?.message || response.statusText}`,
    response.status,
    retryAfterSeconds(response.headers.get("retry-after")),
  );
}

/** A pull reply as Community returns it, also when it comes back with a push. */
export function isPullPage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  if (page.snapshotRequired === true || page.unchanged === true) return Number.isSafeInteger(page.headCursor);
  return Number.isSafeInteger(page.headCursor) && Array.isArray(page.batches);
}

function isSyncCapabilities(value: unknown): value is SyncCapabilitiesV1 | SyncCapabilitiesV2 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Number.isSafeInteger(candidate.protocolVersion)
    && Array.isArray(candidate.supportedProtocolVersions)
    && candidate.supportedProtocolVersions.every(Number.isSafeInteger);
}

function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

export const syncRuntime = new SyncRuntime();

/** Older cloud snapshots may still include preferences; they stay on this device. */
function librarySnapshotWithoutPreferences(snapshot: LibrarySnapshotV1 | LibrarySnapshotV2): LibrarySnapshotV1 | LibrarySnapshotV2 {
  if (snapshot.protocolVersion !== PRIVATE_SYNC_PROTOCOL_VERSION) return snapshot;
  assertLibrarySnapshotV2(snapshot);
  return { ...snapshot, appState: snapshot.appState.filter((document) => document.domain !== "preferences") };
}
