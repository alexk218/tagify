import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibrarySnapshotV2 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { setDesktopSyncConfiguration, setLocalPersistencePaused, type DesktopSyncConfiguration } from "../SyncLocalState";
import { syncRuntime, type SyncStatus } from "../SyncRuntime";

const TRACK_ID = "4uLU6hMCjMI75M1A2tKUQC";
const TRACK_URI = `spotify:track:${TRACK_ID}`;
const PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M";
const PLAYLIST_URI = `spotify:playlist:${PLAYLIST_ID}`;

async function linkDevice(name: string): Promise<DesktopSyncConfiguration> {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const configuration: DesktopSyncConfiguration = {
    accountId: `${name}-account`, libraryId: "123e4567-e89b-42d3-a456-426614174099", deviceId: `${name}-device`,
    apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
    supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
  };
  setDesktopSyncConfiguration(configuration);
  expect(await storageService.switchAccountDatabase()).toBe(true);
  return configuration;
}

async function pullFromCommunity(configuration: DesktopSyncConfiguration, operations: unknown[]): Promise<void> {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/sync/pull")
      ? { batches: [{ cursor: 1, batchId: "community-edit", committedAt: new Date().toISOString(), operations }], headCursor: 1, conflicts: [] }
      : {},
  ), { status: 200, headers: { "content-type": "application/json" } }));
  await (syncRuntime as unknown as { pull(configuration: DesktopSyncConfiguration): Promise<boolean> }).pull(configuration);
}

describe("Community edits that clear a song's last annotation", () => {
  afterEach(() => {
    setLocalPersistencePaused(false);
    (syncRuntime as unknown as { setStatus(status: SyncStatus): void }).setStatus("unlinked");
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("removes a rated-only song from the library when its rating is cleared on Community", async () => {
    const configuration = await linkDevice("cleared-rating");
    expect(await indexedDBStorage.saveTrack(TRACK_URI, {
      rating: 4, energy: 0, bpm: null, camelotKey: null, tagIds: [], dateModified: 1_000,
    }, { captureSync: false })).toBe(true);

    await pullFromCommunity(configuration, [{
      type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web",
      entity: { provider: "spotify", kind: "track", providerId: TRACK_ID },
      fields: { rating: null }, expectedRevisions: { rating: 1 },
    }]);

    expect(await indexedDBStorage.getTrack(TRACK_URI)).toBeNull();
  });

  it("removes a song when its only tag is removed on Community", async () => {
    const configuration = await linkDevice("cleared-tag");
    expect(await indexedDBStorage.saveTrack(TRACK_URI, {
      rating: 0, energy: 0, bpm: 120, camelotKey: null, tagIds: ["tag_dreamy"], dateModified: 1_000,
    }, { captureSync: false })).toBe(true);

    await pullFromCommunity(configuration, [{
      type: "annotation.tag-membership", operationId: crypto.randomUUID(), origin: "web",
      entity: { provider: "spotify", kind: "track", providerId: TRACK_ID },
      tagId: "tag_dreamy", present: false, expectedRevision: 1,
    }]);

    expect(await indexedDBStorage.getTrack(TRACK_URI)).toBeNull();
  });

  it("does not add a blank song when Community adds and removes a tag in one batch", async () => {
    const configuration = await linkDevice("added-and-removed");
    const entity = { provider: "spotify", kind: "track", providerId: TRACK_ID };

    await pullFromCommunity(configuration, [
      { type: "annotation.tag-membership", operationId: crypto.randomUUID(), origin: "web", entity, tagId: "tag_dreamy", present: true, expectedRevision: 0 },
      { type: "annotation.tag-membership", operationId: crypto.randomUUID(), origin: "web", entity, tagId: "tag_dreamy", present: false, expectedRevision: 1 },
    ]);

    expect(await indexedDBStorage.getTrack(TRACK_URI)).toBeNull();
  });

  it("keeps a song that still has a tag after its rating is cleared on Community", async () => {
    const configuration = await linkDevice("still-tagged");
    expect(await indexedDBStorage.saveTrack(TRACK_URI, {
      rating: 4, energy: 0, bpm: null, camelotKey: null, tagIds: ["tag_dreamy"], dateModified: 1_000,
    }, { captureSync: false })).toBe(true);

    await pullFromCommunity(configuration, [{
      type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web",
      entity: { provider: "spotify", kind: "track", providerId: TRACK_ID },
      fields: { rating: null }, expectedRevisions: { rating: 1 },
    }]);

    expect(await indexedDBStorage.getTrack(TRACK_URI)).toMatchObject({ rating: 0, tagIds: ["tag_dreamy"] });
  });

  it("does not bring back a blank song when Community sends a fresh copy", async () => {
    const configuration = await linkDevice("fresh-copy");
    const otherId = "0VjIjW4GlUZAMYd2vXMi3b";
    expect(await indexedDBStorage.saveTrack(TRACK_URI, {
      rating: 4, energy: 0, bpm: null, camelotKey: null, tagIds: [], dateModified: 1_000,
    }, { captureSync: false })).toBe(true);
    const annotation = (providerId: string, rating: number | null) => ({
      entity: { provider: "spotify", kind: "track", providerId },
      fields: { rating: { value: rating, revision: 2 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } },
      tagMemberships: {}, entityRevision: 2, deleted: false,
    });
    const snapshot: LibrarySnapshotV2 = {
      protocolVersion: 2, sourceStorageSchemaVersion: 2, libraryId: configuration.libraryId, headCursor: 900,
      generatedAt: new Date().toISOString(), taxonomy: [], colors: [], collections: [], appState: [],
      annotations: [annotation(TRACK_ID, null), annotation(otherId, 3)] as LibrarySnapshotV2["annotations"],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull") ? { snapshotRequired: true, batches: [], headCursor: 900, conflicts: [] }
        : String(input).includes("/sync/snapshot") ? { snapshot }
          : {},
    ), { status: 200, headers: { "content-type": "application/json" } }));

    await (syncRuntime as unknown as { pull(configuration: DesktopSyncConfiguration): Promise<boolean> }).pull(configuration);

    expect(await indexedDBStorage.getTrack(TRACK_URI)).toBeNull();
    expect((await indexedDBStorage.getTrack(`spotify:track:${otherId}`))?.rating).toBe(3);
  });

  it("removes a rated-only playlist when its rating is cleared on Community", async () => {
    const configuration = await linkDevice("cleared-playlist");
    expect(await indexedDBStorage.savePlaylist(PLAYLIST_URI, {
      rating: 3, energy: 0, tagIds: [], dateModified: 1_000,
    } as never, { captureSync: false })).toBe(true);

    await pullFromCommunity(configuration, [{
      type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web",
      entity: { provider: "spotify", kind: "playlist", providerId: PLAYLIST_ID },
      fields: { rating: null }, expectedRevisions: { rating: 1 },
    }]);

    expect(await indexedDBStorage.getPlaylist(PLAYLIST_URI)).toBeNull();
  });
});
