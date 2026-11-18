import { IDBFactory } from "fake-indexeddb";
import type { AnnotationSnapshotV1, TagMembershipMutationV1 } from "@tagify/sync-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import type { TrackData } from "@/types/tagData";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import {
  createEntityReplaceIntent,
  makeEntityReplaceIntent,
  mergedTagMethods,
  noteRecordTagMethods,
  noteTagMethods,
  setDesktopSyncConfiguration,
  takeTagMethods,
  type EntityReplaceIntent,
  type LocalSyncIntent,
} from "../SyncLocalState";
import { coalesceOutboxIntents, materializeEntity } from "../SyncRuntime";
import { readStore, syncConfiguration } from "./fakeCommunity";

// Tag origin (tagify-community docs/TAG_ORIGIN_2026-11.md, slice 3): desktop only sends the method.

const SONG = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const OTHER_SONG = "spotify:track:7ouMYWpwJ422jRcDASZB7P";
const entity = { provider: "spotify" as const, kind: "track" as const, providerId: "4uLU6hMCjMI75M1A2tKUQC" };
const track = (tagIds: string[], dateModified = 1_000): TrackData => ({ rating: 0, energy: 0, bpm: null, camelotKey: null, tagIds, dateCreated: 500, dateModified });

function shadow(tagMemberships: AnnotationSnapshotV1["tagMemberships"] = {}): AnnotationSnapshotV1 {
  return {
    entity,
    fields: { rating: { value: null, revision: 0 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } },
    tagMemberships, entityRevision: 1, deleted: false,
  };
}

function intent(id: string, before: string[], after: string[], tagMethods?: EntityReplaceIntent["desired"]["tagMethods"], createdAt = 1): EntityReplaceIntent {
  return {
    id, batchId: `batch-${id}`, createdAt, type: "entity.replace", entity,
    desired: { rating: null, energy: null, bpm: null, key: null, tagIds: after, ...(tagMethods ? { tagMethods } : {}) },
    base: { rating: null, energy: null, bpm: null, key: null, tagIds: before },
  };
}

const memberships = (operations: Awaited<ReturnType<typeof materializeEntity>>) =>
  operations.filter((operation): operation is TagMembershipMutationV1 => operation.type === "annotation.tag-membership");

afterEach(() => { window.__tagifyTagMethodNotes?.clear(); });

describe("tag origin on sync operations", () => {
  it("adds each tag's method to its membership change and leaves it out when there is none", async () => {
    const operations = memberships(await materializeEntity(
      intent("edit", ["tag_old"], ["tag_house", "tag_deep"], { tag_house: "typed", tag_old: "bulk" }),
      shadow({ tag_old: { value: true, revision: 3 } }),
    ));
    expect(operations.map(({ tagId, present, method }) => ({ tagId, present, method }))).toEqual([
      { tagId: "tag_deep", present: true, method: undefined },
      { tagId: "tag_house", present: true, method: "typed" },
      { tagId: "tag_old", present: false, method: "bulk" },
    ]);
    expect(Object.hasOwn(operations[0], "method")).toBe(false);
  });

  it("sends nothing when only the method differs from what Community has", async () => {
    const operations = await materializeEntity(intent("same", [], ["tag_house"], { tag_house: "copied" }), shadow({ tag_house: { value: true, revision: 2 } }));
    expect(operations).toEqual([]);
  });

  it("keeps the method off fields and dates: the same edit with and without one sends the same dates", async () => {
    const withMethod = intent("dated", [], ["tag_house"], { tag_house: "typed" });
    withMethod.desired.modifiedAt = "2026-11-01T00:00:00.000Z";
    const withoutMethod = intent("dated", [], ["tag_house"]);
    withoutMethod.desired.modifiedAt = "2026-11-01T00:00:00.000Z";
    const [sent] = memberships(await materializeEntity(withMethod, shadow()));
    const [plain] = memberships(await materializeEntity(withoutMethod, shadow()));
    const { method, ...rest } = sent;
    expect(method).toBe("typed");
    expect(rest).toEqual(plain);
  });

  it("only keeps sync-safe tags in an intent's methods", () => {
    const made = createEntityReplaceIntent(SONG, "track", track(["tag_house"]), "batch", track([]), { tag_house: "typed", "not safe!": "typed" });
    expect(made?.desired.tagMethods).toEqual({ tag_house: "typed" });
    expect(createEntityReplaceIntent(SONG, "track", track(["tag_house"]), "batch", track([]))?.desired).not.toHaveProperty("tagMethods");
  });
});

