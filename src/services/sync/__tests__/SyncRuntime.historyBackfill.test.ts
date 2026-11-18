import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibrarySnapshotV1, LibrarySnapshotV2 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import type { LibraryHistoryRow } from "@/services/storage/libraryHistory";
import type { TrackData } from "@/types/tagData";
import { getTagifyDatabaseName, HISTORY_BACKFILL_STATE_KEY, type DesktopSyncConfiguration } from "../SyncLocalState";
import type { HistoryBackfillRecord } from "../LibraryHistoryBackfill";
import { syncRuntime } from "../SyncRuntime";
import { FakeCommunity, FakeDevice, putStateRecord, readStore, resetDevices, useDevice } from "./fakeCommunity";

// Library history catch-up (slice 3): after the first connect and after a backup is restored onto
// Community, the desktop sends the history rows Community never logged, once.

type Internals = {
  completeBootstrap(configuration: DesktopSyncConfiguration, snapshot: LibrarySnapshotV1 | LibrarySnapshotV2, appliedCursor: number, intentId: string): Promise<void>;
  backfillHistory(configuration: DesktopSyncConfiguration): Promise<void>;
  historyBackfillRunning: Promise<void> | null;
  historyBackfillDue: boolean | null;
  historyBackfillRetryAt: number;
  capabilities: unknown;
  capabilitiesFetchedAt: number;
};
const runtime = syncRuntime as unknown as Internals;

const HOUR = 60 * 60_000;
const SINCE = Date.UTC(2026, 10, 1);
const EARLIEST = Date.UTC(2025, 0, 1);
const song = (letter: string) => `spotify:track:${letter.repeat(22)}`;
const providerId = (letter: string) => letter.repeat(22);

let community: FakeCommunity;
let device: FakeDevice;

/** Rows as the desktop kept them; `live` false: saved while it wasn't connected. */
async function addHistory(rows: LibraryHistoryRow[]): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(getTagifyDatabaseName());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("history", "readwrite");
      rows.forEach((row) => transaction.objectStore("history").add(row));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function backfillRecord(): Promise<HistoryBackfillRecord | undefined> {
  return (await readStore<HistoryBackfillRecord>("sync-state")).find((record) => record.key === HISTORY_BACKFILL_STATE_KEY);
}

const posts = () => community.historyRequests.flatMap((request) => request.method === "POST" ? [request.rows] : []);

/** Community confirms the first upload; the catch-up runs after it. */
async function firstUpload(): Promise<void> {
  await runtime.completeBootstrap(device.configuration, community.snapshot(), community.headCursor, crypto.randomUUID());
  await runtime.historyBackfillRunning;
}

const offline = (rows: Array<Omit<LibraryHistoryRow, "method" | "live"> & Partial<LibraryHistoryRow>>): LibraryHistoryRow[] =>
  rows.map((row) => ({ method: "typed", live: false, ...row }));

beforeEach(async () => {
  community = new FakeCommunity();
  community.historyBackfill = {
    enabled: true, historySince: new Date(SINCE).toISOString(),
    earliest: new Date(EARLIEST).toISOString(), latest: new Date(Date.now() + HOUR).toISOString(), maxRows: 500,
  };
  device = new FakeDevice("history");
  Object.assign(device.configuration, { deviceId: "8d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d" });
  resetDevices();
  await useDevice(device);
  vi.spyOn(globalThis, "fetch").mockImplementation(community.fetch);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  runtime.capabilities = { ...community.capabilities(), pullAcknowledgesCursor: true };
  runtime.capabilitiesFetchedAt = Date.now();
  runtime.historyBackfillDue = null;
  runtime.historyBackfillRetryAt = 0;
});

