import { describe, expect, it, vi } from "vitest";
import { assertLibrarySnapshotV1, assertSyncBatchV1, type AnnotationSnapshotV1, type SyncMutationV1 } from "@tagify/sync-contracts";
import {
  createEntityReplaceIntent,
  normalizeSyncBpm,
  normalizeSyncEnergy,
  normalizeSyncKey,
  normalizeSyncName,
  normalizeSyncRating,
} from "../SyncLocalState";
import { appStatePushGroups, buildLocalSnapshot, materializeEntity, withoutUnsupportedOperations } from "../SyncRuntime";
import { durableStateStoredByteLength } from "../DurableAppState";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure } from "@/types/tagData";

const LIBRARY_ID = "123e4567-e89b-42d3-a456-426614174004";
const TRACK = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";

function emptyShadow(): AnnotationSnapshotV1 {
  return {
    entity: { provider: "spotify", kind: "track", providerId: "4uLU6hMCjMI75M1A2tKUQC" },
    fields: { rating: { value: null, revision: 0 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } },
    tagMemberships: {}, entityRevision: 0, deleted: false,
  };
}

function batch(operations: SyncMutationV1[]) {
  return { protocolVersion: 1 as const, batchId: crypto.randomUUID(), deviceId: crypto.randomUUID(), baseCursor: 0, operations };
}

