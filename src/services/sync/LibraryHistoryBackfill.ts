import {
  assertLibraryHistoryBackfillResult,
  assertLibraryHistoryBackfillRow,
  assertLibraryHistoryBackfillWindow,
  LIBRARY_HISTORY_BACKFILL_PROTOCOL_VERSION,
  LIBRARY_HISTORY_BACKFILL_TYPE,
  MAX_LIBRARY_HISTORY_BACKFILL_ROWS,
  type LibraryHistoryBackfillCapabilityV1,
  type LibraryHistoryBackfillRowV1,
  type LibraryHistoryBackfillV1,
} from "@tagify/sync-contracts";
import type { LibraryHistoryRow } from "@/services/storage/libraryHistory";
import { entityFromUri, HISTORY_BACKFILL_STATE_KEY, normalizeSyncEnergy, normalizeSyncRating } from "./SyncLocalState";

/**
 * Library history catch-up (tagify-community `docs/LIBRARY_HISTORY_2026-11.md`, slice 3). Community
 * logs changes as they sync; changes made on this computer before it connected (or while it wasn't
 * connected) are only in this device's own log. After the first connect and after a backup is
 * restored onto Community, Tagify sends those rows once, oldest first, in pages.
 *
 * The `history-backfill` sync-state record keeps how far Community accepted (`acceptedThroughId`,
 * the last history row id it answered for, including rows passed over before it) and whether a
 * catch-up is still owed (`pending`). Community ignores exact repeats, so sending a page again after
 * a lost answer is harmless.
 */
export interface HistoryBackfillRecord {
  key: typeof HISTORY_BACKFILL_STATE_KEY;
  libraryId: string;
  acceptedThroughId: number;
  /** A catch-up was asked for and hasn't finished yet. */
  pending: boolean;
}

export type HistoryBackfillOutcome = "unsupported" | "disabled" | "done" | "failed";

export interface HistoryBackfillContext {
  capability: LibraryHistoryBackfillCapabilityV1 | undefined;
  libraryId: string;
  deviceId: string;
  /** A Community request: GET without a body, POST with one. Rejects on a failed answer. */
  request(path: string, body?: unknown): Promise<unknown>;
  readRows(afterId: number, limit: number): Promise<LibraryHistoryRow[]>;
  getRecord(): Promise<HistoryBackfillRecord | undefined>;
  putRecord(record: HistoryBackfillRecord): Promise<void>;
}

export function isHistoryBackfillCapability(value: unknown): value is LibraryHistoryBackfillCapabilityV1 {
  const capability = value as Partial<LibraryHistoryBackfillCapabilityV1> | null | undefined;
  return !!capability && typeof capability === "object" && typeof capability.path === "string" && capability.path.startsWith("/")
    && capability.protocolVersion === LIBRARY_HISTORY_BACKFILL_PROTOCOL_VERSION
    && typeof capability.maxRows === "number" && Number.isSafeInteger(capability.maxRows) && capability.maxRows > 0;
}

/** Marks a catch-up as owed for this library; another library's progress starts again from the first row. */
export function pendingHistoryBackfill(record: HistoryBackfillRecord | undefined, libraryId: string): HistoryBackfillRecord {
  return {
    key: HISTORY_BACKFILL_STATE_KEY,
    libraryId,
    acceptedThroughId: record?.libraryId === libraryId ? record.acceptedThroughId : 0,
    pending: true,
  };
}

const storageKind = (uri: string): "track" | "playlist" | "artist" =>
  uri.startsWith("spotify:artist:") ? "artist" : uri.startsWith("spotify:track:") ? "track" : "playlist";

/** Community's form of one row, or null for a row it can't take (an item outside Spotify, an invalid value). */
export function backfillRow(row: LibraryHistoryRow): LibraryHistoryBackfillRowV1 | null {
  const level = row.kind === "rating" ? normalizeSyncRating : normalizeSyncEnergy;
  const levels = row.kind === "rating" || row.kind === "energy"
    ? { from: row.from == null ? null : level(row.from), to: row.to == null ? null : level(row.to) }
    : {};
  let entity: LibraryHistoryBackfillRowV1["entity"];
  if (row.uri !== undefined) {
    const ref = entityFromUri(row.uri, storageKind(row.uri));
    if (!ref) return null;
    entity = { provider: "spotify", kind: ref.kind as NonNullable<LibraryHistoryBackfillRowV1["entity"]>["kind"], providerId: ref.providerId };
  }
  const candidate: LibraryHistoryBackfillRowV1 = {
    kind: row.kind,
    ...(entity ? { entity } : {}),
    ...(row.tagId !== undefined ? { tagId: row.tagId } : {}),
    ...(row.tagName !== undefined ? { tagName: row.tagName } : {}),
    ...levels,
    method: row.method,
    occurredAt: row.occurredAt,
  };
  try {
    assertLibraryHistoryBackfillRow(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Sends the history rows Community never logged. Resolves with what happened; never rejects, so it
 * can't stop sync. Only a page Community answered moves the record forward.
 */
export async function runHistoryBackfill(context: HistoryBackfillContext): Promise<HistoryBackfillOutcome> {
  const { capability } = context;
  if (!isHistoryBackfillCapability(capability)) return "unsupported";
  try {
    const record = await context.getRecord();
    let acceptedThroughId = record?.libraryId === context.libraryId ? record.acceptedThroughId : 0;
    const window = await context.request(`${capability.path}?deviceId=${encodeURIComponent(context.deviceId)}`);
    assertLibraryHistoryBackfillWindow(window);
    if (!window.enabled) return "disabled";
    const historySince = Date.parse(window.historySince);
    const earliest = Date.parse(window.earliest);
    const latest = Date.parse(window.latest);
    const pageSize = Math.min(capability.maxRows, MAX_LIBRARY_HISTORY_BACKFILL_ROWS);
    const save = (pending: boolean) => context.putRecord({ key: HISTORY_BACKFILL_STATE_KEY, libraryId: context.libraryId, acceptedThroughId, pending });

    let scannedThroughId = acceptedThroughId;
    let exhausted = false;
    while (!exhausted) {
      const page: LibraryHistoryBackfillRowV1[] = [];
      while (page.length < pageSize) {
        const rows = await context.readRows(scannedThroughId, pageSize);
        if (!rows.length) { exhausted = true; break; }
        for (const row of rows) {
          scannedThroughId = row.id ?? scannedThroughId;
          // Community already logged a change synced as it happened after it started logging.
          const logged = row.live === true && row.occurredAt >= historySince;
          const inWindow = row.occurredAt >= earliest && row.occurredAt <= latest;
          const sendable = !logged && inWindow ? backfillRow(row) : null;
          if (sendable) page.push(sendable);
          if (page.length === pageSize) break;
        }
        if (rows.length < pageSize && page.length < pageSize) { exhausted = true; break; }
      }
      if (page.length) {
        const body: LibraryHistoryBackfillV1 = {
          type: LIBRARY_HISTORY_BACKFILL_TYPE,
          protocolVersion: LIBRARY_HISTORY_BACKFILL_PROTOCOL_VERSION,
          deviceId: context.deviceId,
          rows: page,
        };
        const result = await context.request(capability.path, body);
        assertLibraryHistoryBackfillResult(result);
        if (result.disabled) return "disabled";
      }
      if (scannedThroughId !== acceptedThroughId || exhausted) {
        acceptedThroughId = scannedThroughId;
        await save(!exhausted);
      }
    }
    return "done";
  } catch (error) {
    console.warn("Tagify sync: library history catch-up will try again later", error instanceof Error ? error.message : error);
    return "failed";
  }
}
