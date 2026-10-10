import { normalizePrivateNotesBackup, type PrivateNotesBackup } from "@/services/sync/PrivateNotes";
import packageJson from "@/package";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure } from "@/types/tagData";
import type {
  InstalledTaxonomyRecordV1,
  OwnerTaxonomyIdentityMappingV1,
  PublicationPolicyV1,
  TagifyBackupEnvelopeV2,
} from "@tagify/community-contracts";
import { isSupportedTagDataBackup, normalizeTagDataStructure } from "./tagData.schema";

export const TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY =
  "tagify:autoFileBackupMetadata";
export const TAG_DATA_AUTO_FILE_BACKUP_FREQUENCY_KEY =
  "tagify:autoFileBackupFrequency";
export const DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * Changes made after the latest file are saved again when Tagify goes quiet,
 * at most this many times per chosen backup period, so the newest edits reach
 * a file without a download for every change.
 */
export const TRAILING_FILE_BACKUPS_PER_INTERVAL = 4;
// Keep a download's file available long enough for Spotify to finish saving it.
const DOWNLOAD_URL_LIFETIME_MS = 60_000;
export const TAGIFY_BACKUP_EXPORT_VERSION = packageJson.version;

export interface CommunityBackupStateV2 {
  publicationPolicy: PublicationPolicyV1 | null;
  ownerIdentityMapping: OwnerTaxonomyIdentityMappingV1 | null;
  installations: InstalledTaxonomyRecordV1[];
}

/** Saved filters, playlist rules, and preferences. Older backups omit it. */
export type BackupAppState = Partial<Record<"filter-formulas" | "playlist-rules" | "preferences", unknown>>;

export type TagifyBackupEnvelope = TagifyBackupEnvelopeV2<TagDataStructure> & { appState?: BackupAppState; privateNotes?: PrivateNotesBackup };

export interface CompleteBackupContents {
  privateNotes?: PrivateNotesBackup;
  community?: CommunityBackupStateV2;
  appState?: BackupAppState;
}

export type AutoFileBackupFrequency =
  | "never"
  | "daily"
  | "every3days"
  | "weekly"
  | "monthly";

export const DEFAULT_AUTO_FILE_BACKUP_FREQUENCY: AutoFileBackupFrequency = "daily";

export const AUTO_FILE_BACKUP_FREQUENCY_OPTIONS: Array<{
  value: AutoFileBackupFrequency;
  label: string;
  description: string;
}> = [
  {
    value: "daily",
    label: "Every day",
    description: "Best protection. Recommended if you tag often.",
  },
  {
    value: "every3days",
    label: "Every 3 days",
    description: "A balanced choice with fewer downloads.",
  },
  {
    value: "weekly",
    label: "Every week",
    description: "Good if your library changes occasionally.",
  },
  {
    value: "monthly",
    label: "Every month",
    description: "Minimal interruption, but more work can be at risk.",
  },
  {
    value: "never",
    label: "Never",
    description: "Not recommended. Use manual exports regularly.",
  },
];

export interface TagDataAutoFileBackupMetadata {
  createdAt: number;
  trackCount: number;
  playlistCount: number;
  artistCount: number;
  smartPlaylistCount: number;
  schemaVersion: number;
  sizeBytes: number;
  checksum: string;
  filename: string;
  lastBackedUpAt: number;
}

export type AutomaticFileBackupResult =
  | {
      status: "created";
      metadata: TagDataAutoFileBackupMetadata;
    }
  | {
      status: "skipped";
      reason: "disabled" | "empty-data" | "too-soon" | "unchanged";
    }
  | {
      status: "failed";
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidNormalizedTaxonomy(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.categoryOrder) &&
    isRecord(value.categoriesById) &&
    isRecord(value.subcategoriesById) &&
    isRecord(value.tagsById)
  );
}

export function validateTagDataBackup(backupData: unknown): void {
  const tagData = extractTagDataFromBackup(backupData);
  if (!isSupportedTagDataBackup(tagData)) {
    throw new Error("Invalid backup file format");
  }

  const normalized = normalizeTagDataStructure(tagData);
  if (!hasValidNormalizedTaxonomy(normalized.taxonomy)) {
    throw new Error("Invalid backup file format");
  }

  if (!isRecord(normalized.tracks)) {
    throw new Error("Invalid backup file format");
  }

  const rawSmartPlaylists = isRecord(tagData)
    ? tagData.smartPlaylists
    : undefined;
  if (
    rawSmartPlaylists !== undefined &&
    (!Array.isArray(rawSmartPlaylists) ||
      (normalized.smartPlaylists?.length ?? 0) !== rawSmartPlaylists.length)
  ) {
    throw new Error("Invalid smart playlist data in backup file");
  }
}