describe("Community sync contract boundary", () => {
  it("converts values Community cannot hold into the closest accepted value", () => {
    expect(normalizeSyncRating(3.25)).toBe(3.5);
    expect(normalizeSyncRating(7)).toBe(5);
    expect(normalizeSyncRating(0.2)).toBeNull();
    expect(normalizeSyncEnergy(7.5)).toBe(8);
    expect(normalizeSyncEnergy(15)).toBe(10);
    expect(normalizeSyncBpm(15)).toBeNull();
    expect(normalizeSyncBpm(500)).toBeNull();
    expect(normalizeSyncBpm(128.456)).toBe(128.46);
    expect(normalizeSyncKey("8a")).toBe("8A");
    expect(normalizeSyncKey("Am")).toBeNull();
    expect(normalizeSyncName("<3 & Chill > Hype", "Untitled tag")).toBe("‹3 & Chill › Hype");
    expect(normalizeSyncName("   ", "Untitled tag")).toBe("Untitled tag");
    expect(normalizeSyncName(`${"a".repeat(79)}😀b`, "Untitled tag")).toBe("a".repeat(79));
    expect(normalizeSyncName("Broken \uD83D", "Untitled tag")).toBe("Broken �");
  });

  it("queues a valid change for a track with legacy values instead of stopping backups", async () => {
    const intent = createEntityReplaceIntent(TRACK, "track", {
      rating: 3.25, energy: 7.5, bpm: 15, camelotKey: "8a", tagIds: ["tag_valid", "tag with spaces"], dateModified: 1,
    });
    expect(intent?.desired).toMatchObject({ rating: 3.5, energy: 8, bpm: null, key: "8A", tagIds: ["tag_valid"] });

    const operations = await materializeEntity(intent!, emptyShadow());
    expect(() => assertSyncBatchV1(batch(operations))).not.toThrow();
  });

  it("normalizes changes queued by earlier versions before sending them", async () => {
    const queued = {
      id: crypto.randomUUID(), batchId: crypto.randomUUID(), createdAt: 1, type: "entity.replace" as const,
      entity: emptyShadow().entity,
      desired: { rating: 3.25, energy: 7.5, bpm: 12, key: "Am", tagIds: ["custom:My Color", "tag_ok"] },
    };
    const operations = await materializeEntity(queued, emptyShadow());
    expect(() => assertSyncBatchV1(batch(operations))).not.toThrow();
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "annotation.patch", fields: { rating: 3.5, energy: 8 } }),
      expect.objectContaining({ type: "annotation.tag-membership", tagId: "tag_ok" }),
    ]));
  });

  it("keeps one unsupported change on the device while the rest of the batch backs up", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const valid: SyncMutationV1 = {
      type: "annotation.patch", operationId: crypto.randomUUID(), origin: "desktop",
      entity: emptyShadow().entity, fields: { rating: 4 }, expectedRevisions: { rating: 0 },
    };
    const invalid: SyncMutationV1 = { ...valid, operationId: crypto.randomUUID(), fields: { bpm: 9 }, expectedRevisions: { bpm: 0 } };
    expect(withoutUnsupportedOperations([valid, invalid])).toEqual([valid]);
    warn.mockRestore();
  });

  it("builds a backup snapshot for a library with legacy names, colors, and values", async () => {
    const taxonomy = createEmptyTaxonomy();
    taxonomy.categoryOrder = ["genre"];
    taxonomy.categoriesById.genre = { id: "genre", name: `Mood <${"x".repeat(90)}>`, subcategoryIds: [], childIds: ["love", "bad id"] };
    taxonomy.categoriesById.unordered = { id: "unordered", name: "Missing from order", subcategoryIds: [], childIds: [] };
    taxonomy.childrenByParentId = { genre: ["love", "bad id"], unordered: [] };
    taxonomy.tagsById.love = { id: "love", name: "<3", parentId: "genre", subcategoryId: "genre", accentId: "custom:Bad Id" as `custom:${string}` };
    taxonomy.tagsById["bad id"] = { id: "bad id", name: "Bad", parentId: "genre", subcategoryId: "genre" };
    taxonomy.customAccentsById["custom:ok"] = { id: "custom:ok", name: "Warm > Cool", color: "#ff8800" };
    taxonomy.customAccentsById["custom:Bad Id"] = { id: "custom:Bad Id", name: "Bad", color: "#000000" };
    taxonomy.colorThemesById.extra = { id: "extra", name: "Not in order", colorIds: ["custom:ok", "custom:Bad Id"] };
    taxonomy.colorThemeOrder = [];
    const data: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy, playlists: {}, artists: {}, smartPlaylists: [],
      tracks: { [TRACK]: { rating: 3.25, energy: 7.5, bpm: 500, camelotKey: "Am", tagIds: ["love", "bad id"] } },
    };

    const snapshot = await buildLocalSnapshot(LIBRARY_ID, data);

    expect(() => assertLibrarySnapshotV1(snapshot)).not.toThrow();
    expect(snapshot.taxonomy.map((node) => node.id).sort()).toEqual(["genre", "love", "unordered"]);
    expect(snapshot.taxonomy.find((node) => node.id === "love")).toMatchObject({ name: "‹3", accentId: null });
    expect(snapshot.colors).toEqual([expect.objectContaining({ id: "custom:ok", name: "Warm › Cool" })]);
    expect(snapshot.collections).toEqual([expect.objectContaining({ id: "extra", colorIds: ["custom:ok"] })]);
    expect(snapshot.annotations[0].fields).toMatchObject({ rating: { value: 3.5 }, energy: { value: 8 }, bpm: { value: null }, key: { value: null } });
    expect(Object.keys(snapshot.annotations[0].tagMemberships)).toEqual(["love"]);
  });

  it("measures saved settings the way Community's database does", () => {
    // Postgres renders jsonb as {"a": 1, "b": [1, 2]}.
    expect(durableStateStoredByteLength({ a: 1, b: [1, 2], c: { d: "é" } })).toBe('{"a": 1, "b": [1, 2], "c": {"d": "é"}}'.length + 1);
    expect(durableStateStoredByteLength({ a: undefined, b: null })).toBe('{"b": null}'.length);
  });

  it("splits large saved-settings changes across requests under the body limit", () => {
    const document = (domain: "smart-playlists" | "preferences" | "filter-formulas", size: number) => ({
      domain, value: { blob: "x".repeat(size) }, revision: 0, updatedAt: "2026-10-05T00:00:00.000Z",
    });
    const groups = appStatePushGroups([document("smart-playlists", 480_000), document("preferences", 480_000), document("filter-formulas", 100)]);
    expect(groups.map((group) => group.map((item) => item.domain))).toEqual([["smart-playlists"], ["preferences", "filter-formulas"]]);
  });
});
