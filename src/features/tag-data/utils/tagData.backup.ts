import { defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure } from "@/types/tagData";
import { isSupportedTagDataBackup, normalizeTagDataStructure } from "./tagData.schema";

export const TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY =
  "tagify:autoFileBackupMetadata";
export const TAG_DATA_AUTO_FILE_BACKUP_FREQUENCY_KEY =
  "tagify:autoFileBackupFrequency";
export const DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  if (!isSupportedTagDataBackup(backupData)) {
    throw new Error("Invalid backup file format");
  }

  const normalized = normalizeTagDataStructure(backupData);
  if (!hasValidNormalizedTaxonomy(normalized.taxonomy)) {
    throw new Error("Invalid backup file format");
  }

  if (!isRecord(normalized.tracks)) {
    throw new Error("Invalid backup file format");
  }
}

function downloadJsonBackupFile(
  backupData: TagDataStructure,
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
    JSON.stringify(backupData.taxonomy) !== JSON.stringify(defaultTagData.taxonomy)
  );
}

export function downloadTagDataBackup(backupData: TagDataStructure): void {
  downloadJsonBackupFile(
    backupData,
    `tagify-backup-${new Date().toISOString().split("T")[0]}.json`,
  );
}

export function maybeDownloadAutomaticTagDataFileBackup(
  backupData: TagDataStructure,
  options: {
    frequency?: AutoFileBackupFrequency;
    intervalMs?: number;
    now?: number;
  } = {},
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
  const serializedBackup = JSON.stringify(backupData);
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
    downloadJsonBackupFile(backupData, filename);

    const metadata: TagDataAutoFileBackupMetadata = {
      createdAt: now,
      lastBackedUpAt: now,
      trackCount: Object.keys(backupData.tracks).length,
      playlistCount: Object.keys(backupData.playlists || {}).length,
      artistCount: Object.keys(backupData.artists || {}).length,
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
