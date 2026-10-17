import { gunzipSync } from "node:zlib";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { buildTaxonomyFromCategoryTree, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import { setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import { compressedReplaceLimits, COMPRESSED_REPLACE_CAPABILITY, MAX_COMPRESSED_REQUEST_BYTES, MAX_EXPANDED_REQUEST_BYTES, syncRuntime } from "../SyncRuntime";

const configuration: DesktopSyncConfiguration = {
  accountId: "reset-account",
  libraryId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b",
  deviceId: "7a2d3b0f-4c5e-4f60-9b8c-0d1e2f3a4b5c",
  apiBaseUrl: "https://community.example",
  supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "key",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: Math.floor(Date.now() / 1000) + 3_600,
};
/** Vercel refuses request bodies above 4.5 MB before the website sees them. */
const VERCEL_REQUEST_LIMIT_BYTES = 4.5 * 1024 * 1024;

type ResetRuntime = {
  capabilities: unknown;
  armCloudReplacement(): void;
  replaceCloudWithCurrentLocalState(): Promise<void>;
};
const runtime = syncRuntime as unknown as ResetRuntime;

/** A deterministic pseudo-random sequence, so library sizes are stable between runs. */
function sequence(seed: number) {
  // mulberry32
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * A heavily tagged library like a long-time user's: 160 tags in 8 groups,
 * 3–8 tags, a rating and energy on each song, BPM and key on most, and real
 * creation and edit dates. Spotify IDs are random, so they barely compress.
 */
function library(songs: number): TagDataStructure {
  const random = sequence(songs);
  const tagIds = Array.from({ length: 160 }, (_, index) => `tag_${index.toString(36).padStart(4, "0")}${Math.floor(random() * 1e6).toString(36)}`);
  const taxonomy = buildTaxonomyFromCategoryTree(Array.from({ length: 8 }, (_, group) => ({
    id: `group_${group}`, name: `Group ${group}`,
    subcategories: [{ id: `sub_${group}`, name: `Sub ${group}`, tags: tagIds.slice(group * 20, group * 20 + 20).map((id, index) => ({ id, name: `Tag ${group}-${index}` })) }],
  })));
  const tracks: Record<string, TrackData> = {};
  for (let index = 0; index < songs; index++) {
    const id = Array.from({ length: 22 }, () => BASE62[Math.floor(random() * 62)]).join("");
    const created = 1_600_000_000_000 + Math.floor(random() * 2e11);
    tracks[`spotify:track:${id}`] = {
      rating: Math.ceil(random() * 10) / 2,
      energy: Math.ceil(random() * 10),
      bpm: random() < 0.8 ? 80 + Math.floor(random() * 90) : null,
      camelotKey: random() < 0.7 ? `${1 + Math.floor(random() * 12)}${random() < 0.5 ? "A" : "B"}` : null,
      tagIds: Array.from({ length: 3 + Math.floor(random() * 6) }, () => tagIds[Math.floor(random() * tagIds.length)]),
      dateCreated: created,
      dateModified: created + Math.floor(random() * 1e10),
    } as TrackData;
  }
  return { schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy, tracks, playlists: {}, artists: {} } as unknown as TagDataStructure;
}

/** Sends a reset of `songs` songs; Community refuses it afterwards so nothing else runs. */
async function sendReset(songs: number) {
  vi.spyOn(storageService, "loadAll").mockResolvedValue(library(songs));
  const sent: Array<{ path: string; headers: Record<string, string>; body: Uint8Array }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v2/sync/capabilities") return Response.json({ protocolVersion: 2, supportedProtocolVersions: [1, 2], [COMPRESSED_REPLACE_CAPABILITY]: { encoding: "gzip", maxCompressedBytes: 4_000_000, maxExpandedBytes: 64_000_000 } });
    const body = init?.body instanceof ArrayBuffer ? new Uint8Array(init.body) : new TextEncoder().encode(String(init?.body ?? ""));
    sent.push({ path, headers: (init?.headers || {}) as Record<string, string>, body });
    return Response.json({ error: { code: "sync_unavailable", message: "Stopped by the test" } }, { status: 503 });
  });
  runtime.armCloudReplacement();
  await expect(runtime.replaceCloudWithCurrentLocalState()).rejects.toThrow();
  return sent;
}

describe("resetting Community to this device's library", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    setDesktopSyncConfiguration(configuration);
    expect(await indexedDBStorage.init()).toBe(true);
  });

  afterEach(() => {
    runtime.capabilities = null;
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("before: a 20,000-song reset is too large for the website as plain JSON", async () => {
    runtime.capabilities = { protocolVersion: 2, supportedProtocolVersions: [1, 2] };
    const [request] = await sendReset(20_000);
    expect(request.path).toBe("/api/v2/sync/replace");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.body.byteLength).toBeGreaterThan(VERCEL_REQUEST_LIMIT_BYTES);
  }, 60_000);

  it.each([20_000, 50_000])("after: a %i-song reset fits gzipped, with every song in it", async (songs) => {
    runtime.capabilities = { protocolVersion: 2, supportedProtocolVersions: [1, 2], [COMPRESSED_REPLACE_CAPABILITY]: { encoding: "gzip", maxCompressedBytes: 4_000_000, maxExpandedBytes: 64_000_000 } };
    const [request] = await sendReset(songs);
    expect(request.headers).toMatchObject({ "content-type": "application/octet-stream", "x-tagify-content-encoding": "gzip" });
    expect(request.body.byteLength).toBeLessThan(MAX_COMPRESSED_REQUEST_BYTES);
    const expanded = gunzipSync(request.body);
    expect(expanded.byteLength).toBeLessThan(MAX_EXPANDED_REQUEST_BYTES);
    const replacement = JSON.parse(expanded.toString("utf8"));
    expect(replacement).toMatchObject({ confirmation: "RESET TAGIFY", deviceId: configuration.deviceId });
    expect(replacement.snapshot.annotations).toHaveLength(songs);
    console.info(`${songs} songs: ${(expanded.byteLength / 1e6).toFixed(1)} MB JSON, ${(request.body.byteLength / 1e6).toFixed(2)} MB gzipped`);
  }, 120_000);

  describe("while Community is still saving a very large reset", () => {
    const pending = () => Response.json({ error: { code: "library_install_pending", message: "Your library is still being saved. Check again in a minute." } }, { status: 503 });

    async function resetAnswering(answers: Array<() => Response>) {
      runtime.capabilities = { protocolVersion: 2, supportedProtocolVersions: [1, 2], [COMPRESSED_REPLACE_CAPABILITY]: { encoding: "gzip", maxCompressedBytes: 4_000_000, maxExpandedBytes: 64_000_000 } };
      vi.spyOn(storageService, "loadAll").mockResolvedValue(library(100));
      const operations: string[] = [];
      const paths: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        if (path !== "/api/v2/sync/replace") return Response.json({ error: { code: "sync_unavailable", message: "Stopped by the test" } }, { status: 503 });
        operations.push(JSON.parse(gunzipSync(new Uint8Array(init?.body as ArrayBuffer)).toString("utf8")).operationId);
        return (answers.shift() ?? (() => Response.json({ replace: { replaced: true, duplicate: true, headCursor: 9, snapshotRequired: false } })))();
      });
      runtime.armCloudReplacement();
      const outcome = runtime.replaceCloudWithCurrentLocalState().then(() => null, (error: Error) => error);
      return { error: await outcome, operations, paths };
    }

    it("asks again with the same operation until Community has saved it", async () => {
      const { error, operations, paths } = await resetAnswering([pending, pending]);
      expect(operations).toHaveLength(3);
      expect(new Set(operations).size).toBe(1);
      // Then it reads the saved library back, as after any reset.
      expect(paths.at(-1)).toBe("/api/v2/sync/snapshot");
      expect(error?.message).toContain("Stopped by the test");
    });

    it("stops after four requests and says the library is still being saved", async () => {
      const { error, operations } = await resetAnswering([pending, pending, pending, pending, pending]);
      expect(operations).toHaveLength(4);
      expect(error?.message).toContain("Your library is still being saved");
    });

    it("does not repeat a reset Community refused for another reason", async () => {
      const { operations } = await resetAnswering([() => Response.json({ error: { code: "sync_unavailable", message: "Try again shortly" } }, { status: 503 })]);
      expect(operations).toHaveLength(1);
    });
  });

  it("reads Community's capabilities first when this session has not synced yet", async () => {
    runtime.capabilities = null;
    const [request] = await sendReset(100);
    expect(request.headers["x-tagify-content-encoding"]).toBe("gzip");
  });

  it.each([
    ["compressed", { maxCompressedBytes: 1_000 }],
    ["expanded", { maxExpandedBytes: 100_000 }],
  ])("stops before sending when the %s library is larger than Community accepts", async (_label, limits) => {
    runtime.capabilities = { protocolVersion: 2, supportedProtocolVersions: [1, 2], [COMPRESSED_REPLACE_CAPABILITY]: { encoding: "gzip", ...limits } };
    vi.spyOn(storageService, "loadAll").mockResolvedValue(library(2_000));
    const request = vi.spyOn(globalThis, "fetch");
    runtime.armCloudReplacement();
    await expect(runtime.replaceCloudWithCurrentLocalState()).rejects.toThrow("This library is too large to reset from Tagify in one step.");
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps sending plain JSON from a Spotify version that cannot compress", async () => {
    runtime.capabilities = { protocolVersion: 2, supportedProtocolVersions: [1, 2], [COMPRESSED_REPLACE_CAPABILITY]: { encoding: "gzip", maxCompressedBytes: 4_000_000, maxExpandedBytes: 64_000_000 } };
    vi.stubGlobal("CompressionStream", undefined);
    const [request] = await sendReset(100);
    expect(request.headers["content-type"]).toBe("application/json");
  });

  it("only uses compression Community understands", () => {
    expect(compressedReplaceLimits({})).toBeNull();
    expect(compressedReplaceLimits(null)).toBeNull();
    expect(compressedReplaceLimits({ [COMPRESSED_REPLACE_CAPABILITY]: true })).toBeNull();
    expect(compressedReplaceLimits({ [COMPRESSED_REPLACE_CAPABILITY]: {} })).toBeNull();
    expect(compressedReplaceLimits({ [COMPRESSED_REPLACE_CAPABILITY]: { encoding: "br" } })).toBeNull();
    expect(compressedReplaceLimits({ [COMPRESSED_REPLACE_CAPABILITY]: { encoding: "gzip", maxCompressedBytes: 2_000_000, maxExpandedBytes: 30_000_000 } }))
      .toEqual({ maxCompressedBytes: 2_000_000, maxExpandedBytes: 30_000_000 });
    // Never above what the website can receive.
    expect(compressedReplaceLimits({ [COMPRESSED_REPLACE_CAPABILITY]: { encoding: "gzip", maxCompressedBytes: 50_000_000 } }))
      .toEqual({ maxCompressedBytes: MAX_COMPRESSED_REQUEST_BYTES, maxExpandedBytes: MAX_EXPANDED_REQUEST_BYTES });
  });
});
