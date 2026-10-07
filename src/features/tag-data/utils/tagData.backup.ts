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
export const TAGIFY_BACKUP_EXPORT_VERSION = packageJson.version;

export interface CommunityBackupStateV2 {
  publicationPolicy: PublicationPolicyV1 | null;
  ownerIdentityMapping: OwnerTaxonomyIdentityMappingV1 | null;
  installations: InstalledTaxonomyRecordV1[];
}

/** Saved filters, playlist rules, and preferences. Older backups omit it. */
export type BackupAppState = Partial<Record<"filter-formulas" | "playlist-rules" | "preferences", unknown>>;

export type TagifyBackupEnvelope = TagifyBackupEnvelopeV2<TagDataStructure> & { appState?: BackupAppState };

export interface CompleteBackupContents {
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
): TagifyBackupEnvelope {
  return {
    format: "tagify-backup",
    envelopeVersion: 2,
    exportedAt: now.toISOString(),
    tagifyVersion: TAGIFY_BACKUP_EXPORT_VERSION,
    tagData,
    community,
    ...(appState ? { appState } : {}),
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
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

function getDatedBackupFilename(prefix: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${timestamp}.json`;
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
    buildTagifyBackupEnvelopeV2(backupData, contents.community, new Date(), contents.appState),
    `tagify-backup-${new Date().toISOString().split("T")[0]}.json`,
  );
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
  if (!hasBackupWorthyData(backupData)) return false;
  downloadJsonBackupFile(
    buildTagifyBackupEnvelopeV2(backupData, contents.community, now, contents.appState),
    getDatedBackupFilename(`tagify-${reason}`, now),
  );
  return true;
}

export function maybeDownloadAutomaticTagDataFileBackup(
  backupData: TagDataStructure,
  options: {
    frequency?: AutoFileBackupFrequency;
    intervalMs?: number;
    now?: number;
  } & CompleteBackupContents = {},
): AutomaticFileBackupResult {
  const frequency = options.frequency ?? readAutoFileBackupFrequency();
  const intervalMs =
    options.intervalMs ?? getAutoFileBackupFrequencyIntervalMs(frequency);

  if (intervalMs === null) {
    return { status: "skipped", reason: "disabled" };
  }

  if (!hasBackupWorthyData(backupData)) {
    return { status: "skipped", reason: "empty-data" };
  }

  const now = options.now ?? Date.now();
  const previousMetadata = readAutoFileBackupMetadata();
  const backupEnvelope = buildTagifyBackupEnvelopeV2(backupData, options.community, new Date(now), options.appState);
  const serializedBackup = JSON.stringify(backupEnvelope);
  const checksum = hashString(serializedBackup);

  if (previousMetadata?.checksum === checksum) {
    return { status: "skipped", reason: "unchanged" };
  }

  if (
    previousMetadata &&
    now - previousMetadata.lastBackedUpAt < intervalMs
  ) {
    return { status: "skipped", reason: "too-soon" };
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
