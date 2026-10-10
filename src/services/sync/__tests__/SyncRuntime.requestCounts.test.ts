import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import type { SyncMutationV2 } from "@tagify/sync-contracts";
import { pullSideDocuments, syncRuntime } from "../SyncRuntime";
import { FakeCommunity, putStateRecord } from "./fakeCommunity";

const configuration: DesktopSyncConfiguration = {
  accountId: "request-count-account",
  libraryId: "123e4567-e89b-42d3-a456-426614174024",
  deviceId: "123e4567-e89b-42d3-a456-426614174025",
  apiBaseUrl: "https://community.example",
  supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "key",
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: Math.floor(Date.now() / 1000) + 3_600,
};
const TRACK = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const OTHER_TRACK = "spotify:track:1eyzqe2QqGZUmfcPZtrIyt";

type Runtime = {
  started: boolean;
  capabilities: unknown;
  channel: unknown;
  realtimeSubscribedAt: number;
  settleLocalAndPublicSync(configuration: DesktopSyncConfiguration, explicit?: boolean): Promise<void>;
  stop(): void;
};

/**
 * Upstream's in-memory Community (real push and pull rules) plus the parts a
 * request count needs: the local-file backup, private notes, explicit
 * acknowledgements, and, when `fewerRequests` is on, the migration 0114
 * behavior (pull revisions, acknowledging pulls, `known=` reads).
 */
function fakeCommunity({ fewerRequests }: { fewerRequests: boolean }) {
  const community = new FakeCommunity();
  // `localFilesRead` is the revision Community recorded this device reading (migration 0118).
  const server = { acknowledged: 0, localFilesRevision: 0, localFilesRead: -1, localFileEntries: {} as Record<string, unknown>, notesCursor: 0, requests: [] as string[] };
  const sideDocuments = () => (fewerRequests ? { sideDocuments: { localFilesRevision: server.localFilesRevision, privateNotesCursor: server.notesCursor } } : {});
  const foreignBatch = (uri: string) => community.commitFrom([{
    type: "annotation.patch", operationId: crypto.randomUUID(), origin: "desktop",
    entity: { provider: "spotify", kind: "track", providerId: uri.split(":")[2] },
    fields: { rating: 3 }, expectedRevisions: { rating: 0 },
  } as SyncMutationV2]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const headers = (init?.headers || {}) as Record<string, string>;
    server.requests.push(`${method} ${url.pathname}${url.searchParams.has("known") ? `?known=${url.searchParams.get("known")}` : ""}${headers["if-none-match"] ? " (if-none-match)" : ""}`);
    if (url.pathname === "/api/v2/sync/pull" && fewerRequests) {
      const after = Number(url.searchParams.get("after"));
      server.acknowledged = Math.max(server.acknowledged, Math.min(after, community.headCursor));
      if (after >= community.headCursor && headers["if-none-match"] === `"sync-cursor-${community.headCursor}"`) {
        return Response.json({ unchanged: true, headCursor: community.headCursor, ...sideDocuments() });
      }
      const page = await (await community.fetch(input, { ...init, headers: {} })).json();
      return Response.json({ ...page, ...sideDocuments() });
    }
    if (url.pathname === "/api/v2/sync/ack") {
      server.acknowledged = Math.max(server.acknowledged, JSON.parse(String(init?.body)).cursor);
      return Response.json({ acknowledged: true });
    }
    if (url.pathname === "/api/v2/sync/local-files" && method === "PUT") {
      Object.assign(server.localFileEntries, JSON.parse(String(init?.body)).entries);
      server.localFilesRevision++;
      return Response.json({ revision: server.localFilesRevision, changed: true });
    }
    if (url.pathname === "/api/v2/sync/local-files") {
      const known = url.searchParams.get("known");
      if (fewerRequests && known !== null && Number(known) === server.localFilesRevision) {
        server.localFilesRead = server.localFilesRevision;
        return Response.json({ unchanged: true, revision: server.localFilesRevision });
      }
      if (headers["if-none-match"] === `"local-files-${server.localFilesRevision}"`) return new Response(null, { status: 304 });
      // A complete single-page read is recorded too.
      if (fewerRequests) server.localFilesRead = server.localFilesRevision;
      return Response.json({ revision: server.localFilesRevision, entries: server.localFileEntries, nextAfter: null });
    }
    if (url.pathname === "/api/v2/sync/private-notes") {
      return Response.json({ notes: [], nextCursor: server.notesCursor, hasMore: false });
    }
    return community.fetch(input, init);
  });
  return { server, community, foreignBatch };
}

