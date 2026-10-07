import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getTagifyDatabaseName } from "../SyncLocalState";
import { PENDING_PAIRING_STORAGE_KEY, syncPairingService } from "../SyncPairingService";

const smartPlaylist = {
  id: "five-stars",
  playlistId: "2rHTLOgs7Ygr6rp76Hw5n9",
  playlistName: "5★",
  criteria: {
    includeTagClauses: [],
    clauseConnectors: [],
    ratingFilters: [5],
    energyMinFilter: null,
    energyMaxFilter: null,
    bpmMinFilter: null,
    bpmMaxFilter: null,
  },
  isActive: true,
  createdAt: 1,
  lastSyncAt: 0,
  smartPlaylistTrackUris: [],
};

describe("smart playlists across Community pairing", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.clear();
    expect(await indexedDBStorage.init()).toBe(true);
    expect(await indexedDBStorage.saveSmartPlaylists([smartPlaylist])).toBe(true);
  });

  afterEach(() => {
    syncPairingService.cancelPending();
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function connect(): Promise<void> {
    localStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify({
      apiBaseUrl: "https://community.tagify.fm",
      deviceCode: "device-code",
      verifier: "verifier",
      userCode: "ABCD-EFGH",
      verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH",
      expiresAt: Date.now() + 60_000,
      interval: 5,
    }));
    const payload = btoa(JSON.stringify({
      sub: "account-a",
      iss: "https://example.supabase.co/auth/v1",
    })).replace(/=+$/, "");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      accessToken: `header.${payload}.signature`,
      refreshToken: "refresh",
      libraryId: "library-a",
      deviceId: "device-a",
      supabasePublishableKey: "key",
      expiresAt: Date.now() + 60_000,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const approval = await syncPairingService.poll();
    expect(approval.status).toBe("approved");
    if (approval.status !== "approved") throw new Error("Pairing was not approved");
    await syncPairingService.complete(approval.approval);
  }

  it("keeps a working rule when a local library connects to Community", async () => {
    await connect();

    expect(getTagifyDatabaseName()).toBe("tagify-db:account-a");
    expect(await indexedDBStorage.getAllSmartPlaylists()).toMatchObject([
      { id: "five-stars", playlistId: smartPlaylist.playlistId, criteria: { ratingFilters: [5] } },
    ]);
  });

  it("keeps local-only rule edits when the same account reconnects", async () => {
    await connect();
    await syncPairingService.unlinkLocal();
    expect(getTagifyDatabaseName()).toBe("tagify-db");
    expect(await indexedDBStorage.saveSmartPlaylists([{
      ...smartPlaylist,
      criteria: { ...smartPlaylist.criteria, ratingFilters: [4, 5] },
      updatedAt: 2,
    }])).toBe(true);

    await connect();

    expect(await indexedDBStorage.getAllSmartPlaylists()).toMatchObject([
      { id: "five-stars", criteria: { ratingFilters: [4, 5] } },
    ]);
  });

  it("does not erase the account rule when the disconnected copy is unexpectedly empty", async () => {
    await connect();
    await syncPairingService.unlinkLocal();
    expect(await indexedDBStorage.saveSmartPlaylists([])).toBe(true);

    await connect();

    expect(await indexedDBStorage.getAllSmartPlaylists()).toMatchObject([
      { id: "five-stars", playlistId: smartPlaylist.playlistId },
    ]);
  });
});
