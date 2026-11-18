// Library history catch-up (Community docs/LIBRARY_HISTORY_2026-11.md, slice 3). Tagify desktop keeps
// its own log of the changes the member made to their tags, ratings, energy and tag list (slice 2).
// Community logs changes as they sync (slice 1), so edits made before a desktop connected, or while it
// wasn't connected, are only on the desktop. After the first connect, and after a backup is restored
// onto Community, the desktop uploads those rows here, once.
//
// A side route next to sync, never a push operation: an older server refuses a whole push batch that
// carries an operation it doesn't know. Tagify sends only when capabilities list `historyBackfill`.
// GET ?deviceId answers the window Community accepts; POST sends one page of rows.
import { TAG_MEMBERSHIP_METHOD_PATTERN } from "./tagMethods";

export const LIBRARY_HISTORY_BACKFILL_TYPE = "library.history-backfill" as const;
export const LIBRARY_HISTORY_BACKFILL_PROTOCOL_VERSION = 1 as const;
export const LIBRARY_HISTORY_BACKFILL_PATH = "/api/v2/sync/history-backfill" as const;
export const MAX_LIBRARY_HISTORY_BACKFILL_ROWS = 500;
export const MAX_LIBRARY_HISTORY_TAG_NAME_LENGTH = 80;

/** Must match `tagify_sync.library_history.kind` (Community migration 0570). */
export const LIBRARY_HISTORY_ROW_KINDS = [
  "tag_added",
  "tag_removed",
  "rating",
  "energy",
  "tag_created",
  "tag_renamed",
  "tag_deleted",
  "snapshot",
] as const;
export type LibraryHistoryRowKind = (typeof LIBRARY_HISTORY_ROW_KINDS)[number];

export interface LibraryHistoryBackfillEntityV1 {
  provider: "spotify";
  kind: "track" | "album" | "playlist" | "artist";
  providerId: string;
}

export interface LibraryHistoryBackfillRowV1 {
  kind: LibraryHistoryRowKind;
  /** The song, album, playlist or artist; absent on tag list and snapshot rows. */
  entity?: LibraryHistoryBackfillEntityV1;
  tagId?: string;
  /** On tag_created and tag_renamed only. */
  tagName?: string;
  /** Rating or energy before and after (0.5 to 10); null when there was none. */
  from?: number | null;
  to?: number | null;
  method: string;
  /** When the change happened, on the desktop's clock, in milliseconds since 1970. */
  occurredAt: number;
}

export interface LibraryHistoryBackfillV1 {
  type: typeof LIBRARY_HISTORY_BACKFILL_TYPE;
  protocolVersion: typeof LIBRARY_HISTORY_BACKFILL_PROTOCOL_VERSION;
  deviceId: string;
  rows: LibraryHistoryBackfillRowV1[];
}

/**
 * What Community accepts. `enabled` false: the log is switched off; send nothing and keep the rows.
 * Rows must fall within [earliest, latest]. `historySince` is when Community started logging changes
 * as they sync: a desktop edit made while connected after that time is already in the log.
 */
export interface LibraryHistoryBackfillWindowV1 {
  enabled: boolean;
  historySince: string;
  earliest: string;
  latest: string;
}

/** One page's outcome; every row is counted once. `disabled`: nothing was stored, send again later. */
export interface LibraryHistoryBackfillResultV1 {
  stored: number;
  duplicate: number;
  skipped: number;
  disabled?: boolean;
}

export interface LibraryHistoryBackfillCapabilityV1 {
  path: typeof LIBRARY_HISTORY_BACKFILL_PATH;
  protocolVersion: typeof LIBRARY_HISTORY_BACKFILL_PROTOCOL_VERSION;
  maxRows: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID = /^[A-Za-z0-9]{10,64}$/;
const TAG_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const ENTITY_KINDS = new Set(["track", "album", "playlist", "artist"]);
const ENTITY_ROW_KINDS = new Set<string>(["tag_added", "tag_removed", "rating", "energy"]);
const TAG_ROW_KINDS = new Set<string>(["tag_added", "tag_removed", "tag_created", "tag_renamed", "tag_deleted"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function fail(): never {
  throw new Error("Invalid library history");
}

function isLevel(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10);
}

export function isLibraryHistoryBackfillEntity(value: unknown): value is LibraryHistoryBackfillEntityV1 {
  return record(value) && value.provider === "spotify" && typeof value.kind === "string" && ENTITY_KINDS.has(value.kind)
    && typeof value.providerId === "string" && PROVIDER_ID.test(value.providerId);
}

export function assertLibraryHistoryBackfillRow(value: unknown): asserts value is LibraryHistoryBackfillRowV1 {
  if (!record(value) || typeof value.kind !== "string" || !(LIBRARY_HISTORY_ROW_KINDS as readonly string[]).includes(value.kind)) fail();
  const kind = value.kind;
  if (ENTITY_ROW_KINDS.has(kind) ? !isLibraryHistoryBackfillEntity(value.entity) : value.entity !== undefined) fail();
  if (TAG_ROW_KINDS.has(kind) ? typeof value.tagId !== "string" || !TAG_ID.test(value.tagId) : value.tagId !== undefined) fail();
  if (kind === "tag_created" || kind === "tag_renamed") {
    if (typeof value.tagName !== "string" || value.tagName.length < 1 || value.tagName.length > MAX_LIBRARY_HISTORY_TAG_NAME_LENGTH) fail();
  } else if (value.tagName !== undefined) fail();
  if (kind === "rating" || kind === "energy") {
    if (!isLevel(value.from) || !isLevel(value.to)) fail();
  } else if (value.from !== undefined || value.to !== undefined) fail();
  if (typeof value.method !== "string" || !TAG_MEMBERSHIP_METHOD_PATTERN.test(value.method)) fail();
  if (typeof value.occurredAt !== "number" || !Number.isSafeInteger(value.occurredAt) || value.occurredAt <= 0) fail();
}

export function assertLibraryHistoryBackfill(value: unknown): asserts value is LibraryHistoryBackfillV1 {
  if (!record(value) || value.type !== LIBRARY_HISTORY_BACKFILL_TYPE || value.protocolVersion !== LIBRARY_HISTORY_BACKFILL_PROTOCOL_VERSION
    || typeof value.deviceId !== "string" || !UUID.test(value.deviceId)
    || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > MAX_LIBRARY_HISTORY_BACKFILL_ROWS) fail();
  value.rows.forEach(assertLibraryHistoryBackfillRow);
}

export function assertLibraryHistoryBackfillWindow(value: unknown): asserts value is LibraryHistoryBackfillWindowV1 {
  if (!record(value) || typeof value.enabled !== "boolean") fail();
  for (const key of ["historySince", "earliest", "latest"] as const) {
    if (typeof value[key] !== "string" || Number.isNaN(Date.parse(value[key] as string))) fail();
  }
}

export function assertLibraryHistoryBackfillResult(value: unknown): asserts value is LibraryHistoryBackfillResultV1 {
  if (!record(value)) fail();
  for (const key of ["stored", "duplicate", "skipped"] as const) {
    if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || (value[key] as number) < 0) fail();
  }
  if (value.disabled !== undefined && typeof value.disabled !== "boolean") fail();
}