describe("tag origin through outbox merging", () => {
  it("sends the latest method for each tag across an item's queued edits", async () => {
    const queued: LocalSyncIntent[] = [
      intent("first", [], ["tag_house"], { tag_house: "copied" }, 1),
      intent("second", ["tag_house"], ["tag_house", "tag_deep"], { tag_deep: "bulk" }, 2),
      intent("third", ["tag_house", "tag_deep"], ["tag_house", "tag_deep", "tag_calm"], { tag_calm: "typed" }, 3),
    ];
    const [group] = coalesceOutboxIntents(queued).groups;
    expect((group.intent as EntityReplaceIntent).desired.tagMethods).toEqual({ tag_house: "copied", tag_deep: "bulk", tag_calm: "typed" });
    const operations = memberships(await materializeEntity(group.intent as EntityReplaceIntent, shadow(), group.edits));
    expect(Object.fromEntries(operations.map((operation) => [operation.tagId, operation.method]))).toEqual({ tag_house: "copied", tag_deep: "bulk", tag_calm: "typed" });
  });

  it("lets a later change to the same tag replace its method, or clear it when the later change has none", () => {
    const replaced = coalesceOutboxIntents([
      intent("typed-add", [], ["tag_house"], { tag_house: "typed" }, 1),
      intent("bulk-remove", ["tag_house"], [], { tag_house: "bulk" }, 2),
      intent("smart-add", [], ["tag_house"], { tag_house: "smart_playlist" }, 3),
    ]).groups[0].intent as EntityReplaceIntent;
    expect(replaced.desired.tagMethods).toEqual({ tag_house: "smart_playlist" });

    const cleared = coalesceOutboxIntents([
      intent("typed-add", [], ["tag_house", "tag_deep"], { tag_house: "typed", tag_deep: "typed" }, 1),
      intent("unlabelled-remove", ["tag_house", "tag_deep"], ["tag_deep"], undefined, 2),
    ]).groups[0].intent as EntityReplaceIntent;
    expect(cleared.desired.tagMethods).toEqual({ tag_deep: "typed" });
    expect(mergedTagMethods([intent("only", [], ["tag_house"], undefined, 1)])).toBeUndefined();
  });

  it("doesn't change the queued intents themselves", () => {
    const latest = intent("latest", ["tag_house"], ["tag_house", "tag_deep"], { tag_deep: "bulk" }, 2);
    coalesceOutboxIntents([intent("first", [], ["tag_house"], { tag_house: "typed" }, 1), latest]);
    expect(latest.desired.tagMethods).toEqual({ tag_deep: "bulk" });
  });
});

describe("noting how a tag changed until the change is saved", () => {
  it("gives a noted method to the same change on the same account, once", () => {
    noteTagMethods(SONG, ["tag_old"], ["tag_house"], "typed", "db-a");
    expect(takeTagMethods(SONG, ["tag_old"], ["tag_house"], "db-b")).toBeUndefined();
    expect(takeTagMethods(OTHER_SONG, ["tag_old"], ["tag_house"], "db-a")).toBeUndefined();
    expect(takeTagMethods(SONG, ["tag_old"], ["tag_house"], "db-a")).toEqual({ tag_house: "typed", tag_old: "typed" });
    expect(takeTagMethods(SONG, ["tag_old"], ["tag_house"], "db-a")).toBeUndefined();
  });

  it("ignores a note for the opposite change or one that has expired", () => {
    noteTagMethods(SONG, [], ["tag_house"], "typed", "db", 0);
    expect(takeTagMethods(SONG, ["tag_house"], [], "db", 1)).toBeUndefined();
    noteTagMethods(SONG, [], ["tag_house"], "typed", "db", 0);
    expect(takeTagMethods(SONG, [], ["tag_house"], "db", 11 * 60_000)).toBeUndefined();
  });

  it("notes the linked releases an edit reached with the edit's method", () => {
    const linked = "spotify:track:0VjIjW4GlUZAMYd2vXMi3b";
    noteRecordTagMethods({ [SONG]: track([]), [linked]: track([]), [OTHER_SONG]: track(["tag_calm"]) }, { [SONG]: track(["tag_house"]), [linked]: track(["tag_house"]) }, "copied", "db");
    expect(takeTagMethods(linked, [], ["tag_house"], "db")).toEqual({ tag_house: "copied" });
    expect(takeTagMethods(OTHER_SONG, ["tag_calm"], [], "db")).toBeUndefined();
  });

  it("only labels queued changes while this device syncs", () => {
    noteTagMethods(SONG, [], ["tag_house"], "typed");
    expect(makeEntityReplaceIntent(SONG, "track", track(["tag_house"]), "batch", track([]))).toBeNull();
  });
});