export function extractTagDataFromBackup(backupData: unknown): unknown {
  if (!isRecord(backupData) || backupData.format !== "tagify-backup") return backupData;
  if (backupData.envelopeVersion !== 2 || !isRecord(backupData.community) || !("tagData" in backupData)) {
    throw new Error("Unsupported Tagify backup envelope version");
  }
  return backupData.tagData;
}

/** True when the file says whether the library has Smart Playlists, even an empty list. */
export function backupIncludesSmartPlaylists(backupData: unknown): boolean {
  const tagData = extractTagDataFromBackup(backupData);
  return isRecord(tagData) && Array.isArray(tagData.smartPlaylists);
}

export function extractAppStateFromBackup(backupData: unknown): BackupAppState | null {
  if (!isRecord(backupData) || backupData.format !== "tagify-backup" || !isRecord(backupData.appState)) return null;
  const appState = backupData.appState;
  return Object.fromEntries((["filter-formulas", "playlist-rules", "preferences"] as const)
    .filter((domain) => domain in appState)
    .map((domain) => [domain, appState[domain]]));
}

/** Automatic backups made before Tagify 3.0 stored an empty Community block. */
export function hasCommunityBackupState(state: CommunityBackupStateV2): boolean {
  return Boolean(state.publicationPolicy || state.ownerIdentityMapping || state.installations.length);
}

export function extractCommunityStateFromBackup(
  backupData: unknown,
): CommunityBackupStateV2 | null {
  if (!isRecord(backupData) || backupData.format !== "tagify-backup") return null;
  if (backupData.envelopeVersion !== 2 || !isRecord(backupData.community)) {
    throw new Error("Unsupported Tagify backup envelope version");
  }
  const community = backupData.community;
  return {
    publicationPolicy: (community.publicationPolicy as PublicationPolicyV1 | null) ?? null,
    ownerIdentityMapping: (community.ownerIdentityMapping as OwnerTaxonomyIdentityMappingV1 | null) ?? null,
    installations: Array.isArray(community.installations)
      ? (community.installations as InstalledTaxonomyRecordV1[])
      : [],
  };
}

export function buildTagifyBackupEnvelopeV2(
  tagData: TagDataStructure,
  community: CommunityBackupStateV2 = {
    publicationPolicy: null,
    ownerIdentityMapping: null,
    installations: [],
  },
  now = new Date(),
  appState?: BackupAppState,
  privateNotes?: PrivateNotesBackup,
): TagifyBackupEnvelope {
  return {
    format: "tagify-backup",
    envelopeVersion: 2,
    exportedAt: now.toISOString(),
    tagifyVersion: TAGIFY_BACKUP_EXPORT_VERSION,
    tagData,
    community,
    ...(appState ? { appState } : {}),
    ...(privateNotes ? { privateNotes } : {}),
  };
}

function downloadJsonBackupFile(
  backupData: unknown,
  filename: string,
): void {
  const jsonData = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonData], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    // Revoking right away can cancel a download that hasn't started yet.
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
  }
}