afterEach(() => {
  runtime.capabilities = null;
  runtime.capabilitiesFetchedAt = 0;
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("library history catch-up", () => {
  it("sends the history kept before connecting once after the first upload, leaving saved songs as they were", async () => {
    const track: TrackData = { rating: 4, energy: 0, bpm: null, tagIds: ["chill"], dateCreated: 10, dateModified: 20 };
    await indexedDBStorage.saveTrack(song("a"), track);
    const before = await indexedDBStorage.getTrack(song("a"));
    await addHistory(offline([
      { kind: "tag_created", tagId: "chill", tagName: "Chill", occurredAt: SINCE - 3 * HOUR },
      { kind: "tag_added", uri: song("a"), tagId: "chill", occurredAt: SINCE - 2 * HOUR },
      { kind: "rating", uri: song("a"), from: null, to: 4, method: "unknown", occurredAt: SINCE - HOUR },
      // Passed over: a local file Community can't hold, and a change before the window.
      { kind: "tag_added", uri: "spotify:local:Artist:Album:Song:180", tagId: "chill", occurredAt: SINCE - HOUR },
      { kind: "rating", uri: song("b"), from: null, to: 2, occurredAt: EARLIEST - HOUR },
      { kind: "snapshot", reason: "import", method: "unknown", occurredAt: SINCE + HOUR },
    ]));

    await firstUpload();

    expect(posts()).toEqual([[
      { kind: "tag_created", tagId: "chill", tagName: "Chill", method: "typed", occurredAt: SINCE - 3 * HOUR },
      { kind: "tag_added", entity: { provider: "spotify", kind: "track", providerId: providerId("a") }, tagId: "chill", method: "typed", occurredAt: SINCE - 2 * HOUR },
      { kind: "rating", entity: { provider: "spotify", kind: "track", providerId: providerId("a") }, from: null, to: 4, method: "unknown", occurredAt: SINCE - HOUR },
      { kind: "snapshot", method: "unknown", occurredAt: SINCE + HOUR },
    ]]);
    const all = await indexedDBStorage.getLibraryHistory();
    expect(await backfillRecord()).toEqual({ key: HISTORY_BACKFILL_STATE_KEY, libraryId: device.configuration.libraryId, acceptedThroughId: all.at(-1)!.id, pending: false });
    expect(await indexedDBStorage.getTrack(song("a"))).toEqual(before);
    expect(before?.dateModified).toBe(20);

    // A later first upload (the same library again) finds nothing left to send.
    await firstUpload();
    expect(posts()).toHaveLength(1);
  });

  it("after a backup is restored onto Community, sends only the rows Community hasn't accepted yet", async () => {
    await addHistory(offline([
      { kind: "tag_added", uri: song("a"), tagId: "one", occurredAt: SINCE - 3 * HOUR },
      { kind: "tag_added", uri: song("b"), tagId: "one", occurredAt: SINCE - 2 * HOUR },
    ]));
    await firstUpload();
    await addHistory(offline([{ kind: "tag_removed", uri: song("c"), tagId: "two", occurredAt: SINCE - HOUR }]));

    syncRuntime.armCloudReplacement();
    await syncRuntime.replaceCloudWithCurrentLocalState();
    await runtime.historyBackfillRunning;

    expect(posts().map((rows) => rows.length)).toEqual([2, 1]);
    expect(posts()[1]).toEqual([{ kind: "tag_removed", entity: { provider: "spotify", kind: "track", providerId: providerId("c") }, tagId: "two", method: "typed", occurredAt: SINCE - HOUR }]);
    expect(community.historyRows.size).toBe(3);
    expect((await backfillRecord())?.pending).toBe(false);
  });

  it("never sends a change made while connected after Community started logging", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SINCE + 2 * HOUR);
    community.historyBackfill!.latest = new Date(SINCE + 3 * HOUR).toISOString();
    // Connected, but before Community logged changes as they synced: still sent.
    await addHistory([{ kind: "energy", uri: song("a"), from: null, to: 7, method: "unknown", occurredAt: SINCE - HOUR, live: true }]);
    await indexedDBStorage.saveTrack(song("b"), { rating: 3, energy: 0, bpm: null, tagIds: [], dateCreated: 1, dateModified: 1 });
    expect((await indexedDBStorage.getLibraryHistory()).at(-1)).toMatchObject({ kind: "rating", live: true });

    await firstUpload();

    expect(posts()).toEqual([[{ kind: "energy", entity: { provider: "spotify", kind: "track", providerId: providerId("a") }, from: null, to: 7, method: "unknown", occurredAt: SINCE - HOUR }]]);
    expect((await backfillRecord())?.acceptedThroughId).toBe((await indexedDBStorage.getLibraryHistory()).at(-1)!.id);
  });

  it("asks nothing of a Community that doesn't offer the catch-up, and keeps it owed", async () => {
    community.historyBackfill = null;
    runtime.capabilities = { ...community.capabilities(), pullAcknowledgesCursor: true };
    await addHistory(offline([{ kind: "tag_added", uri: song("a"), tagId: "one", occurredAt: SINCE - HOUR }]));

    await firstUpload();

    const historyCalls = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input).includes("history-backfill"));
    expect(historyCalls).toEqual([]);
    expect(await backfillRecord()).toMatchObject({ acceptedThroughId: 0, pending: true });
  });

  it("sends nothing and keeps its place while Community has the history switched off", async () => {
    community.historyBackfill!.enabled = false;
    await addHistory(offline([{ kind: "tag_added", uri: song("a"), tagId: "one", occurredAt: SINCE - HOUR }]));
    const owed = { key: HISTORY_BACKFILL_STATE_KEY, libraryId: device.configuration.libraryId, acceptedThroughId: 0, pending: true };
    await putStateRecord(owed);

    await runtime.backfillHistory(device.configuration);

    expect(community.historyRequests).toEqual([{ method: "GET" }]);
    expect(await backfillRecord()).toEqual(owed);
  });

  it("keeps its place when a page fails, and sends it again on a later sync", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SINCE + HOUR);
    await addHistory(offline([
      { kind: "tag_added", uri: song("a"), tagId: "one", occurredAt: SINCE - 2 * HOUR },
      { kind: "tag_added", uri: song("b"), tagId: "one", occurredAt: SINCE - HOUR },
    ]));
    community.failNextHistoryPage = 503;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await firstUpload();
    expect(posts()).toHaveLength(1);
    expect(await backfillRecord()).toMatchObject({ acceptedThroughId: 0, pending: true });

    // The next sync soon after doesn't ask again; one after the retry wait does.
    await runtime.backfillHistory(device.configuration);
    expect(posts()).toHaveLength(1);
    vi.setSystemTime(SINCE + 2 * HOUR);
    await runtime.backfillHistory(device.configuration);

    expect(posts().map((rows) => rows.length)).toEqual([2, 2]);
    expect(community.historyRows.size).toBe(2);
    expect(await backfillRecord()).toMatchObject({ pending: false });
  });

  it("sends a long history in pages of at most the advertised size, oldest first", async () => {
    await addHistory(offline(Array.from({ length: 1203 }, (_, index) => ({
      kind: "rating" as const, uri: song("a"), from: null, to: (index % 5) + 1, occurredAt: EARLIEST + index * 1000,
    }))));

    await firstUpload();

    expect(posts().map((rows) => rows.length)).toEqual([500, 500, 203]);
    const times = posts().flat().map((row) => row.occurredAt);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(community.historyRows.size).toBe(1203);
  });

  it("starts from the first row for another library", async () => {
    await addHistory(offline([{ kind: "tag_added", uri: song("a"), tagId: "one", occurredAt: SINCE - HOUR }]));
    await putStateRecord({ key: HISTORY_BACKFILL_STATE_KEY, libraryId: "another-library", acceptedThroughId: 9_999, pending: false });

    await firstUpload();

    expect(posts()).toHaveLength(1);
    expect(await backfillRecord()).toMatchObject({ libraryId: device.configuration.libraryId, pending: false });
  });

  it("doesn't read the history on later syncs once nothing is owed", async () => {
    await addHistory(offline([{ kind: "tag_added", uri: song("a"), tagId: "one", occurredAt: SINCE - HOUR }]));
    await firstUpload();
    const reads = vi.spyOn(indexedDBStorage, "getLibraryHistoryAfter");
    const requests = vi.mocked(globalThis.fetch).mock.calls.length;

    await runtime.backfillHistory(device.configuration);
    await runtime.backfillHistory(device.configuration);

    expect(reads).not.toHaveBeenCalled();
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(requests);
  });
});
