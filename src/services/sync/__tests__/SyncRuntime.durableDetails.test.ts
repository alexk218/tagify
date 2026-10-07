import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationSnapshotV1, LibrarySnapshotV2 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { createEntityReplaceIntent, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import { buildLocalSnapshot, materializeEntity, syncRuntime } from "../SyncRuntime";
import { defaultTagData } from "@/constants/defaultTagData";

const configuration: DesktopSyncConfiguration = {
  accountId: "durable-details-account", libraryId: "123e4567-e89b-42d3-a456-426614174004", deviceId: "123e4567-e89b-42d3-a456-426614174005",
  apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
};
const TRACK = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const LOCAL = "spotify:local:My+Band:Demo:Track+One:215";

type Runtime = {
  pull(configuration: DesktopSyncConfiguration): Promise<boolean>;
  syncLocalFileBackup(configuration: DesktopSyncConfiguration): Promise<void>;
  capabilities: unknown;
};
const runtime = syncRuntime as unknown as Runtime;

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function emptyShadow(): AnnotationSnapshotV1 {
  return {
    entity: { provider: "spotify", kind: "track", providerId: "4uLU6hMCjMI75M1A2tKUQC" },
    fields: { rating: { value: null, revision: 0 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } },
    tagMemberships: {}, entityRevision: 0, deleted: false,
  };
}

describe("dates and local files in the cloud backup", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    setDesktopSyncConfiguration(configuration);
    expect(await storageService.switchAccountDatabase()).toBe(true);
    runtime.capabilities = { localFileBackup: { enabled: true, maxRequestBytes: 1_000_000 } };
  });

  afterEach(() => {
    runtime.capabilities = null;
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends when an item was first saved and last changed", async () => {
    const intent = createEntityReplaceIntent(TRACK, "track", { rating: 4, energy: 0, bpm: null, tagIds: ["house"], dateCreated: Date.UTC(2024, 0, 2), dateModified: Date.UTC(2025, 5, 7) })!;
    const operations = await materializeEntity(intent, emptyShadow());
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "annotation.patch", createdAt: "2024-01-02T00:00:00.000Z", modifiedAt: "2025-06-07T00:00:00.000Z" }),
      expect.objectContaining({ type: "annotation.tag-membership", createdAt: "2024-01-02T00:00:00.000Z", modifiedAt: "2025-06-07T00:00:00.000Z" }),
    ]));

    const snapshot = await buildLocalSnapshot(configuration.libraryId, {
      ...defaultTagData, playlists: {}, artists: {}, smartPlaylists: [],
      tracks: { [TRACK]: { rating: 4, energy: 0, bpm: null, tagIds: [], dateCreated: Date.UTC(2024, 0, 2), dateModified: Date.UTC(2025, 5, 7) } },
    });
    expect(snapshot.annotations[0]).toMatchObject({ createdAt: "2024-01-02T00:00:00.000Z", modifiedAt: "2025-06-07T00:00:00.000Z" });
  });

  it("keeps Last Updated order when restoring onto an empty device", async () => {
    const snapshot: LibrarySnapshotV2 = {
      protocolVersion: 2, sourceStorageSchemaVersion: 9, libraryId: configuration.libraryId, headCursor: 5,
      generatedAt: new Date().toISOString(), taxonomy: [], colors: [], collections: [], appState: [],
      annotations: [{ ...emptyShadow(), fields: { ...emptyShadow().fields, rating: { value: 5, revision: 1 } }, createdAt: "2024-01-02T00:00:00.000Z", modifiedAt: "2025-06-07T00:00:00.000Z" }],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => json(
      String(input).includes("/sync/pull") ? { snapshotRequired: true, batches: [], headCursor: 5, conflicts: [] }
        : String(input).includes("/sync/snapshot") ? { snapshot } : {},
    ));

    await runtime.pull(configuration);

    expect(await indexedDBStorage.getTrack(TRACK)).toMatchObject({ rating: 5, dateCreated: Date.UTC(2024, 0, 2), dateModified: Date.UTC(2025, 5, 7) });
  });

  it("dates another device's change by when it was made", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => json(
      String(input).includes("/sync/pull") ? {
        batches: [{ cursor: 1, batchId: "remote", committedAt: new Date().toISOString(), operations: [{
          type: "annotation.patch", operationId: crypto.randomUUID(), origin: "desktop", entity: emptyShadow().entity,
          fields: { rating: 3 }, expectedRevisions: { rating: 0 }, createdAt: "2024-01-02T00:00:00.000Z", modifiedAt: "2026-10-01T12:00:00.000Z",
        }] }], headCursor: 1, conflicts: [],
      } : {},
    ));

    await runtime.pull(configuration);

    expect(await indexedDBStorage.getTrack(TRACK)).toMatchObject({ rating: 3, dateCreated: Date.UTC(2024, 0, 2), dateModified: Date.UTC(2026, 9, 1, 12) });
  });

  it("restores local files from Community and backs up new local-file edits", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if ((init?.method || "GET") === "GET") {
        return json({ revision: 3, nextAfter: null, entries: { [LOCAL]: { updatedAt: 200, rating: 5, energy: 0, bpm: null, camelotKey: null, tagIds: ["house"], dateCreated: 100, dateModified: 200, name: "Track One" } } });
      }
      return json({ revision: 4, changed: true });
    });

    await runtime.syncLocalFileBackup(configuration);
    expect(await indexedDBStorage.getTrack(LOCAL)).toMatchObject({ rating: 5, tagIds: ["house"], dateCreated: 100, dateModified: 200, name: "Track One" });
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(0);

    const newer = "spotify:local:My+Band:Demo:Track+Two:180";
    expect(await indexedDBStorage.saveTrack(newer, { rating: 3, energy: 0, bpm: null, tagIds: ["chill"], dateCreated: 300, dateModified: 300 })).toBe(true);
    requests.length = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return (init?.method || "GET") === "GET" ? new Response(null, { status: 304 }) : json({ revision: 4, changed: true });
    });

    await runtime.syncLocalFileBackup(configuration);

    expect(requests[0].url).toContain("/api/v2/sync/local-files?deviceId=");
    expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
      deviceId: configuration.deviceId,
      entries: { [newer]: expect.objectContaining({ updatedAt: 300, rating: 3, tagIds: ["chill"] }) },
    });
  });

  it("keeps syncing the rest of the library when the local-file backup is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: { code: "sync_unavailable", message: "unavailable" } }, { status: 503 }));

    await expect(runtime.syncLocalFileBackup(configuration)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Tagify sync: local-file backup will retry", expect.any(String));
  });

  it("does nothing until Community supports the local-file backup", async () => {
    runtime.capabilities = {};
    const request = vi.spyOn(globalThis, "fetch");

    await runtime.syncLocalFileBackup(configuration);

    expect(request).not.toHaveBeenCalled();
  });
});