describe("tag origin from saved edits", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    setDesktopSyncConfiguration(syncConfiguration("tag-origin-device"));
    expect(await storageService.switchAccountDatabase()).toBe(true);
    const taxonomy = createEmptyTaxonomy();
    taxonomy.categoryOrder = ["genre"];
    taxonomy.categoriesById.genre = { id: "genre", name: "Genre", subcategoryIds: [], childIds: ["tag_house", "tag_deep"] };
    taxonomy.tagsById = { tag_house: { id: "tag_house", name: "House", subcategoryId: "genre" }, tag_deep: { id: "tag_deep", name: "Deep", subcategoryId: "genre" } };
    await indexedDBStorage.saveTaxonomy(taxonomy);
    await indexedDBStorage.saveTrack(SONG, track(["tag_house"], 1_000));
    await indexedDBStorage.saveTrack(OTHER_SONG, track(["tag_house"], 1_000));
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const latestIntent = async (uri: string) => (await readStore<LocalSyncIntent>("sync-outbox"))
    .filter((queued): queued is EntityReplaceIntent => queued.type === "entity.replace" && `spotify:track:${queued.entity.providerId}` === uri)
    .sort((left, right) => left.createdAt - right.createdAt).at(-1);

  it("queues a bulk edit's method without storing anything new on the song or changing its dates", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    await indexedDBStorage.applyBulkTagUpdates([{ trackUri: SONG, toAdd: ["tag_deep"], toRemove: ["tag_house"], tagMethod: "bulk" }]);
    await indexedDBStorage.applyBulkTagUpdates([{ trackUri: OTHER_SONG, toAdd: ["tag_deep"], toRemove: ["tag_house"] }]);

    expect((await latestIntent(SONG))?.desired.tagMethods).toEqual({ tag_deep: "bulk", tag_house: "bulk" });
    expect(await latestIntent(OTHER_SONG)).not.toHaveProperty("desired.tagMethods");
    const saved = await indexedDBStorage.getTrack(SONG);
    const plain = await indexedDBStorage.getTrack(OTHER_SONG);
    expect(saved).toEqual(plain);
    expect(saved).not.toHaveProperty("tagMethods");
    expect((await latestIntent(SONG))?.desired.modifiedAt).toBe((await latestIntent(OTHER_SONG))?.desired.modifiedAt);
  });

  it("keeps an automatic rule's method and the song's Last Updated date", async () => {
    await indexedDBStorage.applyBulkTagUpdates([{ trackUri: SONG, toAdd: ["tag_deep"], toRemove: [], automaticRuleIds: ["rule-1"], tagMethod: "bulk" }]);
    expect((await latestIntent(SONG))?.desired.tagMethods).toEqual({ tag_deep: "rule" });
    expect((await indexedDBStorage.getTrack(SONG))?.dateModified).toBe(1_000);
  });

  it("sends Undo and Redo as unknown", async () => {
    await indexedDBStorage.applyBulkTagUpdates([{ trackUri: SONG, toAdd: ["tag_deep"], toRemove: [], tagMethod: "copied" }]);
    const entry = (await indexedDBStorage.getLatestBulkUndo())!;
    await indexedDBStorage.undoBulkTagUpdate(entry.id);
    expect((await latestIntent(SONG))?.desired.tagMethods).toEqual({ tag_deep: "unknown" });
    const redo = (await indexedDBStorage.getBulkEditHistory()).redo!;
    await indexedDBStorage.redoBulkTagUpdate(redo.id);
    expect((await latestIntent(SONG))?.desired.tagMethods).toEqual({ tag_deep: "unknown" });
  });

  it("labels a change saved later by the Tagify page with the method noted when it was made", async () => {
    noteTagMethods(SONG, ["tag_house"], ["tag_house", "tag_deep"], "typed");
    await indexedDBStorage.saveTracks(new Map([[SONG, track(["tag_house", "tag_deep"], 2_000)]]), { [SONG]: track(["tag_house"], 1_000) });
    expect((await latestIntent(SONG))?.desired.tagMethods).toEqual({ tag_deep: "typed" });
    expect((await indexedDBStorage.getTrack(SONG))?.dateModified).toBe(2_000);
  });
});
