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
function fakeCommunity({ fewerRequests, laterBatches = false, pullRequestBody = false, othersActive, directPullDown = false }: { fewerRequests: boolean; laterBatches?: boolean; pullRequestBody?: boolean; othersActive?: boolean; directPullDown?: boolean }) {
  const community = new FakeCommunity();
  // `localFilesRead` is the revision Community recorded this device reading (migration 0118).
  const server = { acknowledged: 0, localFilesRevision: 0, localFilesRead: -1, localFileEntries: {} as Record<string, unknown>, notesCursor: 0, requests: [] as string[], preflights: [] as string[] };
  // Chromium sends a CORS preflight before a request with an authorization or
  // custom header, and reuses the answer for the same address until
  // Community's access-control-max-age (7200 s) runs out.
  const preflightedUrls = new Set<string>();
  const sideDocuments = () => ({
    ...(fewerRequests ? { sideDocuments: { localFilesRevision: server.localFilesRevision, privateNotesCursor: server.notesCursor } } : {}),
    // Migration 0170: whether another device or the website used the library recently.
    ...(othersActive === undefined ? {} : { liveSync: { realtime: othersActive } }),
  });
  const foreignBatch = (uri: string) => community.commitFrom([{
    type: "annotation.patch", operationId: crypto.randomUUID(), origin: "desktop",
    entity: { provider: "spotify", kind: "track", providerId: uri.split(":")[2] },
    fields: { rating: 3 }, expectedRevisions: { rating: 0 },
  } as SyncMutationV2]);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const headers = (init?.headers || {}) as Record<string, string>;
    if (Object.keys(headers).some((name) => name === "authorization" || name.startsWith("x-tagify-")) && !preflightedUrls.has(url.href)) {
      preflightedUrls.add(url.href);
      server.preflights.push(`OPTIONS ${url.pathname}${url.search}`);
    }
    const site = url.origin === "https://supabase.example" ? "DIRECT " : "";
    const query = url.searchParams.has("known") ? `?known=${url.searchParams.get("known")}` : url.searchParams.has("later") ? `?later=${url.searchParams.get("later")}` : "";
    server.requests.push(`${site}${method} ${url.pathname}${query}${headers["if-none-match"] ? " (if-none-match)" : ""}`);
    // Migration 0118's pull: asking for changes after a cursor acknowledges it.
    const pullPage = async (after: number, ifNoneMatch?: string) => {
      server.acknowledged = Math.max(server.acknowledged, Math.min(after, community.headCursor));
      if (after >= community.headCursor && (ifNoneMatch === undefined || ifNoneMatch === `"sync-cursor-${community.headCursor}"`)) {
        return { unchanged: true, headCursor: community.headCursor, batches: [], ...sideDocuments() };
      }
      const page = await (await community.fetch(`https://community.example/api/v2/sync/pull?after=${after}&limit=200`)).json();
      return { ...page, ...sideDocuments() };
    };
    // Migration 0170's function, called through the database's API (docs/DESKTOP_DIRECT_PULL.md).
    if (url.origin === "https://supabase.example" && url.pathname === "/rest/v1/rpc/pull_sync_changes_with_live_sync") {
      if (directPullDown) throw new TypeError("Failed to fetch");
      const body = JSON.parse(String(init?.body));
      if (headers.apikey !== configuration.supabasePublishableKey || headers.authorization !== `Bearer ${configuration.accessToken}` || body.p_direct !== true) return Response.json({ code: "28000" }, { status: 403 });
      return Response.json(await pullPage(Number(body.p_after_cursor)));
    }
    if (url.pathname === "/api/v2/sync/pull" && fewerRequests) {
      const after = method === "POST" && pullRequestBody ? JSON.parse(String(init?.body)).after : Number(url.searchParams.get("after"));
      if (method === "POST" && !pullRequestBody) return new Response(null, { status: 405 });
      return Response.json(await pullPage(Number(after), headers["if-none-match"]));
    }
    if (url.pathname === "/api/v2/sync/push" && laterBatches && url.searchParams.get("later") === "1") {
      // The push route's follow-up read: the same pull, from the batch's base cursor.
      const body = JSON.parse(String(init?.body));
      const result = await (await community.fetch(input, init)).json();
      return Response.json({ ...result, later: await pullPage(body.baseCursor) });
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

  type Support = { laterBatches?: boolean; pullRequestBody?: boolean; othersActive?: boolean; directPull?: boolean; directPullDown?: boolean };
  function useCapabilities(fewerRequests: boolean, { laterBatches = false, pullRequestBody = false, othersActive, directPull = false }: Support = {}) {
    runtime.capabilities = {
      protocolVersion: 2,
      supportedProtocolVersions: [1, 2],
      privateNotes: { enabled: true },
      localFileBackup: { enabled: true, maxRequestBytes: 1_000_000, ...(fewerRequests ? { knownRevisionQuery: true } : {}) },
      ...(fewerRequests ? { pullSideDocuments: true, pullAcknowledgesCursor: true } : {}),
      ...(laterBatches ? { pushReturnsLaterBatches: true } : {}),
      ...(pullRequestBody ? { pullRequestBody: true } : {}),
      ...(othersActive === undefined ? {} : { liveSyncHints: true }),
      ...(directPull ? { directPull: { rpc: "pull_sync_changes_with_live_sync" } } : {}),
    };
  }

  /** `serverSupport` differs from what capabilities advertise only to simulate a rolled-back Community. */
  async function primedCommunity(fewerRequests: boolean, support: Support = {}, serverSupport: Support = support) {
    useCapabilities(fewerRequests, support);
    const community = fakeCommunity({ fewerRequests, ...serverSupport });
    // The first sync on a device reads every document once.
    await runtime.settleLocalAndPublicSync(configuration);
    community.server.requests.length = 0;
    return community;
  }

  async function edit(uri = TRACK, rating = 4) {
    expect(await storageService.saveTrack(uri, { rating, energy: 0, bpm: null, tagIds: [], dateModified: Date.now() })).toBe(true);
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

  describe("with Community returning later changes from a push", () => {
    it("backs up an edit with one push while Realtime shows this device is current", async () => {
      const { server, community } = await primedCommunity(true, { laterBatches: true });
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      // Before: pull, push, pull (three requests).
      expect(server.requests).toEqual(["POST /api/v2/sync/push?later=1"]);
      expect(community.headCursor).toBe(1);
      expect(await indexedDBStorage.getTrack(TRACK)).toMatchObject({ rating: 4 });
      // The push's own echo confirmed the edit: nothing is left to send.
      server.requests.length = 0;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)"]);
    });

    it("keeps several edit runs at one request each", async () => {
      const { server } = await primedCommunity(true, { laterBatches: true });
      for (const [uri, rating] of [[TRACK, 4], [OTHER_TRACK, 5], [TRACK, 2]] as const) {
        await edit(uri, rating);
        await runtime.settleLocalAndPublicSync(configuration);
      }
      expect(server.requests).toEqual(Array(3).fill("POST /api/v2/sync/push?later=1"));
      expect(await indexedDBStorage.getTrack(TRACK)).toMatchObject({ rating: 2 });

      // Saving a value Community already holds sends nothing at all.
      server.requests.length = 0;
      await edit(TRACK, 2);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual([]);
    });

    it("brings back another device's unannounced change with the push", async () => {
      const { server, foreignBatch } = await primedCommunity(true, { laterBatches: true });
      foreignBatch(OTHER_TRACK);
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["POST /api/v2/sync/push?later=1"]);
      expect(await indexedDBStorage.getTrack(OTHER_TRACK)).toMatchObject({ rating: 3 });
      expect(await indexedDBStorage.getTrack(TRACK)).toMatchObject({ rating: 4 });
      expect(server.acknowledged).toBe(0);
    });

    it("still keeps this device's edit when another device changed the same song first", async () => {
      const { server, community, foreignBatch } = await primedCommunity(true, { laterBatches: true });
      foreignBatch(TRACK);
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      // The first push meets the other device's newer revision; the change it
      // brought back lets the second push go through.
      expect(server.requests).toEqual(["POST /api/v2/sync/push?later=1", "POST /api/v2/sync/push?later=1"]);
      expect(community.annotation({ provider: "spotify", kind: "track", providerId: TRACK.split(":")[2] }).fields.rating.value).toBe(4);
      expect(await indexedDBStorage.getTrack(TRACK)).toMatchObject({ rating: 4 });
    });

    it("catches up first once Realtime announced a newer change", async () => {
      const { server, foreignBatch, community } = await primedCommunity(true, { laterBatches: true });
      foreignBatch(OTHER_TRACK);
      (runtime as unknown as { announcedHead: number }).announcedHead = community.headCursor;
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)", "POST /api/v2/sync/push?later=1"]);
    });

    it("catches up first without a live Realtime connection", async () => {
      const { server } = await primedCommunity(true, { laterBatches: true });
      runtime.channel = null;
      runtime.realtimeSubscribedAt = 0;
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      // Before: pull, push, pull, pull (the last because nothing announces news).
      expect(server.requests).toEqual([
        "GET /api/v2/sync/pull (if-none-match)",
        "POST /api/v2/sync/push?later=1",
        "GET /api/v2/sync/pull (if-none-match)",
      ]);
    });

    it("catches up first after Realtime reconnected", async () => {
      const { server } = await primedCommunity(true, { laterBatches: true });
      // Announcements while disconnected were missed.
      runtime.realtimeSubscribedAt = Date.now() + 1;
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)", "POST /api/v2/sync/push?later=1"]);
    });

    it("pulls as before when Community saved the edit without the later changes", async () => {
      const { server, community } = await primedCommunity(true, { laterBatches: true });
      const fetchMock = vi.mocked(globalThis.fetch);
      const answer = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input, init) => {
        const response = await answer(input, init);
        if (!new URL(String(input)).pathname.endsWith("/push")) return response;
        const { later: _later, ...saved } = await response.json();
        return Response.json(saved);
      });
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["POST /api/v2/sync/push?later=1", "GET /api/v2/sync/pull (if-none-match)"]);
      expect(server.acknowledged).toBe(0);
      expect(community.headCursor).toBe(1);
    });
  });

  describe("a library used on one computer", () => {
    const everything = { laterBatches: true, pullRequestBody: true, othersActive: false };

    beforeEach(() => {
      // No Realtime: Community said nobody else uses this library.
      runtime.channel = null;
      runtime.realtimeSubscribedAt = 0;
    });

    it("backs up an edit with one request and opens no live connection", async () => {
      const { server } = await primedCommunity(true, everything);
      expect((runtime as unknown as { realtimeWanted: boolean | null }).realtimeWanted).toBe(false);
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      // Before: pull, push, pull, and a final pull without Realtime.
      expect(server.requests).toEqual(["POST /api/v2/sync/push?later=1"]);
    });

    it("checks an idle library with one request", async () => {
      const { server } = await primedCommunity(true, everything);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["POST /api/v2/sync/pull (if-none-match)"]);
    });

    it("still brings back a change from a device that just started", async () => {
      const { server, foreignBatch } = await primedCommunity(true, everything);
      foreignBatch(OTHER_TRACK);
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["POST /api/v2/sync/push?later=1"]);
      expect(await indexedDBStorage.getTrack(OTHER_TRACK)).toMatchObject({ rating: 3 });
    });
  });

  describe("reading changes directly from the database's API", () => {
    const direct = { laterBatches: true, pullRequestBody: true, othersActive: true, directPull: true };

    it("checks an idle library without a website request", async () => {
      const { server } = await primedCommunity(true, direct);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["DIRECT POST /rest/v1/rpc/pull_sync_changes_with_live_sync"]);
    });

    it("catches up on another device's change without a website request", async () => {
      const { server, foreignBatch, community } = await primedCommunity(true, direct);
      foreignBatch(OTHER_TRACK);
      (runtime as unknown as { announcedHead: number }).announcedHead = community.headCursor;
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["DIRECT POST /rest/v1/rpc/pull_sync_changes_with_live_sync"]);
      expect(await indexedDBStorage.getTrack(OTHER_TRACK)).toMatchObject({ rating: 3 });
      expect(server.acknowledged).toBe(0);
    });

    it("still backs up edits through the website", async () => {
      const { server } = await primedCommunity(true, direct);
      await edit();
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["POST /api/v2/sync/push?later=1"]);
    });

    it("goes back to the website's address for the session when a direct read fails", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { server } = await primedCommunity(true, direct, { ...direct, directPullDown: true });
      await runtime.settleLocalAndPublicSync(configuration);
      // The first sync already met the failure and switched.
      expect(server.requests).toEqual(["POST /api/v2/sync/pull (if-none-match)"]);
    });

    it("is not used unless Community advertises it", async () => {
      const { server } = await primedCommunity(true, { ...direct, directPull: false });
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["POST /api/v2/sync/pull (if-none-match)"]);
    });
  });

  describe("CORS preflights during a tagging session", () => {
    /** Three edits, each followed by an idle check, after the device's first sync. */
    async function taggingSession(support: Support) {
      const community = await primedCommunity(true, support);
      // Answers Spotify already holds from the first sync stay valid.
      community.server.preflights.length = 0;
      for (const [uri, rating] of [[TRACK, 4], [OTHER_TRACK, 5], [TRACK, 2]] as const) {
        await edit(uri, rating);
        await runtime.settleLocalAndPublicSync(configuration);
        await runtime.settleLocalAndPublicSync(configuration);
      }
      return community.server;
    }

    it("before: every new cursor costs a preflight and every edit three requests", async () => {
      const server = await taggingSession({});
      expect(server.requests).toHaveLength(12);
      expect(server.preflights).toEqual([
        "OPTIONS /api/v2/sync/push",
        ...[1, 2, 3].map((cursor) => `OPTIONS /api/v2/sync/pull?deviceId=${configuration.deviceId}&after=${cursor}&limit=200`),
      ]);
    });

    it("after: one address per route, and one request per edit", async () => {
      const server = await taggingSession({ laterBatches: true, pullRequestBody: true });
      expect(server.requests).toEqual(Array(3).fill(["POST /api/v2/sync/push?later=1", "POST /api/v2/sync/pull (if-none-match)"]).flat());
      expect(server.preflights).toEqual(["OPTIONS /api/v2/sync/push?later=1"]);
    });

    it("goes back to the earlier pull for the session when Community stops accepting it", async () => {
      const { server } = await primedCommunity(true, { pullRequestBody: true }, { pullRequestBody: false });
      // The first sync already met the refusal and switched.
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["GET /api/v2/sync/pull (if-none-match)"]);
    });

    it("goes back to the earlier pull when a refused request surfaces as a network failure", async () => {
      const { server } = await primedCommunity(true, { pullRequestBody: true });
      const fetchMock = vi.mocked(globalThis.fetch);
      const answer = fetchMock.getMockImplementation()!;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      fetchMock.mockImplementation(async (input, init) => {
        if (init?.method === "POST" && new URL(String(input)).pathname.endsWith("/pull")) {
          server.requests.push("POST /api/v2/sync/pull (blocked)");
          throw new TypeError("Failed to fetch");
        }
        return answer(input, init);
      });
      await runtime.settleLocalAndPublicSync(configuration);
      await runtime.settleLocalAndPublicSync(configuration);
      expect(server.requests).toEqual(["POST /api/v2/sync/pull (blocked)", "GET /api/v2/sync/pull (if-none-match)", "GET /api/v2/sync/pull (if-none-match)"]);
    });

    it("reports a real failure instead of switching when offline", async () => {
      const { server } = await primedCommunity(true, { pullRequestBody: true });
      vi.mocked(globalThis.fetch).mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
      await expect(runtime.settleLocalAndPublicSync(configuration)).rejects.toThrow("Failed to fetch");
      expect((runtime as unknown as { pullRequestBodyUnavailable: boolean }).pullRequestBodyUnavailable).toBe(false);
      expect(server.requests).toEqual([]);
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