describe("Community requests per sync run", () => {
  let runtime: Runtime;

  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    setDesktopSyncConfiguration(configuration);
    expect(await storageService.switchAccountDatabase()).toBe(true);
    runtime = new (syncRuntime.constructor as unknown as new () => Runtime)();
    runtime.started = true;
    // Realtime is live, so a sync does not need to double-check for news.
    runtime.channel = {};
    runtime.realtimeSubscribedAt = Date.now();
  });

  afterEach(() => {
    runtime.stop();
    setDesktopSyncConfiguration(null);
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function useCapabilities(fewerRequests: boolean) {
    runtime.capabilities = {
      protocolVersion: 2,
      supportedProtocolVersions: [1, 2],
      privateNotes: { enabled: true },
      localFileBackup: { enabled: true, maxRequestBytes: 1_000_000, ...(fewerRequests ? { knownRevisionQuery: true } : {}) },
      ...(fewerRequests ? { pullSideDocuments: true, pullAcknowledgesCursor: true } : {}),
    };
  }

  async function primedCommunity(fewerRequests: boolean) {
    useCapabilities(fewerRequests);
    const community = fakeCommunity({ fewerRequests });
    // The first sync on a device reads every document once.
    await runtime.settleLocalAndPublicSync(configuration);
    community.server.requests.length = 0;
    return community;
  }

  async function edit(uri = TRACK) {
    expect(await storageService.saveTrack(uri, { rating: 4, energy: 0, bpm: null, tagIds: [], dateModified: Date.now() })).toBe(true);
  }

  describe("with Community's fewer-requests support", () => {
    it("checks an idle library with a single pull", async () => {
      const { server } = await primedCommunity(true);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)"]);
    });

    it("backs up an edit with pull, push, pull", async () => {
      const { server, community } = await primedCommunity(true);
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual([
        "GET /api/v2/sync/pull (if-none-match)",
        "POST /api/v2/sync/push",
        "GET /api/v2/sync/pull (if-none-match)",
      ]);
      // The next pull starts after the backup, which acknowledges it.
      expect(server.acknowledged).toBe(0);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.acknowledged).toBe(community.headCursor);
    });

    it("applies another device's change during an edit run without extra requests", async () => {
      const { server, foreignBatch } = await primedCommunity(true);
      foreignBatch(OTHER_TRACK);
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual([
        "GET /api/v2/sync/pull (if-none-match)",
        "POST /api/v2/sync/push",
        "GET /api/v2/sync/pull (if-none-match)",
      ]);
      expect(await indexedDBStorage.getTrack(OTHER_TRACK)).toMatchObject({ rating: 3 });
      expect(await indexedDBStorage.getTrack(TRACK)).toMatchObject({ rating: 4 });
    });

    it("reads local files and notes only after another device changed them", async () => {
      const { server } = await primedCommunity(true);
      server.localFilesRevision = 4;
      server.notesCursor = 7;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual([
        "GET /api/v2/sync/pull (if-none-match)",
        "GET /api/v2/sync/local-files?known=0",
        "GET /api/v2/sync/private-notes",
      ]);
      server.requests.length = 0;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)"]);
    });

    it("uploads a local-file edit, confirms reading it once, then stops reading", async () => {
      const { server } = await primedCommunity(true);
      expect(await indexedDBStorage.saveTrack("spotify:local:Band:Demo:Song:200", { rating: 5, energy: 0, bpm: null, tagIds: [], dateCreated: 1, dateModified: 1 })).toBe(true);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)", "PUT /api/v2/sync/local-files"]);
      expect(server.localFilesRevision).toBe(1);
      expect(server.localFilesRead).toBe(0);

      // Community needs to see this device read its own write before it can
      // drop old deletion records; one small read confirms it.
      server.requests.length = 0;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)", "GET /api/v2/sync/local-files?known=1"]);
      expect(server.localFilesRead).toBe(1);

      server.requests.length = 0;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)"]);
    });

    it("reads a backup written by another device normally, even right after this device's own write", async () => {
      const { server } = await primedCommunity(true);
      expect(await indexedDBStorage.saveTrack("spotify:local:Band:Demo:Song:200", { rating: 5, energy: 0, bpm: null, tagIds: [], dateCreated: 1, dateModified: 1 })).toBe(true);
      await runtime.settleLocalAndPublicSync(configuration);
      // Another device then writes revision 2.
      server.localFilesRevision = 2;
      server.requests.length = 0;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)", "GET /api/v2/sync/local-files?known=1"]);
      expect(server.localFilesRead).toBe(2);

      server.requests.length = 0;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)"]);
    });

    it("confirms once for a backup saved before Tagify tracked confirmed reads", async () => {
      const { server } = await primedCommunity(true);
      await putStateRecord({ key: "local-file-backup", revision: 0, entries: {} });
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)", "GET /api/v2/sync/local-files?known=0"]);
      server.requests.length = 0;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)"]);
    });
  });

  describe("with an older Community", () => {
    it("keeps reading every document on an idle check", async () => {
      const { server } = await primedCommunity(false);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual([
        "GET /api/v2/sync/pull (if-none-match)",
        "GET /api/v2/sync/local-files (if-none-match)",
        "GET /api/v2/sync/private-notes",
      ]);
    });

    it("keeps acknowledging an edit run explicitly", async () => {
      const { server, community } = await primedCommunity(false);
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual([
        "GET /api/v2/sync/pull (if-none-match)",
        "POST /api/v2/sync/push",
        "GET /api/v2/sync/pull (if-none-match)",
        "POST /api/v2/sync/ack",
        "GET /api/v2/sync/local-files (if-none-match)",
        "GET /api/v2/sync/private-notes",
      ]);
      expect(server.acknowledged).toBe(community.headCursor);
    });

    it("keeps today's local-file reads around this device's own upload", async () => {
      const { server } = await primedCommunity(false);
      expect(await indexedDBStorage.saveTrack("spotify:local:Band:Demo:Song:200", { rating: 5, energy: 0, bpm: null, tagIds: [], dateCreated: 1, dateModified: 1 })).toBe(true);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual([
        "GET /api/v2/sync/pull (if-none-match)",
        "GET /api/v2/sync/local-files (if-none-match)",
        "PUT /api/v2/sync/local-files",
        "GET /api/v2/sync/private-notes",
      ]);
      server.requests.length = 0;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual([
        "GET /api/v2/sync/pull (if-none-match)",
        "GET /api/v2/sync/local-files (if-none-match)",
        "GET /api/v2/sync/private-notes",
      ]);
    });

    it("ignores revisions in a pull response when Community did not advertise them", async () => {
      const { server, community } = await primedCommunity(false);
      vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
        server.requests.push("GET /api/v2/sync/pull (if-none-match)");
        return Response.json({ unchanged: true, headCursor: community.headCursor, sideDocuments: { localFilesRevision: 0, privateNotesCursor: 0 } });
      });
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toHaveLength(3);
    });
  });

  it("only accepts complete side-document revisions", () => {
    expect(pullSideDocuments({ sideDocuments: { localFilesRevision: 2, privateNotesCursor: 5 } })).toEqual({ localFilesRevision: 2, privateNotesCursor: 5 });
    expect(pullSideDocuments({ sideDocuments: { localFilesRevision: 2 } })).toBeNull();
    expect(pullSideDocuments({ sideDocuments: { localFilesRevision: "2", privateNotesCursor: 5 } })).toBeNull();
    expect(pullSideDocuments({ unchanged: true })).toBeNull();
    expect(pullSideDocuments(null)).toBeNull();
  });
});
