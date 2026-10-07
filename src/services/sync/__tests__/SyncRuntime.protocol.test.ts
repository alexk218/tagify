import packageJson from "@/package";
import { readFileSync } from "node:fs";
import type { AnnotationSnapshotV1, TaxonomyNodeSnapshotV1 } from "@tagify/sync-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncRuntime, accountSyncLockName, buildLocalSnapshot, canCombineInitialLibrariesWithoutReview, capabilitiesCacheKey, coalesceOutboxIntents, expandSyncTaxonomy, gzipJsonBody, materializeEntity, parentRevisionsFromSnapshot, planDurableAppStateConflictReconciliation, revokeDesktopSyncDevice, runWithAccountSyncLock, safetySyncDelayMs, shouldStampAnnotationDateModified, syncClientHeaders, syncFailureBackoffMs, type InitialMergeReview } from "../SyncRuntime";
import { setDesktopSyncConfiguration } from "../SyncLocalState";
import type { EntityReplaceIntent } from "../SyncLocalState";
import { defaultTagData } from "@/constants/defaultTagData";

describe("desktop sync protocol invariants", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setDesktopSyncConfiguration(null);
    const runtime = syncRuntime as unknown as { recoveryPreview: unknown; status: string };
    runtime.recoveryPreview = null;
    runtime.status = "unlinked";
  });
  it("keeps a tagged track but omits its zero-tempo placeholder from a library merge", async () => {
    const uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
    const track = { rating: 0.5, energy: 5, bpm: 0, camelotKey: "1A", tagIds: ["tag_1s2agyx"], dateModified: 1_000 };
    const snapshot = await buildLocalSnapshot("123e4567-e89b-42d3-a456-426614174004", {
      ...defaultTagData,
      tracks: { [uri]: track },
    });

    expect(snapshot.annotations).toEqual([expect.objectContaining({
      fields: expect.objectContaining({ bpm: { value: null, revision: 0 } }),
      tagMemberships: { tag_1s2agyx: { value: true, revision: 0 } },
    })]);
    expect(track.bpm).toBe(0);
    expect(track.dateModified).toBe(1_000);
  });

  it("normalizes an older queued edit before sending it to Community", async () => {
    const entity = { provider: "spotify" as const, kind: "track" as const, providerId: "4uLU6hMCjMI75M1A2tKUQC" };
    const intent = {
      id: "old-edit", batchId: "old-batch", createdAt: 1, type: "entity.replace" as const, entity,
      desired: { rating: 0.5, energy: 5, bpm: 0, key: "1A", tagIds: ["tag_1s2agyx"] },
    } satisfies EntityReplaceIntent;
    const shadow = {
      entity,
      fields: {
        rating: { value: null, revision: 0 }, energy: { value: null, revision: 0 },
        bpm: { value: 120, revision: 1 }, key: { value: null, revision: 0 },
      },
      tagMemberships: {}, entityRevision: 1, deleted: false,
    } satisfies AnnotationSnapshotV1;

    const operations = await materializeEntity(intent, shadow);

    expect(operations).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "annotation.patch",
      fields: expect.objectContaining({ bpm: null }),
    })]));
    expect(operations.some((operation) => operation.type === "annotation.patch" && operation.fields.bpm === 0)).toBe(false);
  });

  it("combines only supported libraries with no choices to resolve", () => {
    const review = { supported: true, conflicts: [] } as unknown as InitialMergeReview;
    expect(canCombineInitialLibrariesWithoutReview(review)).toBe(true);
    expect(canCombineInitialLibrariesWithoutReview({ ...review, supported: false })).toBe(false);
    expect(canCombineInitialLibrariesWithoutReview({ ...review, conflicts: [{ id: "rating" }] as InitialMergeReview["conflicts"] })).toBe(false);
    expect(canCombineInitialLibrariesWithoutReview(null)).toBe(false);
  });

  it("checks both first-sync paths before asking for a library choice", () => {
    const source = readFileSync("src/services/sync/SyncRuntime.ts", "utf8");
    const firstSync = source.match(/private async ensureReplicaReady[\s\S]+?private async prepareInitialMerge/)?.[0] || "";
    const bootstrap = source.match(/private async bootstrap[\s\S]+?private async request\(/)?.[0] || "";
    expect(firstSync).toContain("this.reconcileInitialLibraries(configuration)");
    expect(bootstrap).toContain("if (await this.reconcileInitialLibraries(configuration)) return");
  });

  it("uses the library cursor and fingerprint guards when committing a merge", () => {
    const source = readFileSync("src/services/sync/SyncRuntime.ts", "utf8");
    const commit = source.match(/async commitInitialMerge[\s\S]+?async downloadInitialMergeBackup/)?.[0] || "";
    expect(commit).toContain("expectedCommunityHeadCursor: review.communityHeadCursor");
    expect(commit).toContain("expectedCommunityChecksum: review.communityChecksum");
  });

  it("backs recovery pulls off from five to fifteen to thirty minutes", () => {
    expect(safetySyncDelayMs(0, () => 0)).toBe(5 * 60_000);
    expect(safetySyncDelayMs(1, () => 0)).toBe(15 * 60_000);
    expect(safetySyncDelayMs(2, () => 0)).toBe(30 * 60_000);
    expect(safetySyncDelayMs(2, () => 1)).toBe(36 * 60_000);
  });

  it("serializes sync across Spotify bundles for the same Community account", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let tail = Promise.resolve<unknown>(undefined);
    const requestedLocks: string[] = [];
    const lockManager = {
      request<T>(name: string, _options: { mode: "exclusive" }, callback: () => Promise<T>): Promise<T> {
        requestedLocks.push(name);
        const result = tail.then(callback) as Promise<T>;
        tail = result.catch(() => undefined);
        return result;
      },
    };
    const order: string[] = [];

    const first = runWithAccountSyncLock("account-a", async () => {
      order.push("first-start");
      await firstBlocked;
      order.push("first-end");
    }, lockManager);
    const second = runWithAccountSyncLock("account-a", async () => {
      order.push("second-start");
    }, lockManager);

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    expect(requestedLocks).toEqual([
      accountSyncLockName("account-a"),
      accountSyncLockName("account-a"),
    ]);
  });

  it("resumes recovery promptly when Spotify becomes visible again", () => {
    const source = readFileSync("src/services/sync/SyncRuntime.ts", "utf8");
    expect(source).toContain('document.addEventListener("visibilitychange", this.handleVisibilityChange)');
    expect(source).toContain('document.visibilityState !== "visible"');
    expect(source).toContain("this.resetRecoverySchedule()");
  });

  it("identifies efficient clients on every sync request and scopes capability caches by app and origin", () => {
    expect(syncClientHeaders("token")).toMatchObject({
      authorization: "Bearer token",
      "x-tagify-client-version": packageJson.version,
      "x-tagify-sync-protocol": "2",
      "x-tagify-sync-generation": "event-driven-v1",
    });
    expect(capabilitiesCacheKey("https://community.example/path")).toContain(`${packageJson.version}:https://community.example`);
  });

  it("compresses reviewed initial libraries before sending them through Vercel", async () => {
    const source = JSON.stringify({ annotations: Array.from({ length: 200 }, (_, index) => ({ id: index, tags: ["ambient", "night"] })) });
    const compressed = await gzipJsonBody(JSON.parse(source));
    expect(compressed.byteLength).toBeLessThan(source.length);
    expect(readFileSync("src/services/sync/SyncRuntime.ts", "utf8")).toContain('"x-tagify-content-encoding": "gzip"');
  });

  it("backs off aggressively while Vercel has paused the deployment", () => {
    expect(syncFailureBackoffMs(402, null, 0, () => 0)).toBe(6 * 60 * 60_000);
    expect(syncFailureBackoffMs(429, 900, 0, () => 0)).toBe(900_000);
    expect(syncFailureBackoffMs(503, null, 0, () => 0)).toBe(60_000);
    expect(syncFailureBackoffMs(503, null, 6, () => 0)).toBe(60 * 60_000);
  });

  it("coalesces repeated local entity and taxonomy writes up to a snapshot boundary", () => {
    const entity = { provider: "spotify" as const, kind: "track" as const, providerId: "track123" };
    const plan = coalesceOutboxIntents([
      { id: "entity-old", batchId: "one", createdAt: 1, type: "entity.replace", entity, desired: { rating: 1, energy: null, bpm: null, key: null, tagIds: [] } },
      { id: "taxonomy-old", batchId: "two", createdAt: 2, type: "taxonomy.replace", taxonomy: {} as never },
      { id: "entity-new", batchId: "three", createdAt: 3, type: "entity.replace", entity, desired: { rating: 5, energy: null, bpm: null, key: null, tagIds: ["favorite"] } },
      { id: "taxonomy-new", batchId: "four", createdAt: 4, type: "taxonomy.replace", taxonomy: {} as never },
      { id: "snapshot", batchId: "five", createdAt: 5, type: "library.snapshot", reason: "import" },
      { id: "after-snapshot", batchId: "six", createdAt: 6, type: "entity.delete", entity },
    ]);

    expect(plan.intents.map((intent) => intent.id)).toEqual(["entity-new", "taxonomy-new"]);
    expect(plan.supersededIds).toEqual(["entity-old", "taxonomy-old"]);
  });

  it("revokes the linked Community device before local unlinking", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
    await revokeDesktopSyncDevice({
      accountId: "account",
      libraryId: "library",
      deviceId: "device/id",
      apiBaseUrl: "https://community.example",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "key",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: 1,
    }, request);

    expect(request).toHaveBeenCalledWith(
      "https://community.example/api/v2/devices/device%2Fid",
      { method: "DELETE", headers: expect.objectContaining({ authorization: "Bearer access-token", "x-tagify-sync-generation": "event-driven-v1" }) },
    );
  });

  it("allows local unlinking when the remote session is already inactive", async () => {
    const request = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(revokeDesktopSyncDevice({
      accountId: "account",
      libraryId: "library",
      deviceId: "device",
      apiBaseUrl: "https://community.example",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "key",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: 1,
    }, request)).resolves.toBeUndefined();
  });
  it("preserves canonical parent-list revisions after a snapshot", () => {
    const nodes = [
      { id: "category", kind: "category", parentId: null, parentListRevision: 4 },
      { id: "subcategory", kind: "subcategory", parentId: "category", parentListRevision: 7 },
      { id: "tag", kind: "tag", parentId: "subcategory", parentListRevision: 9 },
    ] as TaxonomyNodeSnapshotV1[];

    expect(parentRevisionsFromSnapshot(nodes)).toEqual({ __root__: 4, category: 7, subcategory: 9 });
  });

  it("reconstructs taxonomy ordering used by remote structural batches", () => {
    const taxonomy = expandSyncTaxonomy({
      taxonomy: [
        { id: "category", kind: "category", parentId: null, name: "Mood", accentId: null, position: 0, nodeRevision: 1, parentListRevision: 1, deleted: false },
        { id: "subcategory", kind: "subcategory", parentId: "category", name: "Energy", accentId: null, position: 0, nodeRevision: 1, parentListRevision: 1, deleted: false },
        { id: "tag", kind: "tag", parentId: "subcategory", name: "Peak", accentId: "custom:red", position: 0, nodeRevision: 1, parentListRevision: 1, deleted: false },
      ],
      colors: [{ id: "custom:red", name: "Red", color: "#ff0000", revision: 1, deleted: false }],
      collections: [{ id: "warm", name: "Warm", colorIds: ["custom:red"], position: 0, revision: 1, deleted: false }],
    });

    expect(taxonomy.categoryOrder).toEqual(["category"]);
    expect(taxonomy.categoriesById.category.subcategoryIds).toEqual(["subcategory"]);
    expect(taxonomy.subcategoriesById.subcategory.tagIds).toEqual(["tag"]);
    expect(taxonomy.colorThemeOrder).toEqual(["warm"]);
  });

  it("reconstructs direct category tags and nested sync folders", () => {
    const taxonomy = expandSyncTaxonomy({
      taxonomy: [
        { id: "category", kind: "category", parentId: null, name: "Mood", accentId: null, position: 0, nodeRevision: 1, parentListRevision: 1, deleted: false },
        { id: "direct", kind: "tag", parentId: "category", name: "Nocturnal", accentId: null, position: 0, nodeRevision: 1, parentListRevision: 1, deleted: false },
        { id: "folder", kind: "folder", parentId: "category", name: "Energy", accentId: null, position: 1, nodeRevision: 1, parentListRevision: 1, deleted: false },
        { id: "nested", kind: "folder", parentId: "folder", name: "Peak", accentId: null, position: 0, nodeRevision: 1, parentListRevision: 1, deleted: false },
        { id: "tag", kind: "tag", parentId: "nested", name: "Glowing", accentId: null, position: 0, nodeRevision: 1, parentListRevision: 1, deleted: false },
      ],
      colors: [],
      collections: [],
    });

    expect(taxonomy.childrenByParentId?.category).toEqual(["direct", "folder"]);
    expect(taxonomy.childrenByParentId?.folder).toEqual(["nested"]);
    expect(taxonomy.childrenByParentId?.nested).toEqual(["tag"]);
    expect(taxonomy.tagsById.direct.parentId).toBe("category");
  });

  it("never advances the durable pull cursor from a push response", () => {
    const source = readFileSync("src/services/sync/SyncRuntime.ts", "utf8");
    const pushBody = source.match(/private async push[\s\S]+?private async bootstrap/)?.[0] || "";
    expect(pushBody).toContain("await deleteOutbox");
    expect(pushBody).not.toContain("writeCursorAndConflicts(result.headCursor");
    expect(pushBody).not.toContain("applyOperationToShadow(operation)");
  });

  it("does not poll projection confirmation after every private backup", () => {
    const source = readFileSync("src/services/sync/SyncRuntime.ts", "utf8");
    const runBody = source.match(/private async run[\s\S]+?async restoreFromCloud/)?.[0] || "";
    expect(runBody).toContain("await this.settleLocalAndPublicSync(active)");
    expect(runBody).toContain("this.setSettledStatus()");
    expect(source).not.toContain('"/api/v2/sync/confirm"');
    expect(source).toContain('event: "projection_cursor"');
    expect(source).toContain('this.projectionReviewRequired ? "publication-review-required"');
  });

  it("reconciles stale durable-state revisions against the canonical snapshot", () => {
    const canonicalPreference = {
      domain: "preferences" as const,
      value: { "tagify:tagFilterEditorMode": "advanced" },
      revision: 3,
      updatedAt: "2026-09-16T00:00:00.000Z",
    };

    expect(planDurableAppStateConflictReconciliation(
      ["preferences", "smart-playlists"],
      [canonicalPreference],
    )).toEqual({
      canonicalDocuments: [canonicalPreference],
      missingDomains: ["smart-playlists"],
    });
  });

  it("restores smart playlists atomically with a cloud snapshot", () => {
    const storageSource = readFileSync("src/services/storage/IndexedDBStorageService.ts", "utf8");
    const replaceBody = storageSource.match(/async replaceCloudReplica[\s\S]+?private async getStoredTaxonomyRecord/)?.[0] || "";
    const runtimeSource = readFileSync("src/services/sync/SyncRuntime.ts", "utf8");

    expect(replaceBody).toContain('document.domain === "smart-playlists"');
    expect(replaceBody).toContain("durableSmartPlaylists.forEach");
    expect(runtimeSource).toContain("smartPlaylistsAlreadyPersisted: true");
  });

  it("does not invent a new Last Updated timestamp during snapshot recovery", () => {
    const runtimeSource = readFileSync("src/services/sync/SyncRuntime.ts", "utf8");
    const materializer = runtimeSource.match(/function tagDataFromSnapshot[\s\S]+?function replicaManifest/)?.[0] || "";
    const storageSource = readFileSync("src/services/storage/IndexedDBStorageService.ts", "utf8");
    const replaceBody = storageSource.match(/async replaceCloudReplica[\s\S]+?private async getStoredTaxonomyRecord/)?.[0] || "";

    expect(materializer).not.toContain("dateModified: Date.now()");
    expect(replaceBody).toContain("previousDateModified");
  });

  it("flushes debounced persistence and drains every outbox batch before completing Sync Now", () => {
    const source = readFileSync("src/services/sync/SyncRuntime.ts", "utf8");
    const settleBody = source.match(/private async settleLocalAndPublicSync[\s\S]+?private async push/)?.[0] || "";
    expect(settleBody).toContain("await flushLocalPersistence()");
    expect(settleBody).toContain("const firstIntent = (await readOutbox())[0]");
    expect(settleBody).toContain("await this.push(configuration)");
    expect(settleBody).not.toContain("confirmProjection");
    expect(settleBody).toContain("if (!(await readOutbox()).length) return");
  });

  it("does not treat track audio metadata patches as tagging edits", () => {
    expect(shouldStampAnnotationDateModified({
      type: "annotation.patch",
      operationId: "audio-only",
      origin: "desktop",
      entity: { provider: "spotify", kind: "track", providerId: "track123" },
      fields: { bpm: 124, key: "9B" },
      expectedRevisions: {},
    })).toBe(false);

    expect(shouldStampAnnotationDateModified({
      type: "annotation.patch",
      operationId: "rating",
      origin: "desktop",
      entity: { provider: "spotify", kind: "track", providerId: "track123" },
      fields: { rating: 4 },
      expectedRevisions: {},
    })).toBe(true);

    expect(shouldStampAnnotationDateModified({
      type: "annotation.tag-membership",
      operationId: "tag",
      origin: "desktop",
      entity: { provider: "spotify", kind: "track", providerId: "track123" },
      tagId: "tag_house",
      present: true,
      expectedRevision: 0,
    })).toBe(true);
  });

  it("does not start ordinary sync while cloud recovery is pending", async () => {
    setDesktopSyncConfiguration({
      accountId: "account-1",
      libraryId: "library-1",
      deviceId: "device-1",
      apiBaseUrl: "https://community.tagify.fm",
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "key",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
    });
    const runtime = syncRuntime as unknown as {
      recoveryPreview: { annotations: number; taxonomyNodes: number; appStateDocuments: number; lastBackupAt: null; protectedDomains: string[] };
      status: string;
    };
    runtime.recoveryPreview = { annotations: 10, taxonomyNodes: 4, appStateDocuments: 2, lastBackupAt: null, protectedDomains: [] };
    runtime.status = "syncing";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await syncRuntime.syncNow();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(syncRuntime.getStatus()).toBe("recovery-available");
    expect(syncRuntime.getRecoveryPreview()).not.toBeNull();
  });
});