function getDatedBackupFilename(prefix: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}.json`;
}

/** Identifies a backup's contents; the export time alone never makes a file "changed". */
function backupContentChecksum(envelope: TagifyBackupEnvelope): string {
  return hashString(JSON.stringify({ ...envelope, exportedAt: undefined }));
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return hash.toString(36);
}

function readAutoFileBackupMetadata(): TagDataAutoFileBackupMetadata | null {
  try {
    const rawMetadata = localStorage.getItem(TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY);
    if (!rawMetadata) {
      return null;
    }

    const metadata = JSON.parse(rawMetadata) as Partial<TagDataAutoFileBackupMetadata>;
    if (
      typeof metadata.lastBackedUpAt !== "number" ||
      typeof metadata.checksum !== "string" ||
      typeof metadata.filename !== "string"
    ) {
      return null;
    }

    return metadata as TagDataAutoFileBackupMetadata;
  } catch {
    return null;
  }
}

export function isAutoFileBackupFrequency(
  value: unknown,
): value is AutoFileBackupFrequency {
  return AUTO_FILE_BACKUP_FREQUENCY_OPTIONS.some((option) => option.value === value);
}

export function getAutoFileBackupFrequencyIntervalMs(
  frequency: AutoFileBackupFrequency,
): number | null {
  switch (frequency) {
    case "never":
      return null;
    case "monthly":
      return 30 * DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS;
    case "weekly":
      return 7 * DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS;
    case "every3days":
      return 3 * DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS;
    case "daily":
    default:
      return DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS;
  }
}

export function readAutoFileBackupFrequency(): AutoFileBackupFrequency {
  try {
    const storedFrequency = localStorage.getItem(
      TAG_DATA_AUTO_FILE_BACKUP_FREQUENCY_KEY,
    );

    return isAutoFileBackupFrequency(storedFrequency)
      ? storedFrequency
      : DEFAULT_AUTO_FILE_BACKUP_FREQUENCY;
  } catch {
    return DEFAULT_AUTO_FILE_BACKUP_FREQUENCY;
  }
}

function hasBackupWorthyData(backupData: TagDataStructure): boolean {
  return (
    Object.keys(backupData.tracks).length > 0 ||
    Object.keys(backupData.playlists || {}).length > 0 ||
    Object.keys(backupData.artists || {}).length > 0 ||
    (backupData.smartPlaylists?.length ?? 0) > 0 ||
    JSON.stringify(backupData.taxonomy) !== JSON.stringify(defaultTagData.taxonomy)
  );
}

export function downloadTagDataBackup(
  backupData: TagDataStructure,
  contents: CompleteBackupContents = {},
): void {
  downloadJsonBackupFile(
    buildTagifyBackupEnvelopeV2(backupData, contents.community, new Date(), contents.appState, contents.privateNotes),
    `tagify-backup-${new Date().toISOString().split("T")[0]}.json`,
  );
}

/**
 * Saves the older copy of the library kept on this device. Its name keeps it
 * from being mistaken for the newest backup when choosing a file to import.
 */
export function downloadOlderCopyBackup(olderCopy: TagDataStructure, now = new Date()): string {
  const filename = getDatedBackupFilename("tagify-older-copy", now);
  downloadJsonBackupFile(buildTagifyBackupEnvelopeV2(olderCopy, undefined, now), filename);
  return filename;
}

/**
 * Saves the current library to Downloads before an action replaces it, such
 * as importing a file or resetting Tagify. Returns false for an empty library.
 */
export function downloadSafetyTagDataBackup(
  backupData: TagDataStructure,
  contents: CompleteBackupContents,
  reason: "before-import" | "before-reset",
  now = new Date(),
): boolean {
  if (!hasBackupWorthyData(backupData) && !Object.values(contents.privateNotes || {}).some(note => note.text || note.conflictText)) return false;
  downloadJsonBackupFile(
    buildTagifyBackupEnvelopeV2(backupData, contents.community, now, contents.appState, contents.privateNotes),
    getDatedBackupFilename(`tagify-${reason}`, now),
  );
  return true;
}

type AutomaticFileBackupOptions = {
  frequency?: AutoFileBackupFrequency;
  intervalMs?: number;
  now?: number;
} & CompleteBackupContents;

/**
 * Saves an automatic backup file when the library changed since the latest
 * file and the chosen backup period has passed. Called at startup and after
 * saves.
 */
export function maybeDownloadAutomaticTagDataFileBackup(
  backupData: TagDataStructure,
  options: AutomaticFileBackupOptions = {},
): AutomaticFileBackupResult {
  return createAutomaticFileBackup(backupData, options, regularBackupGapMs);
}

/**
 * Saves changes made after the latest automatic file. Call it when Tagify is
 * hidden, closed, or idle: the period throttle captures the library at the
 * first save of each period, so later edits would otherwise wait for a
 * later session. Throttled to a fraction of the chosen period.
 */
export function maybeDownloadTrailingTagDataFileBackup(
  backupData: TagDataStructure,
  options: AutomaticFileBackupOptions = {},
): AutomaticFileBackupResult {
  return createAutomaticFileBackup(backupData, options, trailingBackupGapMs);
}

const regularBackupGapMs = (intervalMs: number) => intervalMs;
const trailingBackupGapMs = (intervalMs: number) => intervalMs / TRAILING_FILE_BACKUPS_PER_INTERVAL;

/**
 * Why no automatic file is due, decided from two small saved settings only:
 * the chosen frequency and when the latest file was saved. Null when a file
 * may be due and the library is worth reading.
 */
function automaticBackupNotDueReason(
  intervalMs: number | null,
  now: number,
  minimumGapMs: (intervalMs: number) => number,
): "disabled" | "too-soon" | null {
  if (intervalMs === null) return "disabled";
  const previous = readAutoFileBackupMetadata();
  return previous && now - previous.lastBackedUpAt < minimumGapMs(intervalMs) ? "too-soon" : null;
}

/**
 * Cheap check for callers that run after every save: true when automatic
 * backups are on and the chosen period has passed since the latest file.
 * Reads no library data, so only call `maybeDownloadAutomaticTagDataFileBackup`
 * (which reads and serializes the whole library) when this returns true. It
 * may still skip an unchanged or empty library.
 */
export function isAutomaticFileBackupDue(now = Date.now(), frequency = readAutoFileBackupFrequency()): boolean {
  return automaticBackupNotDueReason(getAutoFileBackupFrequencyIntervalMs(frequency), now, regularBackupGapMs) === null;
}

/** Like `isAutomaticFileBackupDue`, for `maybeDownloadTrailingTagDataFileBackup`. */
export function isTrailingFileBackupDue(now = Date.now(), frequency = readAutoFileBackupFrequency()): boolean {
  return automaticBackupNotDueReason(getAutoFileBackupFrequencyIntervalMs(frequency), now, trailingBackupGapMs) === null;
}

/**
 * When a trailing backup may next be saved, or null when one may be saved
 * now (or automatic backups are off, which the backup call reports).
 */
export function getTrailingFileBackupDueAt(frequency = readAutoFileBackupFrequency()): number | null {
  const intervalMs = getAutoFileBackupFrequencyIntervalMs(frequency);
  const previous = readAutoFileBackupMetadata();
  if (intervalMs === null || !previous) return null;
  return previous.lastBackedUpAt + trailingBackupGapMs(intervalMs);
}

function createAutomaticFileBackup(
  backupData: TagDataStructure,
  options: AutomaticFileBackupOptions,
  minimumGapMs: (intervalMs: number) => number,
): AutomaticFileBackupResult {
  const frequency = options.frequency ?? readAutoFileBackupFrequency();
  const intervalMs =
    options.intervalMs ?? getAutoFileBackupFrequencyIntervalMs(frequency);
  const now = options.now ?? Date.now();

  // Decide from the saved schedule first; serializing a large library on
  // every save would make tagging lag.
  const notDue = automaticBackupNotDueReason(intervalMs, now, minimumGapMs);
  if (notDue) {
    return { status: "skipped", reason: notDue };
  }

  if (!hasBackupWorthyData(backupData) && !Object.values(options.privateNotes || {}).some(note => note.text || note.conflictText)) {
    return { status: "skipped", reason: "empty-data" };
  }

  const previousMetadata = readAutoFileBackupMetadata();
  const backupEnvelope = buildTagifyBackupEnvelopeV2(backupData, options.community, new Date(now), options.appState, options.privateNotes);
  const serializedBackup = JSON.stringify(backupEnvelope);
  const checksum = backupContentChecksum(backupEnvelope);

  if (previousMetadata?.checksum === checksum) {
    return { status: "skipped", reason: "unchanged" };
  }

  try {
    const filename = getDatedBackupFilename("tagify-auto-backup", new Date(now));
    downloadJsonBackupFile(backupEnvelope, filename);

    const metadata: TagDataAutoFileBackupMetadata = {
      createdAt: now,
      lastBackedUpAt: now,
      trackCount: Object.keys(backupData.tracks).length,
      playlistCount: Object.keys(backupData.playlists || {}).length,
      artistCount: Object.keys(backupData.artists || {}).length,
      smartPlaylistCount: backupData.smartPlaylists?.length ?? 0,
      schemaVersion: backupData.schemaVersion,
      sizeBytes: serializedBackup.length,
      checksum,
      filename,
    };

    localStorage.setItem(
      TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY,
      JSON.stringify(metadata),
    );

    return { status: "created", metadata };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown backup error",
    };
  }
}

export function extractPrivateNotesFromBackup(backupData: unknown): PrivateNotesBackup | null {
  if (!isRecord(backupData) || backupData.format !== "tagify-backup" || !("privateNotes" in backupData)) return null;
  return normalizePrivateNotesBackup(backupData.privateNotes);
}
