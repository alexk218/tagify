import { IDBDatabase as FakeIDBDatabase } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationSnapshotV1 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import type { TrackData } from "@/types/tagData";
import { syncRuntime, type BackupHealth } from "../SyncRuntime";
import { FakeCommunity, FakeDevice, putStateRecord, readStore, resetDevices, runtime, useDevice } from "./fakeCommunity";

const SONG = "4uLU6hMCjMI75M1A2tKUQC";
const SONG_URI = `spotify:track:${SONG}`;
const songEntity = { provider: "spotify" as const, kind: "track" as const, providerId: SONG };
const track = (values: Partial<TrackData> = {}): TrackData => ({ rating: 0, energy: 0, bpm: null, camelotKey: null, tagIds: [], dateModified: 1_000, ...values });

let community: FakeCommunity;
let liveRealtime = false;

async function sync(device: FakeDevice): Promise<void> {
  await useDevice(device);
  // While it was switched away, Realtime would have announced the other devices' changes.
  if (liveRealtime) runtime.announcedHead = Math.max(runtime.announcedHead, community.headCursor);
  await runtime.settleLocalAndPublicSync(device.configuration);
}

async function edit(uri: string, change: (current: TrackData) => TrackData): Promise<void> {
  const current = (await indexedDBStorage.getTrack(uri)) ?? track();
  expect(await indexedDBStorage.saveTrack(uri, change(current))).toBe(true);
}

function healthBase(): BackupHealth {
  return { lastBackupAt: null, annotations: 0, taxonomyNodes: 0, appStateDocuments: 0, protectedDomains: ["playlist-rules", "smart-playlists"], notBackedUp: [], needsChoice: [], retrying: [], deviceOnlyChanges: 0 };
}

describe.each([
  { protocol: "pull, push, pull", capabilities: null },
  // The push brings back later changes, and Realtime lets a current device skip its catch-up pull.
  { protocol: "push returning later changes", capabilities: { pushReturnsLaterBatches: true } },
])("private cloud backup keeps every change ($protocol)", ({ capabilities }) => {
  beforeEach(() => {
    community = new FakeCommunity();
    vi.spyOn(globalThis, "fetch").mockImplementation(community.fetch);
    runtime.supportsV2 = false;
    runtime.capabilities = capabilities;
    // The shared runtime throttles repairs; each case starts like a fresh install.
    (runtime as unknown as { lastShadowRepairAt: number }).lastShadowRepairAt = -Infinity;
    liveRealtime = capabilities !== null;
    if (liveRealtime) {
      runtime.channel = {};
      runtime.realtimeSubscribedAt = 1;
      community.onForeignCommit = (headCursor) => { runtime.announcedHead = Math.max(runtime.announcedHead, headCursor); };
    }
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    resetDevices();
    runtime.supportsV2 = false;
    runtime.backupHealth = null;
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("backs up all 600 changes when two tags are added to 300 songs at once", async () => {
    const device = new FakeDevice("bulk");
    await useDevice(device);
    const uris = Array.from({ length: 300 }, (_, index) => `spotify:track:bulk${String(index).padStart(6, "0")}song`);
    expect(await indexedDBStorage.saveTracks(new Map(uris.map((uri) => [uri, track({ tagIds: ["tag_house", "tag_deep"] })])))).toBe(true);

    await sync(device);

    expect(community.pushes.filter((push) => push.duplicate)).toEqual([]);
    expect(new Set(community.pushes.map((push) => push.batchId)).size).toBe(community.pushes.length);
    expect(community.batches.flatMap((batch) => batch.operations)).toHaveLength(600);
    for (const uri of uris) expect(community.tags(uri.split(":")[2])).toEqual(["tag_deep", "tag_house"]);
    expect(await readStore("sync-outbox")).toEqual([]);
  }, 60_000);

  it("keeps both devices' changes to the same song made at the same time", async () => {
    const laptop = new FakeDevice("laptop");
    const desktop = new FakeDevice("desktop");
    await useDevice(laptop);
    await edit(SONG_URI, () => track({ rating: 3, tagIds: ["tag_house"] }));
    await sync(laptop);
    await sync(desktop);
    expect((await indexedDBStorage.getTrack(SONG_URI))?.tagIds).toEqual(["tag_house"]);

    // The laptop is offline while both devices tag the same song.
    await useDevice(laptop);
    await edit(SONG_URI, (current) => ({ ...current, tagIds: [...current.tagIds, "tag_deep"] }));
    await useDevice(desktop);
    await edit(SONG_URI, (current) => ({ ...current, energy: 5, tagIds: [...current.tagIds, "tag_vocal"] }));
    await sync(desktop);
    await sync(laptop);

    expect(community.tags(SONG)).toEqual(["tag_deep", "tag_house", "tag_vocal"]);
    expect(community.annotation(songEntity).fields).toMatchObject({ rating: { value: 3 }, energy: { value: 5 } });
    expect(await indexedDBStorage.getTrack(SONG_URI)).toMatchObject({ rating: 3, energy: 5 });
    expect([...(await indexedDBStorage.getTrack(SONG_URI))!.tagIds].sort()).toEqual(["tag_deep", "tag_house", "tag_vocal"]);
    await sync(desktop);
    expect([...(await indexedDBStorage.getTrack(SONG_URI))!.tagIds].sort()).toEqual(["tag_deep", "tag_house", "tag_vocal"]);
    expect(community.conflictCount).toBe(0);
  });

  it("does not reload the library for changes this device sent itself", async () => {
    const device = new FakeDevice("echo");
    await useDevice(device);
    const reloads: Array<{ entities: string[] }> = [];
    const onData = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; origin?: string; entities: string[] }>).detail;
      if (detail?.type === "sync" && detail.origin === "remote") reloads.push(detail);
    };
    window.addEventListener("tagify:dataUpdated", onData);
    try {
      await edit(SONG_URI, () => track({ tagIds: ["tag_house"] }));
      await sync(device);
      await edit(SONG_URI, (current) => ({ ...current, tagIds: [...current.tagIds, "tag_deep"] }));
      await sync(device);
      expect(community.tags(SONG)).toEqual(["tag_deep", "tag_house"]);
      expect(reloads).toEqual([]);

      community.commitFrom([{
        type: "annotation.tag-membership", operationId: crypto.randomUUID(), origin: "web", entity: songEntity,
        tagId: "tag_vocal", present: true, expectedRevision: 0,
      }]);
      await sync(device);
      expect(reloads).toEqual([expect.objectContaining({ entities: [`spotify:track:${SONG}`] })]);
      expect((await indexedDBStorage.getTrack(SONG_URI))?.tagIds).toContain("tag_vocal");
    } finally {
      window.removeEventListener("tagify:dataUpdated", onData);
    }
  });

  it("builds a later settings change on the copy Community accepted", async () => {
    const device = new FakeDevice("settings");
    await useDevice(device);
    runtime.supportsV2 = true;
    localStorage.setItem("tagify:playlistSettings", JSON.stringify({ sort: "title" }));
    await sync(device);
    expect(community.appState.get("playlist-rules")?.value).toEqual({ sort: "title" });

    // Changed again before this device has seen its own backup come back.
    localStorage.setItem("tagify:playlistSettings", JSON.stringify({ sort: "artist" }));
    await sync(device);

    expect(JSON.parse(localStorage.getItem("tagify:playlistSettings") || "null")).toEqual({ sort: "artist" });
    expect(community.appState.get("playlist-rules")?.value).toEqual({ sort: "artist" });
    expect(community.conflictCount).toBe(0);
  });

  it("keeps this device's settings when another device changed them too, and backs up the user's choice", async () => {
    vi.spyOn(syncRuntime, "syncNow").mockResolvedValue(undefined);
    const laptop = new FakeDevice("laptop-settings");
    const desktop = new FakeDevice("desktop-settings");
    await useDevice(laptop);
    runtime.supportsV2 = true;
    localStorage.setItem("tagify:playlistSettings", JSON.stringify({ sort: "title" }));
    await sync(laptop);
    await sync(desktop);
    expect(JSON.parse(localStorage.getItem("tagify:playlistSettings") || "null")).toEqual({ sort: "title" });

    localStorage.setItem("tagify:playlistSettings", JSON.stringify({ sort: "artist" }));
    await sync(desktop);
    await useDevice(laptop);
    localStorage.setItem("tagify:playlistSettings", JSON.stringify({ sort: "album" }));
    runtime.backupHealth = healthBase();
    await sync(laptop);

    expect(JSON.parse(localStorage.getItem("tagify:playlistSettings") || "null")).toEqual({ sort: "album" });
    expect(community.appState.get("playlist-rules")?.value).toEqual({ sort: "artist" });
    expect(syncRuntime.getBackupHealth()?.needsChoice).toEqual(["playlist-rules"]);

    // Waiting for a choice never re-sends or overwrites either copy.
    const pushes = community.pushes.length;
    await sync(laptop);
    expect(community.pushes.length).toBe(pushes);
    expect(JSON.parse(localStorage.getItem("tagify:playlistSettings") || "null")).toEqual({ sort: "album" });

    await syncRuntime.resolveSettingsChoice("playlist-rules", "device");
    await sync(laptop);
    expect(community.appState.get("playlist-rules")?.value).toEqual({ sort: "album" });
    expect(syncRuntime.getBackupHealth()?.needsChoice).toEqual([]);

    // Choosing the other device's copy shows it here instead.
    await sync(desktop);
    localStorage.setItem("tagify:playlistSettings", JSON.stringify({ sort: "date" }));
    await sync(desktop);
    await useDevice(laptop);
    localStorage.setItem("tagify:playlistSettings", JSON.stringify({ sort: "energy" }));
    await sync(laptop);
    expect(syncRuntime.getBackupHealth()?.needsChoice).toEqual(["playlist-rules"]);
    await syncRuntime.resolveSettingsChoice("playlist-rules", "cloud");
    expect(JSON.parse(localStorage.getItem("tagify:playlistSettings") || "null")).toEqual({ sort: "date" });
    expect(syncRuntime.getBackupHealth()?.needsChoice).toEqual([]);
  });

  it("says when saved settings are too large to back up instead of listing them as protected", async () => {
    const device = new FakeDevice("large-settings");
    await useDevice(device);
    runtime.supportsV2 = true;
    runtime.backupHealth = healthBase();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("tagify:playlistSettings", JSON.stringify(Array.from({ length: 30_000 }, (_, index) => `combination-${index}`)));

    await sync(device);

    expect(community.appState.has("playlist-rules")).toBe(false);
    expect(syncRuntime.getBackupHealth()).toMatchObject({ notBackedUp: ["playlist-rules"], protectedDomains: ["smart-playlists"] });
  });

  it("keeps device preferences through sync and discards old preference choices", async () => {
    const device = new FakeDevice("local-preferences");
    await useDevice(device);
    runtime.supportsV2 = true;
    runtime.backupHealth = { ...healthBase(), protectedDomains: ["preferences", "smart-playlists"], appStateDocuments: 2 };
    localStorage.setItem("tagify:trackListSortBy", "title");
    await putStateRecord({ key: "app-state-choice:preferences", domain: "preferences", createdAt: "old" });
    await putStateRecord({ key: "pending-app-state:preferences", domain: "preferences", value: { "tagify:trackListSortBy": "album" }, revision: 1 });
    community.commitFrom([{ type: "app-state.replace", operationId: crypto.randomUUID(), origin: "desktop", domain: "preferences", value: { "tagify:trackListSortBy": "artist" }, expectedRevision: 0 }]);

    await sync(device);

    expect(localStorage.getItem("tagify:trackListSortBy")).toBe("title");
    expect(community.pushes.flatMap((push) => push.operations).filter((operation) => operation.type === "app-state.replace" && operation.domain === "preferences")).toHaveLength(1);
    expect((await readStore<{ key: string }>("sync-state")).some((record) => record.key.includes("app-state") && record.key.endsWith(":preferences"))).toBe(false);
    expect(syncRuntime.getBackupHealth()).toMatchObject({ protectedDomains: ["smart-playlists"], appStateDocuments: 1, needsChoice: [], notBackedUp: [] });
  });

  it("removes a song from the backup after a two-field change", async () => {
    const device = new FakeDevice("removal");
    await useDevice(device);
    await edit(SONG_URI, () => track({ rating: 3, energy: 4 }));
    await sync(device);
    expect(community.annotation(songEntity).entityRevision).toBe(2);

    expect(await indexedDBStorage.deleteTrack(SONG_URI)).toBe(true);
    await sync(device);

    expect(community.annotation(songEntity).deleted).toBe(true);
    expect(community.conflictCount).toBe(0);
    expect(await readStore("sync-outbox")).toEqual([]);
  });

  it("uses Community's own revisions from pulled changes, so a miscounted copy heals", async () => {
    const device = new FakeDevice("revisions");
    await useDevice(device);
    await edit(SONG_URI, () => track({ rating: 2 }));
    await sync(device);
    // An older version counted this field twice.
    const shadow = (await readStore<{ key: string; annotation?: AnnotationSnapshotV1 }>("sync-state")).find((record) => record.key === `entity:spotify:track:${SONG}`)!;
    await putStateRecord({ ...shadow, annotation: { ...shadow.annotation!, fields: { ...shadow.annotation!.fields, rating: { value: 2, revision: 7 } } } });
    community.commitFrom([{ type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web", entity: songEntity, fields: { rating: 4 }, expectedRevisions: { rating: 1 } }]);
    await sync(device);

    await edit(SONG_URI, (current) => ({ ...current, rating: 5 }));
    await sync(device);

    expect(community.annotation(songEntity).fields.rating).toEqual({ value: 5, revision: 3 });
    expect(community.conflictCount).toBe(0);
  });

  it("catches up on every page of other devices' changes before sending a local edit", async () => {
    const device = new FakeDevice("pages");
    await useDevice(device);
    await edit(SONG_URI, () => track({ rating: 1 }));
    await sync(device);
    for (let revision = 1; revision <= 250; revision++) {
      community.commitFrom([{ type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web", entity: songEntity, fields: { rating: revision % 2 ? 2 : 3 }, expectedRevisions: { rating: revision } }]);
    }
    await edit(SONG_URI, (current) => ({ ...current, rating: 5 }));

    await sync(device);

    expect(community.annotation(songEntity).fields.rating.value).toBe(5);
    expect((await indexedDBStorage.getTrack(SONG_URI))?.rating).toBe(5);
    expect(community.conflictCount).toBe(0);
    expect(await readStore("sync-outbox")).toEqual([]);
  });

  it("sends a change again when another device changed the song moments earlier", async () => {
    const device = new FakeDevice("race");
    await useDevice(device);
    await edit(SONG_URI, () => track({ rating: 1, energy: 1 }));
    await sync(device);
    await edit(SONG_URI, (current) => ({ ...current, rating: 5 }));
    community.beforeNextPush = () => {
      community.commitFrom([{ type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web", entity: songEntity, fields: { rating: 2, energy: 7 }, expectedRevisions: { rating: 1, energy: 1 } }]);
    };

    await sync(device);

    expect(community.conflictCount).toBe(1);
    expect(community.annotation(songEntity).fields).toMatchObject({ rating: { value: 5 }, energy: { value: 7 } });
    expect(await indexedDBStorage.getTrack(SONG_URI)).toMatchObject({ rating: 5, energy: 7 });
    expect(await readStore("sync-outbox")).toEqual([]);
  });

  it("refreshes miscounted revisions from the cloud copy when Community keeps refusing a change", async () => {
    const device = new FakeDevice("repair");
    await useDevice(device);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await edit(SONG_URI, () => track({ rating: 2 }));
    await sync(device);
    const shadow = (await readStore<{ key: string; annotation?: AnnotationSnapshotV1 }>("sync-state")).find((record) => record.key === `entity:spotify:track:${SONG}`)!;
    await putStateRecord({ ...shadow, annotation: { ...shadow.annotation!, fields: { ...shadow.annotation!.fields, rating: { value: 2, revision: 9 } } } });

    await edit(SONG_URI, (current) => ({ ...current, rating: 4 }));
    await sync(device);

    expect(community.annotation(songEntity).fields.rating).toEqual({ value: 4, revision: 2 });
    expect(await readStore("sync-outbox")).toEqual([]);
  });

  it("keeps a value Community cannot hold on this device, says so, and backs up everything else", async () => {
    const device = new FakeDevice("unsupported");
    await useDevice(device);
    runtime.backupHealth = healthBase();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await edit("spotify:track:0VjIjW4GlUZAMYd2vXMi3b", () => track({ rating: 4 }));
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tagify-db:durability-account");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("sync-outbox", "readwrite");
      // Queued by an older version with a date Community rejects.
      transaction.objectStore("sync-outbox").put({
        id: "older-edit", batchId: "older-batch", createdAt: 1, type: "entity.replace", entity: songEntity,
        desired: { rating: 3, energy: null, bpm: null, key: null, tagIds: [], modifiedAt: "yesterday" },
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    await sync(device);

    expect(community.annotation({ ...songEntity, providerId: "0VjIjW4GlUZAMYd2vXMi3b" }).fields.rating.value).toBe(4);
    expect(await readStore("sync-outbox")).toEqual([]);
    expect(syncRuntime.getBackupHealth()?.deviceOnlyChanges).toBe(1);
  });

  it("says when local files have not backed up yet", async () => {
    const device = new FakeDevice("local-files");
    await useDevice(device);
    runtime.backupHealth = healthBase();
    runtime.capabilities = { localFileBackup: { enabled: true, maxRequestBytes: 1_000_000 } };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => String(input).includes("/local-files")
      ? new Response(JSON.stringify({ error: { code: "sync_unavailable" } }), { status: 503 })
      : community.fetch(input, init));

    await sync(device);

    expect(syncRuntime.getBackupHealth()?.retrying).toEqual(["local-files"]);
  });

  it("applies a pulled change, its sync record, and the cursor in one transaction that also checks queued edits", async () => {
    const device = new FakeDevice("atomic");
    await useDevice(device);
    await edit(SONG_URI, () => track({ rating: 2 }));
    await sync(device);
    community.commitFrom([{ type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web", entity: songEntity, fields: { energy: 6 }, expectedRevisions: { energy: 0 } }]);
    const transactions: string[][] = [];
    const original = FakeIDBDatabase.prototype.transaction;
    vi.spyOn(FakeIDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, stores: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      if (mode === "readwrite") transactions.push([...(typeof stores === "string" ? [stores] : stores)]);
      return original.call(this, stores, mode, options);
    } as typeof original);

    await runtime.pull(device.configuration);

    const trackWrites = transactions.filter((stores) => stores.includes("tracks"));
    expect(trackWrites).toHaveLength(1);
    expect(trackWrites[0]).toEqual(expect.arrayContaining(["tracks", "sync-outbox", "sync-state"]));
    expect(await indexedDBStorage.getTrack(SONG_URI)).toMatchObject({ rating: 2, energy: 6 });
  });

  it("keeps an edit saved between two pulled batches", async () => {
    const device = new FakeDevice("between");
    await useDevice(device);
    await edit(SONG_URI, () => track({ rating: 2 }));
    await sync(device);
    community.commitFrom([{ type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web", entity: songEntity, fields: { energy: 3 }, expectedRevisions: { energy: 0 } }]);
    community.commitFrom([{ type: "annotation.patch", operationId: crypto.randomUUID(), origin: "web", entity: songEntity, fields: { rating: 1 }, expectedRevisions: { rating: 1 } }]);
    let saving: Promise<boolean> | null = null;
    const onData = () => {
      window.removeEventListener("tagify:dataUpdated", onData);
      // The user rates the song right after the first change appears.
      saving = indexedDBStorage.saveTrack(SONG_URI, track({ rating: 5, energy: 3 }));
    };
    window.addEventListener("tagify:dataUpdated", onData);

    await runtime.pull(device.configuration);
    expect(await saving).toBe(true);

    expect(await indexedDBStorage.getTrack(SONG_URI)).toMatchObject({ rating: 5, energy: 3 });
    await sync(device);
    expect(community.annotation(songEntity).fields).toMatchObject({ rating: { value: 5 }, energy: { value: 3 } });
  });
});

describe("reconnecting and restoring keep other devices' changes", () => {
  afterEach(() => {
    indexedDBStorage.resetConnection();
    resetDevices();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps device-only values when the library is refreshed from the cloud copy", async () => {
    const community = new FakeCommunity();
    vi.spyOn(globalThis, "fetch").mockImplementation(community.fetch);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const device = new FakeDevice("refresh");
    await useDevice(device);
    expect(await indexedDBStorage.saveTrack(SONG_URI, track({ rating: 4.3, bpm: 450, camelotKey: "8a", tagIds: ["tag_house", "bad id!"], dateModified: 5_000 }), { captureSync: false })).toBe(true);
    const annotation = community.annotation(songEntity);
    annotation.fields.rating = { value: 4.5, revision: 1 };
    annotation.fields.key = { value: "8A", revision: 1 };
    annotation.tagMemberships.tag_house = { value: true, revision: 1 };
    community.headCursor = 40;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => String(input).includes("/sync/pull")
      ? new Response(JSON.stringify({ snapshotRequired: true, batches: [], headCursor: 40, conflicts: [] }), { status: 200 })
      : community.fetch(input, init));

    await runtime.pull(device.configuration);

    expect(await indexedDBStorage.getTrack(SONG_URI)).toMatchObject({ rating: 4.3, bpm: 450, camelotKey: "8a", dateModified: 5_000 });
    expect([...(await indexedDBStorage.getTrack(SONG_URI))!.tagIds].sort()).toEqual(["bad id!", "tag_house"]);
  });

  it("keeps an edit saved while the cloud copy replaces this device's library", async () => {
    const community = new FakeCommunity();
    vi.spyOn(globalThis, "fetch").mockImplementation(community.fetch);
    const device = new FakeDevice("replace-race");
    await useDevice(device);
    expect(await indexedDBStorage.saveTrack(SONG_URI, track({ rating: 1 }))).toBe(true);
    const snapshot = { ...community.snapshot(), headCursor: 9 };
    snapshot.annotations = [{ ...community.annotation(songEntity), fields: { ...community.annotation(songEntity).fields, rating: { value: 1, revision: 1 } } }];

    const replacing = indexedDBStorage.replaceCloudReplica(
      { schemaVersion: 9, taxonomy: (await storageService.getTaxonomy()), tracks: { [SONG_URI]: track({ rating: 1 }) }, playlists: {}, artists: {}, smartPlaylists: [] },
      { key: "replica-manifest", accountId: "durability-account", libraryId: community.libraryId, storageSchemaVersion: 9, protocolVersion: 2, appliedCursor: 9, snapshotChecksum: null, appStateAppliedAt: null, initializedAt: "", updatedAt: "" },
      [], [], [], { keepQueuedEdits: true },
    );
    const saving = indexedDBStorage.saveTrack(SONG_URI, track({ rating: 5 }));
    expect(await replacing).toBe(true);
    expect(await saving).toBe(true);

    expect((await indexedDBStorage.getTrack(SONG_URI))?.rating).toBe(5);
    expect(await readStore("sync-outbox")).toEqual(expect.arrayContaining([expect.objectContaining({ type: "entity.replace", desired: expect.objectContaining({ rating: 5 }) })]));
  });
});
