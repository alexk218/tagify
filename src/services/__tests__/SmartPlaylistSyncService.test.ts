import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberPlaylistAdditions, readPlaylistAdditionOrigins } from "../SpotifyPlaylistWriteOrigins";
import { SmartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { spotifyLocalPause } from "@/utils/spotifyRequestFailure";
import {
  SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { TrackData } from "@/types/tagData";

const desktopPlatform = Spicetify.Platform as unknown as {
  PlaylistAPI: {
    add: (...args: unknown[]) => Promise<unknown>;
    getContents?: ReturnType<typeof vi.fn>;
  };
};

const mocks = vi.hoisted(() => ({
  storage: {
    isReady: vi.fn(() => true),
    getTracks: vi.fn(),
    getTaxonomy: vi.fn(),
    loadAllStrict: vi.fn(),
  },
  spotifyApi: {
    getAllTrackUrisInPlaylistStrict: vi.fn(),
    getTrackUrisForBackgroundSync: vi.fn(),
    updatePlaylistTracks: vi.fn(),
    removeTrackFromPlaylist: vi.fn(),
    addTrackToSpotifyPlaylist: vi.fn(),
    fetchAudioFeatures: vi.fn(),
  },
  spotify: {
    getTrack: vi.fn(),
  },
  isLocalPersistencePaused: vi.fn(() => false),
  flushLocalPersistence: vi.fn().mockResolvedValue(undefined),
  indexed: {
    playlists: [] as SmartPlaylistCriteria[],
    getAllSmartPlaylists: vi.fn(),
    saveSmartPlaylists: vi.fn(),
    patchTracks: vi.fn(),
    getRecordingGroupTracksStrict: vi.fn(),
    getSmartPlaylistSyncState: vi.fn(),
  },
}));

vi.mock("@/services/storage/StorageService", () => ({
  storageService: mocks.storage,
}));
vi.mock("@/services/storage/IndexedDBStorageService", () => ({
  indexedDBStorage: mocks.indexed,
}));
vi.mock("@/services/SpotifyApiService", () => ({
  spotifyApiService: mocks.spotifyApi,
}));
vi.mock("@/services/SpotifyService", () => ({
  spotifyService: mocks.spotify,
}));
vi.mock("@/services/sync/SyncLocalState", () => ({
  isLocalPersistencePaused: mocks.isLocalPersistencePaused,
  flushLocalPersistence: mocks.flushLocalPersistence,
  getTagifyDatabaseName: () => localStorage.getItem("tagify:sync:account-id") ? `tagify-db:${localStorage.getItem("tagify:sync:account-id")}` : "tagify-db",
}));

const criteria = {
  includeTagClauses: [
    { tagIds: ["house"], excludedTagIds: [], operator: "AND" as const },
  ],
  clauseConnectors: [],
  ratingFilters: [5],
  energyMinFilter: 4,
  energyMaxFilter: 8,
  bpmMinFilter: null,
  bpmMaxFilter: null,
};

function playlist(
  overrides: Partial<SmartPlaylistCriteria> = {},
): SmartPlaylistCriteria {
  return {
    playlistId: "playlist-1",
    playlistName: "House",
    criteria,
    isActive: true,
    createdAt: 1,
    lastSyncAt: 1,
    smartPlaylistTrackUris: [],
    ...overrides,
  };
}

function track(overrides: Partial<TrackData> = {}): TrackData {
  return {
    rating: 0,
    energy: 0,
    bpm: 126,
    camelotKey: "8A",
    tagIds: [],
    ...overrides,
  };
}

/** Songs saved by the service, in the order of its saves. */
async function writtenTracks(): Promise<Record<string, TrackData | null>> {
  const results = await Promise.allSettled(
    mocks.indexed.patchTracks.mock.results.map((result) => result.value),
  );
  return Object.assign({}, ...results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
}

function savePlaylists(playlists: SmartPlaylistCriteria[]): void {
  mocks.indexed.playlists = playlists;
}

function confirmMembershipBaseline(...playlists: SmartPlaylistCriteria[]): void {
  localStorage.setItem(
    SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY,
    JSON.stringify(
      playlists.map(({ playlistId, createdAt }) => `${playlistId}:${createdAt}`),
    ),
  );
}

describe("SmartPlaylistSyncService", () => {
  it("reclaims successful addition records only after their membership save succeeds", async () => {
    const p = playlist(); savePlaylists([p]); confirmMembershipBaseline(p);
    const uri = "spotify:track:confirmed-write";
    mocks.spotifyApi.updatePlaylistTracks.mockImplementation(async (id, additions) => {
      rememberPlaylistAdditions(id, additions);
      return { added: additions, removed: [], success: true };
    });
    const data = track({ rating: 5, energy: 6, tagIds: ["house"] });
    const service = new SmartPlaylistSyncService();
    mocks.indexed.saveSmartPlaylists.mockResolvedValueOnce(false);
    await expect(service.syncTrack(uri, data)).rejects.toThrow("Failed to save");
    expect(readPlaylistAdditionOrigins(p.playlistId).uris.has(uri)).toBe(true);
    await service.syncTrack(uri, data);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([uri]);
    expect(readPlaylistAdditionOrigins(p.playlistId).uris.size).toBe(0);
  });


  it("rejects queued work if only the Tagify database changes, then accepts new account work", async () => {
    let release!: () => void;
    const lock = { request: async <T,>(_name: string, _options: unknown, run: () => Promise<T>) => {
      await new Promise<void>(resolve => { release = resolve; }); return run();
    } };
    localStorage.setItem("tagify:sync:account-id", "library-a");
    savePlaylists([playlist()]);
    const service = new SmartPlaylistSyncService(lock);
    const data = track({ rating: 5, energy: 6, tagIds: ["house"] });
    const old = service.syncTrack("spotify:track:old", data);
    await Promise.resolve();
    localStorage.setItem("tagify:sync:account-id", "library-b");
    release();
    await expect(old).rejects.toThrow("Your account changed");
    expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
    const next = service.syncTrack("spotify:track:new", data);
    await Promise.resolve(); release(); await next;
    expect(mocks.spotifyApi.updatePlaylistTracks).toHaveBeenCalledWith("playlist-1", ["spotify:track:new"], [], undefined, expect.any(Object));
  });

  it("stops rather than adding another linked copy when the group read fails", async () => {
    const a = `spotify:track:${"a".repeat(22)}`, b = `spotify:track:${"b".repeat(22)}`;
    savePlaylists([playlist({ smartPlaylistTrackUris: [a] })]);
    mocks.indexed.getRecordingGroupTracksStrict.mockRejectedValueOnce(new Error("The library is busy"));
    await expect(new SmartPlaylistSyncService().syncTrack(b, track({ rating: 5, energy: 6, tagIds: ["house"], recordingGroupId: "same" }))).rejects.toThrow("library is busy");
    expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
    expect(mocks.indexed.saveSmartPlaylists).not.toHaveBeenCalled();
  });


  it("keeps 50k pending choices without repeated scans of playlist membership", async () => {
    const uris = Array.from({ length: 50000 }, (_, i) => `spotify:track:${String(i).padStart(22, "0")}`);
    const playlists = Array.from({ length: 5 }, (_, i) => playlist({
      playlistId: `large-${i}`, smartPlaylistTrackUris: uris.slice(i * 10000, (i + 1) * 10000),
      pendingTagChoices: uris.slice(i * 10000, (i + 1) * 10000),
      criteria: { ...criteria, includeTagClauses: [{ tagIds: ["house", "techno"], excludedTagIds: [], operator: "OR" }] },
    }));
    savePlaylists(playlists); confirmMembershipBaseline(...playlists);
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks: Object.fromEntries(uris.map(uri => [uri, track({ rating: 5, energy: 6 })])) });
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockImplementation(async id => playlists.find(p => p.playlistId === id)!.smartPlaylistTrackUris);
    const original = Array.prototype.includes;
    let largeScans = 0;
    const includes = vi.spyOn(Array.prototype, "includes").mockImplementation(function (this: unknown[], value, start) {
      if (this.length >= 10000 && typeof value === "string" && value.startsWith("spotify:track:")) largeScans++;
      return original.call(this, value, start);
    });
    try { await new SmartPlaylistSyncService().reconcileAll(); }
    finally { includes.mockRestore(); }
    expect(largeScans).toBe(0);
    expect(mocks.indexed.playlists.reduce((n, p) => n + (p.pendingTagChoices?.length ?? 0), 0)).toBe(50000);
    expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
  });

  it("reads only affected recording groups when tagging one song in a 50k library", async () => {
    const tracks: Record<string, TrackData> = {};
    for (let i = 0; i < 50000; i++) tracks[`spotify:track:${String(i).padStart(22, "0")}`] = track({
      rating: 5, energy: 6, tagIds: ["house"], recordingGroupId: `pair-${Math.floor(i / 2)}`,
      recordingIdentity: { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 180000, name: `song-${Math.floor(i / 2)}` },
    });
    const uris = Object.keys(tracks);
    savePlaylists([playlist({ smartPlaylistTrackUris: uris.filter((_, i) => i % 2 === 0) })]);
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks });
    mocks.indexed.getRecordingGroupTracksStrict.mockResolvedValue({ [uris[0]]: tracks[uris[0]], [uris[1]]: tracks[uris[1]] });
    await new SmartPlaylistSyncService().syncTrack(uris[1], tracks[uris[1]]);
    expect(mocks.indexed.getRecordingGroupTracksStrict).toHaveBeenCalledWith(["pair-0"], "tagify-db");
    expect(mocks.storage.loadAllStrict).not.toHaveBeenCalled();
    expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
  });

  it("retains write origins after failed persistence and recovers with a new service instance", async () => {
    const p = playlist(); savePlaylists([p]); confirmMembershipBaseline(p);
    const uri = "spotify:track:late-after-restart";
    rememberPlaylistAdditions(p.playlistId, [uri]);
    const tracks = { [uri]: track({ rating: 1, energy: 7, tagIds: ["newer"], dateModified: 99 }) };
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks });
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([uri]);
    mocks.spotifyApi.updatePlaylistTracks.mockResolvedValue({ added: [], removed: [], success: false });
    mocks.indexed.saveSmartPlaylists.mockResolvedValueOnce(false);
    await expect(new SmartPlaylistSyncService().reconcilePlaylist(p.playlistId)).rejects.toThrow();
    expect(readPlaylistAdditionOrigins(p.playlistId).uris.has(uri)).toBe(true);
    mocks.spotifyApi.updatePlaylistTracks.mockResolvedValue({ added: [], removed: [uri], success: true });
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValueOnce([uri]).mockResolvedValue([]);
    await new SmartPlaylistSyncService().reconcilePlaylist(p.playlistId);
    expect(tracks[uri]).toMatchObject({ rating: 1, energy: 7, tagIds: ["newer"], dateModified: 99 });
    expect(mocks.indexed.patchTracks).not.toHaveBeenCalled();
    expect(readPlaylistAdditionOrigins(p.playlistId).uris.size).toBe(0);
  });

  it("stops an active pass before saving inbound edits after an account switch", async () => {
    const previous = Spicetify.Platform.username;
    Spicetify.Platform.username = "before";
    const p = playlist(); savePlaylists([p]); confirmMembershipBaseline(p);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockImplementation(async () => {
      Spicetify.Platform.username = "after";
      return ["spotify:track:other-account"];
    });
    try {
      await new SmartPlaylistSyncService().reconcilePlaylist(p.playlistId);
      expect(mocks.indexed.patchTracks).not.toHaveBeenCalled();
      expect(mocks.indexed.saveSmartPlaylists).not.toHaveBeenCalled();
      expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
    } finally { Spicetify.Platform.username = previous; }
  });

  it('does not interpret a late Tagify write as a new Spotify edit after Undo', async () => {
    vi.useFakeTimers();
    const { spotifyApiService: realApi } = await vi.importActual<typeof import('../SpotifyApiService')>('../SpotifyApiService');
    const p = playlist(); savePlaylists([p]); confirmMembershipBaseline(p);
    const uri = 'spotify:track:late';
    const tracks = { [uri]: track({ rating: 5, energy: 6, tagIds: ['house'] }) };
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks });
    const previousApi = { ...Spicetify.Platform.PlaylistAPI };
    let remote: string[] = [], finish!: () => void;
    const api = Spicetify.Platform.PlaylistAPI as any;
    api.getContents = vi.fn(async () => ({ items: remote.map(uri => ({ uri, uid: uri })) }));
    api.add = vi.fn((_playlist, batch: string[]) => new Promise<void>(resolve => { finish = () => { remote.push(...batch); resolve(); }; }));
    mocks.spotifyApi.updatePlaylistTracks.mockImplementation(realApi.updatePlaylistTracks);
    api.remove = vi.fn(async (_id, items: { uri: string }[]) => { const removing = new Set(items.map(item => item.uri)); remote = remote.filter(uri => !removing.has(uri)); });
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockImplementation(realApi.getAllTrackUrisInPlaylistStrict);
    const service = new SmartPlaylistSyncService();
    delete api.__tagifySmartPlaylistAddHook;
    (service as any).installDesktopAddHook();
    try {
      const adding = service.syncTrack(uri, tracks[uri]);
      await vi.advanceTimersByTimeAsync(10_001); await adding;
      tracks[uri] = { ...tracks[uri], rating: 1 };
      await service.syncTrack(uri, tracks[uri]);
      finish(); await vi.advanceTimersByTimeAsync(0);
      await service.reconcilePlaylist(p.playlistId);
      expect(tracks[uri].rating).toBe(1);
      expect(remote).toEqual([]);
      expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([]);
    } finally { delete api.__tagifySmartPlaylistAddHook; Object.assign(api, previousApi); vi.useRealTimers(); }
  });

  it('does not baseline a song first seen during final confirmation without applying its criteria', async () => {
    const p = playlist(); savePlaylists([p]); confirmMembershipBaseline(p);
    const tracks: Record<string, TrackData> = { 'spotify:track:local': track({ rating: 5, energy: 6, tagIds: ['house'] }) };
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks });
    let remote: string[] = [];
    mocks.spotifyApi.updatePlaylistTracks.mockImplementation(async (_id, added, removed) => {
      remote = [...remote.filter(uri => !removed.includes(uri)), ...added];
      return { success: true, added, removed };
    });
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValueOnce([]).mockImplementationOnce(async () => {
      remote.push('spotify:track:mobile'); return [...remote];
    }).mockImplementation(async () => [...remote]);
    const service = new SmartPlaylistSyncService();
    await service.reconcilePlaylist(p.playlistId);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual(['spotify:track:local']);
    await service.reconcilePlaylist(p.playlistId);
    expect(tracks['spotify:track:mobile']?.rating).toBe(5);
    expect(remote).toContain('spotify:track:mobile');
  });

  it('does not apply an old account edit after it waited for the sync lock', async () => {
    const previous = Spicetify.Platform.username;
    let release!: () => void;
    const lock = { request: async <T,>(_name: string, _options: unknown, run: () => Promise<T>) => { await new Promise<void>(resolve => { release = resolve; }); return run(); } };
    Spicetify.Platform.username = 'account-a';
    savePlaylists([playlist({ playlistId: 'account-a-playlist' })]);
    const service = new SmartPlaylistSyncService(lock);
    const task = service.syncTrack('spotify:track:account-a-edit', track({ rating: 5, energy: 6, tagIds: ['house'] }));
    await Promise.resolve();
    Spicetify.Platform.username = 'account-b';
    savePlaylists([playlist({ playlistId: 'account-b-playlist' })]);
    try {
      release(); await expect(task).rejects.toThrow('Your account changed');
      expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
    } finally { Spicetify.Platform.username = previous; }
  });

  it("does not add another confirmed release when a matching copy is already a member", async () => {
    const a = `spotify:track:${"a".repeat(22)}`, b = `spotify:track:${"b".repeat(22)}`;
    const recordingIdentity = { isrc: "USABC2400001", artistIds: ["c".repeat(22)], durationMs: 180000, name: "Song" };
    const data = track({ rating: 5, energy: 6, tagIds: ["house"], recordingGroupId: "same", recordingIdentity });
    savePlaylists([playlist({ smartPlaylistTrackUris: [a] })]);
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks: { [a]: data, [b]: data } });
    await new SmartPlaylistSyncService().syncTracks({ [a]: data, [b]: data });
    expect(mocks.spotifyApi.addTrackToSpotifyPlaylist).not.toHaveBeenCalled();
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([a]);
  });

  it("adds one confirmed copy when a linked batch starts with no playlist members", async () => {
    const a = `spotify:track:${"a".repeat(22)}`, b = `spotify:track:${"b".repeat(22)}`;
    const recordingIdentity = { isrc: "USABC2400001", artistIds: ["c".repeat(22)], durationMs: 180000, name: "Song" };
    const data = track({ rating: 5, energy: 6, tagIds: ["house"], recordingGroupId: "same", recordingIdentity });
    savePlaylists([playlist()]);
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks: { [a]: data, [b]: data } });
    await new SmartPlaylistSyncService().syncTracks({ [a]: data, [b]: data });
    expect(mocks.spotifyApi.addTrackToSpotifyPlaylist).toHaveBeenCalledTimes(1);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([a]);
  });

  it("keeps failed additions out of membership and explains that local edits are saved", async () => {
    const service = new SmartPlaylistSyncService();
    savePlaylists([playlist()]);
    mocks.spotifyApi.addTrackToSpotifyPlaylist.mockResolvedValue({ success: false, wasAdded: false });
    const updated = track({ rating: 5, energy: 6, tagIds: ["house"] });
    await service.syncTrack("spotify:track:playing", updated);
    await service.syncTrack("spotify:track:playing", updated);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([]);
    expect(Spicetify.showNotification).toHaveBeenCalledTimes(1);
    expect(Spicetify.showNotification).toHaveBeenCalledWith("Your changes are saved. Smart Playlists will update when Spotify is available.");
    expect(updated.rating).toBe(5);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.indexed.playlists = [];
    mocks.indexed.getAllSmartPlaylists.mockImplementation(async () => mocks.indexed.playlists);
    mocks.indexed.saveSmartPlaylists.mockImplementation(async (playlists) => {
      mocks.indexed.playlists = typeof playlists === "function" ? playlists(mocks.indexed.playlists) : playlists;
      return true;
    });
    mocks.indexed.getRecordingGroupTracksStrict.mockImplementation(async (groups: string[]) => {
      const { tracks } = await mocks.storage.loadAllStrict();
      return Object.fromEntries(Object.entries(tracks as Record<string, TrackData>).filter(([, data]) => groups.includes(data.recordingGroupId ?? "")));
    });
    mocks.indexed.getSmartPlaylistSyncState.mockImplementation(async () => ({
      tracks: (await mocks.storage.loadAllStrict.getMockImplementation()?.())?.tracks ?? {}, playlists: mocks.indexed.playlists,
    }));
    mocks.storage.isReady.mockReturnValue(true);
    mocks.storage.getTracks.mockResolvedValue(new Map());
    mocks.storage.getTaxonomy.mockResolvedValue({});
    // Changes each song from the saved library, like the real storage.
    mocks.indexed.patchTracks.mockImplementation(async (changes: Record<string, (current: TrackData | null) => TrackData | null | undefined>, options) => {
      options?.smartPlaylists?.prepare(mocks.indexed.playlists);
      const { tracks } = await mocks.storage.loadAllStrict();
      const saved: Record<string, TrackData | null> = {};
      for (const [uri, change] of Object.entries(changes)) {
        const next = change(tracks[uri] ? { ...tracks[uri] } : null);
        if (next === undefined) continue;
        saved[uri] = next;
        if (next) tracks[uri] = next;
        else delete tracks[uri];
      }
      if (options?.smartPlaylists) mocks.indexed.playlists = options.smartPlaylists.update(mocks.indexed.playlists);
      return saved;
    });
    mocks.storage.loadAllStrict.mockResolvedValue({
      schemaVersion: 1,
      taxonomy: {},
      tracks: {},
      playlists: {},
      artists: {},
    });
    // Model batch results using the existing per-song outcome fixtures.
    mocks.spotifyApi.updatePlaylistTracks.mockImplementation(async (id, additions, removals) => {
      const added: string[] = [], removed: string[] = [];
      for (const uri of removals) {
        if (!await mocks.spotifyApi.removeTrackFromPlaylist(uri, id)) return { added, removed, success: false };
        removed.push(uri);
      }
      for (const uri of additions) {
        const result = await mocks.spotifyApi.addTrackToSpotifyPlaylist(uri, id);
        if (!result.success) return { added, removed, success: false };
        if (result.wasAdded) added.push(uri);
      }
      return { added, removed, success: true };
    });
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([]);
    mocks.spotifyApi.getTrackUrisForBackgroundSync.mockImplementation((id, options) => mocks.spotifyApi.getAllTrackUrisInPlaylistStrict(id, 0, options));
    mocks.spotifyApi.removeTrackFromPlaylist.mockResolvedValue(true);
    mocks.spotifyApi.addTrackToSpotifyPlaylist.mockResolvedValue({
      success: true,
      wasAdded: true,
    });
    mocks.spotifyApi.fetchAudioFeatures.mockResolvedValue({
      bpm: 126,
      camelotKey: "8A",
    });
    mocks.spotify.getTrack.mockResolvedValue({
      name: "Track",
      artists: "Artist",
    });
    mocks.isLocalPersistencePaused.mockReturnValue(false);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("does not rewrite an existing member when unrelated metadata changes", async () => {
    savePlaylists([
      playlist({ smartPlaylistTrackUris: ["spotify:track:member"] }),
    ]);
    const service = new SmartPlaylistSyncService();

    await service.syncTrack("spotify:track:member", track());

    expect(await writtenTracks()).toEqual({});
    expect(mocks.spotifyApi.removeTrackFromPlaylist).not.toHaveBeenCalled();
  });

  it("removes a member after its tags stop matching the smart playlist", async () => {
    const activePlaylist = playlist({ smartPlaylistTrackUris: ["spotify:track:member"] });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    const service = new SmartPlaylistSyncService();

    await service.syncTrack("spotify:track:member", track({ rating: 5, energy: 6 }));

    expect(mocks.spotifyApi.removeTrackFromPlaylist).toHaveBeenCalledWith(
      "spotify:track:member",
      "playlist-1",
    );
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([]);
  });

  it("keeps membership when Spotify refuses a removal, so the next sync can retry", async () => {
    const activePlaylist = playlist({ smartPlaylistTrackUris: ["spotify:track:member"] });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.removeTrackFromPlaylist.mockResolvedValue(false);
    const service = new SmartPlaylistSyncService();

    await service.syncTrack("spotify:track:member", track({ rating: 5, energy: 6 }));

    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual(["spotify:track:member"]);
  });

  it("does not remove from Spotify until its membership has been confirmed", async () => {
    savePlaylists([playlist({ smartPlaylistTrackUris: ["spotify:track:member"] })]);
    const service = new SmartPlaylistSyncService();

    await service.syncTrack("spotify:track:member", track({ rating: 5, energy: 6 }));

    expect(mocks.spotifyApi.removeTrackFromPlaylist).not.toHaveBeenCalled();
  });

  it("removes an ineligible member during a full reconciliation after an offline tag change", async () => {
    const activePlaylist = playlist({ smartPlaylistTrackUris: ["spotify:track:member"] });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict
      .mockResolvedValueOnce(["spotify:track:member"])
      .mockResolvedValueOnce([]);
    mocks.storage.loadAllStrict.mockResolvedValue({
      schemaVersion: 1,
      taxonomy: {},
      tracks: { "spotify:track:member": track({ rating: 5, energy: 6 }) },
      playlists: {},
      artists: {},
    });
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcileAll();

    expect(summary.removedCount).toBe(1);
    expect(mocks.spotifyApi.removeTrackFromPlaylist).toHaveBeenCalledWith("spotify:track:member", "playlist-1");
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([]);
  });

  it.each([
    "spotify:track:member",
    "spotify:local:Artist:Album:Track:180",
  ])("removes %s when its saved rating disappears between reconciliations", async (trackUri) => {
    const keptUri = "spotify:track:still-rated";
    const activePlaylist = playlist({
      smartPlaylistTrackUris: [trackUri, keptUri],
      criteria: { ...criteria, includeTagClauses: [], energyMinFilter: null, energyMaxFilter: null },
    });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    const savedTrack = track({ rating: 5, dateCreated: 10, dateModified: 20 });
    const keptTrack = track({ rating: 5, dateCreated: 30, dateModified: 40 });
    const data = {
      taxonomy: {},
      tracks: { [trackUri]: savedTrack, [keptUri]: keptTrack },
      playlists: {},
      artists: {},
    };
    let spotifyMembers = [trackUri, keptUri];
    mocks.storage.loadAllStrict.mockImplementation(async () => data);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockImplementation(async () => [...spotifyMembers]);
    mocks.spotifyApi.removeTrackFromPlaylist.mockImplementation(async (uri) => {
      spotifyMembers = spotifyMembers.filter((member) => member !== uri);
      return true;
    });
    const service = new SmartPlaylistSyncService();

    await service.reconcileAll();
    expect(spotifyMembers).toEqual([trackUri, keptUri]);
    expect(data.tracks[trackUri]).toMatchObject({ rating: 5, dateCreated: 10, dateModified: 20 });

    delete data.tracks[trackUri];
    const summary = await service.reconcileAll();

    expect(summary.removedCount).toBe(1);
    expect(spotifyMembers).toEqual([keptUri]);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([keptUri]);
    expect(data.tracks[keptUri]).toMatchObject({ rating: 5, dateCreated: 30, dateModified: 40 });
    expect(await writtenTracks()).toEqual({});
    expect(mocks.spotifyApi.addTrackToSpotifyPlaylist).not.toHaveBeenCalled();
    expect(Spicetify.showNotification).toHaveBeenCalledWith(
      "“House” removed 1 song with no saved Tagify details. If this was unexpected, restore your tags and ratings from a backup.",
      false,
      10000,
    );
  });

  it("retries removal of an unrated member after Spotify rejects it", async () => {
    const trackUri = "spotify:track:member";
    const activePlaylist = playlist({ smartPlaylistTrackUris: [trackUri] });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([trackUri]);
    mocks.spotifyApi.removeTrackFromPlaylist.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const service = new SmartPlaylistSyncService();

    const failed = await service.reconcileAll();
    expect(failed.failedPlaylistNames).toEqual(["House"]);
    expect(failed.removedCount).toBe(0);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([trackUri]);
    expect(Spicetify.showNotification).not.toHaveBeenCalled();

    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict
      .mockResolvedValueOnce([trackUri]).mockResolvedValueOnce([]);
    const retried = await service.reconcileAll();
    expect(retried.failedPlaylistNames).toEqual([]);
    expect(retried.removedCount).toBe(1);
    expect(mocks.spotifyApi.removeTrackFromPlaylist).toHaveBeenCalledTimes(2);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([]);
    expect(await writtenTracks()).toEqual({});
    expect(Spicetify.showNotification).toHaveBeenCalledTimes(1);
  });

  it.each([track({ rating: 4 }), null])("honors a lowered or cleared rating without reapplying five stars: %j", async (updated) => {
    const trackUri = "spotify:track:member";
    const activePlaylist = playlist({
      smartPlaylistTrackUris: [trackUri],
      criteria: { ...criteria, includeTagClauses: [], energyMinFilter: null, energyMaxFilter: null },
    });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    const service = new SmartPlaylistSyncService();

    await service.syncTrack(trackUri, updated);

    expect(mocks.spotifyApi.removeTrackFromPlaylist).toHaveBeenCalledWith(trackUri, "playlist-1");
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([]);
    expect(await writtenTracks()).toEqual({});
    expect(mocks.spotifyApi.addTrackToSpotifyPlaylist).not.toHaveBeenCalled();
  });

  it("applies simultaneous new additions oldest-to-newest", async () => {
    const older = playlist({
      playlistId: "older",
      createdAt: 1,
      smartPlaylistTrackUris: [],
    });
    const newer = playlist({
      playlistId: "newer",
      createdAt: 2,
      smartPlaylistTrackUris: [],
      criteria: {
        ...criteria,
        includeTagClauses: [
          {
            tagIds: ["techno"],
            excludedTagIds: ["house"],
            operator: "AND",
          },
        ],
        ratingFilters: [3],
      },
    });
    savePlaylists([older, newer]);
    confirmMembershipBaseline(older, newer);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:track:member",
    ]);
    const service = new SmartPlaylistSyncService();

    await service.reconcileAll();

    const savedTracks = await writtenTracks();
    expect(savedTracks["spotify:track:member"]).toMatchObject({
      rating: 3,
      tagIds: ["techno"],
    });
  });

  it("uses persisted order to break equal creation-time conflicts", async () => {
    const first = playlist({
      playlistId: "first",
      createdAt: 10,
      smartPlaylistTrackUris: [],
    });
    const second = playlist({
      playlistId: "second",
      createdAt: 10,
      smartPlaylistTrackUris: [],
      criteria: { ...criteria, ratingFilters: [2] },
    });
    savePlaylists([first, second]);
    confirmMembershipBaseline(first, second);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:track:member",
    ]);
    const service = new SmartPlaylistSyncService();

    await service.reconcileAll();

    const savedTracks = await writtenTracks();
    expect(savedTracks["spotify:track:member"]?.rating).toBe(2);
  });

  it("does not persist when new-addition criteria resolve to the original values", async () => {
    const older = playlist({
      playlistId: "older",
      smartPlaylistTrackUris: ["spotify:track:member"],
      criteria: { ...criteria, ratingFilters: [] },
    });
    const newer = playlist({
      playlistId: "newer",
      createdAt: 2,
      smartPlaylistTrackUris: [],
      criteria: {
        ...criteria,
        includeTagClauses: [],
        ratingFilters: [],
        energyMinFilter: null,
        energyMaxFilter: null,
      },
    });
    savePlaylists([older, newer]);
    confirmMembershipBaseline(older, newer);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:track:member",
    ]);
    mocks.storage.getTracks.mockResolvedValue(
      new Map([["spotify:track:member", track({ energy: 4 })]]),
    );
    mocks.storage.loadAllStrict.mockResolvedValue({
      schemaVersion: 1,
      taxonomy: {},
      tracks: {
        "spotify:track:member": track({ energy: 4 }),
      },
      playlists: {},
      artists: {},
    });
    const service = new SmartPlaylistSyncService();

    await service.reconcileAll();

    expect(await writtenTracks()).toEqual({});
  });

  it("continues adding matching local tracks outbound", async () => {
    savePlaylists([playlist()]);
    const service = new SmartPlaylistSyncService();
    const matching = track({ rating: 5, energy: 6, tagIds: ["house"] });

    await service.syncTrack("spotify:track:matching", matching);

    expect(mocks.spotifyApi.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
      "spotify:track:matching",
      "playlist-1",
    );
    const persisted = mocks.indexed.playlists;
    expect(persisted[0].smartPlaylistTrackUris).toEqual([
      "spotify:track:matching",
    ]);
  });

  it("uses the first confirmed membership as a baseline without backfilling it", async () => {
    savePlaylists([playlist()]);
    const member = track();
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:track:member",
    ]);
    mocks.storage.getTracks.mockResolvedValue(
      new Map([["spotify:track:member", member]]),
    );
    mocks.storage.loadAllStrict.mockResolvedValue({
      schemaVersion: 1,
      taxonomy: {},
      tracks: { "spotify:track:member": member },
      playlists: {},
      artists: {},
    });
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcileAll();

    expect(summary.metadataUpdatedCount).toBe(0);
    expect(await writtenTracks()).toEqual({});
    expect(mocks.spotifyApi.removeTrackFromPlaylist).not.toHaveBeenCalled();
    const persisted = mocks.indexed.playlists;
    expect(persisted[0].smartPlaylistTrackUris).toEqual([
      "spotify:track:member",
    ]);
    expect(
      JSON.parse(
        localStorage.getItem(SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY)!,
      ),
    ).toEqual(["playlist-1:1"]);
  });

  it("does not create annotations for unknown tracks in the initial membership snapshot", async () => {
    savePlaylists([playlist()]);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:local:::historical-file:123",
      "spotify:track:historical",
    ]);
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcileAll();

    expect(summary.metadataUpdatedCount).toBe(0);
    expect(await writtenTracks()).toEqual({});
    expect(mocks.spotify.getTrack).not.toHaveBeenCalled();
    expect(mocks.spotifyApi.removeTrackFromPlaylist).not.toHaveBeenCalled();

    // Once the initial contents are confirmed, unknown members must not stay
    // indefinitely or be mistaken for newly added tracks that need ratings.
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict
      .mockResolvedValueOnce(["spotify:local:::historical-file:123", "spotify:track:historical"])
      .mockResolvedValueOnce([]);
    const next = await service.reconcileAll();
    expect(next.removedCount).toBe(2);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([]);
    expect(await writtenTracks()).toEqual({});
    expect(Spicetify.showNotification).toHaveBeenCalledWith(
      "“House” removed 2 songs with no saved Tagify details. If this was unexpected, restore your tags and ratings from a backup.",
      false,
      10000,
    );
  });

  it("creates mutable metadata for a previously unknown Spotify member", async () => {
    const activePlaylist = playlist();
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:track:new",
    ]);
    const service = new SmartPlaylistSyncService();

    await service.reconcileAll();

    const savedTracks = await writtenTracks();
    expect(savedTracks["spotify:track:new"]).toMatchObject({
      name: "Track",
      artists: "Artist",
      bpm: 126,
      camelotKey: "8A",
      rating: 5,
      energy: 4,
      tagIds: ["house"],
    });
  });

  it("enriches a newly added member without removing it from Spotify", async () => {
    const activePlaylist = playlist({
      smartPlaylistTrackUris: ["spotify:track:existing"],
      criteria: {
        ...criteria,
        includeTagClauses: [
          {
            tagIds: ["house", "vocal"],
            excludedTagIds: ["blocked"],
            operator: "OR",
          },
        ],
        ratingFilters: [3, 5],
      },
    });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:track:existing",
      "spotify:track:new",
    ]);
    mocks.storage.getTracks.mockResolvedValue(
      new Map([
        [
          "spotify:track:new",
          track({
            name: "Clifton Groove",
            artists: "Philou",
            rating: 4,
            energy: 9,
            bpm: 91,
            camelotKey: "4A",
            tagIds: ["unrelated", "blocked"],
            dateCreated: 10,
            dateModified: 20,
          }),
        ],
      ]),
    );
    mocks.storage.loadAllStrict.mockResolvedValue({
      schemaVersion: 1,
      taxonomy: {
        tagsById: {
          house: { id: "house", name: "House", subcategoryId: "genres" },
          vocal: { id: "vocal", name: "Vocal", subcategoryId: "genres" },
          blocked: { id: "blocked", name: "Blocked", subcategoryId: "genres" },
        },
      },
      tracks: {
        "spotify:track:existing": track({ rating: 3, energy: 4, tagIds: ["house"] }),
        "spotify:track:new": track({ name: "Clifton Groove", artists: "Philou", rating: 4, energy: 9, bpm: 91, camelotKey: "4A", tagIds: ["unrelated", "blocked"], dateCreated: 10, dateModified: 20 }),
      },
      playlists: {},
      artists: {},
    });
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcileAll();

    const savedTracks = await writtenTracks();
    expect(savedTracks["spotify:track:new"]).toMatchObject({
      rating: 3,
      energy: 8,
      bpm: 91,
      camelotKey: "4A",
      tagIds: ["unrelated", "blocked"],
      dateCreated: 10,
    });
    expect(mocks.indexed.playlists[0].pendingTagChoices).toEqual(["spotify:track:new"]);
    expect(summary.metadataUpdatedCount).toBe(1);
    expect(Spicetify.showNotification).toHaveBeenCalledWith(
      "“House” updated “Clifton Groove — Philou”: rating 3★; energy 8",
      false,
      10000,
    );
    expect(mocks.spotifyApi.removeTrackFromPlaylist).not.toHaveBeenCalled();
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([
      "spotify:track:existing",
      "spotify:track:new",
    ]);
  });

  it("applies criteria to a newly added local file without requesting Spotify metadata", async () => {
    const activePlaylist = playlist();
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:local:Artist:Album:Track:180",
    ]);
    const service = new SmartPlaylistSyncService();

    await service.reconcileAll();

    const savedTracks = await writtenTracks();
    expect(savedTracks["spotify:local:Artist:Album:Track:180"]).toMatchObject({
      name: "Track",
      artists: "Artist",
      rating: 5,
      energy: 4,
      bpm: null,
      tagIds: ["house"],
    });
    expect(mocks.spotify.getTrack).not.toHaveBeenCalled();
    expect(mocks.spotifyApi.fetchAudioFeatures).not.toHaveBeenCalled();
  });

  it("still applies mutable criteria when Spotify metadata is unavailable", async () => {
    const activePlaylist = playlist();
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:track:unavailable",
    ]);
    mocks.spotify.getTrack.mockRejectedValue(new Error("metadata unavailable"));
    mocks.spotifyApi.fetchAudioFeatures.mockRejectedValue(
      new Error("audio unavailable"),
    );
    const service = new SmartPlaylistSyncService();

    await service.reconcileAll();

    const savedTracks = await writtenTracks();
    expect(savedTracks["spotify:track:unavailable"]).toMatchObject({
      rating: 5,
      energy: 4,
      bpm: null,
      tagIds: ["house"],
    });
  });

  it("ignores disabled smart playlists", async () => {
    savePlaylists([playlist({ isActive: false })]);
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcileAll();

    expect(summary).toEqual({
      addedCount: 0,
      removedCount: 0,
      metadataUpdatedCount: 0,
      duplicatesRemovedCount: 0,
      failedPlaylistNames: [],
    });
    expect(
      mocks.spotifyApi.getAllTrackUrisInPlaylistStrict,
    ).not.toHaveBeenCalled();
    expect(await writtenTracks()).toEqual({});
    expect(Spicetify.showNotification).not.toHaveBeenCalled();
  });

  it("does not advance membership when saving inbound criteria fails", async () => {
    const activePlaylist = playlist({
      smartPlaylistTrackUris: ["spotify:track:existing"],
    });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([
      "spotify:track:existing",
      "spotify:track:new",
    ]);
    mocks.storage.getTracks.mockResolvedValue(
      new Map([["spotify:track:new", track()]]),
    );
    mocks.indexed.patchTracks.mockRejectedValue(new Error("write failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new SmartPlaylistSyncService();

    await expect(service.reconcileAll()).rejects.toThrow(
      "Smart Playlist changes to your songs could not be saved. Please try again.",
    );

    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([
      "spotify:track:existing",
    ]);
  });

  it("records processed inbound membership even when final Spotify confirmation fails", async () => {
    const activePlaylist = playlist({
      smartPlaylistTrackUris: ["spotify:track:existing"],
    });
    savePlaylists([activePlaylist]);
    confirmMembershipBaseline(activePlaylist);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict
      .mockResolvedValueOnce([
        "spotify:track:existing",
        "spotify:track:new",
      ])
      .mockRejectedValueOnce(new Error("confirmation failed"));
    mocks.storage.getTracks.mockResolvedValue(
      new Map([["spotify:track:new", track()]]),
    );
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcileAll();

    expect(summary.failedPlaylistNames).toEqual(["House"]);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([
      "spotify:track:existing", "spotify:track:new",
    ]);
  });

  it("serializes concurrent reconciliation triggers", async () => {
    savePlaylists([playlist()]);
    let activeFetches = 0;
    let maximumActiveFetches = 0;
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockImplementation(
      async () => {
        activeFetches += 1;
        maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
        await Promise.resolve();
        activeFetches -= 1;
        return [];
      },
    );
    const service = new SmartPlaylistSyncService();

    await Promise.all([service.reconcileAll(), service.reconcileAll()]);

    expect(maximumActiveFetches).toBe(1);
  });

  it("skips all reconciliation while cloud recovery pauses persistence", async () => {
    savePlaylists([playlist()]);
    mocks.isLocalPersistencePaused.mockReturnValue(true);
    const service = new SmartPlaylistSyncService();

    await service.reconcileAll();
    await service.syncTrack("spotify:track:member", track());

    expect(
      mocks.spotifyApi.getAllTrackUrisInPlaylistStrict,
    ).not.toHaveBeenCalled();
    expect(await writtenTracks()).toEqual({});
  });

  it("does not advance cached membership after a Spotify fetch failure", async () => {
    savePlaylists([
      playlist({ smartPlaylistTrackUris: ["spotify:track:last-confirmed"] }),
    ]);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockRejectedValue(
      new Error("offline"),
    );
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcileAll();

    expect(summary.failedPlaylistNames).toEqual(["House"]);
    const persisted = mocks.indexed.playlists;
    expect(persisted[0].smartPlaylistTrackUris).toEqual([
      "spotify:track:last-confirmed",
    ]);
  });

  it("reports when Spotify asked Tagify to wait before a manual sync", async () => {
    const p = playlist(); savePlaylists([p]);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockRejectedValue(spotifyLocalPause(120));
    const summary = await new SmartPlaylistSyncService().reconcilePlaylist(p.playlistId);
    expect(summary.failedPlaylistNames).toEqual(["House"]);
    expect(summary.checkFailure).toMatchObject({ kind: "paused" });
    expect((summary.checkFailure as { retryAt: number }).retryAt).toBeGreaterThan(Date.now() + 100_000);
    expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
  });

  it("syncs only the selected playlist when another playlist cannot be read", async () => {
    savePlaylists([
      playlist(),
      playlist({ playlistId: "playlist-2", playlistName: "Other", createdAt: 2 }),
    ]);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockImplementation(
      async (playlistId: string) => {
        if (playlistId === "playlist-2") throw new Error("unavailable");
        return [];
      },
    );
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcilePlaylist("playlist-1");

    expect(summary.failedPlaylistNames).toEqual([]);
    expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).not.toHaveBeenCalledWith("playlist-2");
  });

  it("reports a Spotify write failure instead of calling a playlist synced", async () => {
    savePlaylists([playlist()]);
    mocks.storage.loadAllStrict.mockResolvedValue({
      tracks: { "spotify:track:matching": track({ rating: 5, energy: 5, tagIds: ["house"] }) },
      taxonomy: {},
    });
    mocks.spotifyApi.addTrackToSpotifyPlaylist.mockResolvedValue({
      success: false,
      wasAdded: false,
    });
    const service = new SmartPlaylistSyncService();

    const summary = await service.reconcilePlaylist("playlist-1");

    expect(summary.failedPlaylistNames).toEqual(["House"]);
    expect(summary.addedCount).toBe(0);
  });

  it("does not call a paused or missing manual sync successful", async () => {
    savePlaylists([playlist()]);
    const service = new SmartPlaylistSyncService();
    mocks.isLocalPersistencePaused.mockReturnValue(true);
    await expect(service.reconcilePlaylist("playlist-1")).rejects.toThrow();

    mocks.isLocalPersistencePaused.mockReturnValue(false);
    await expect(service.reconcilePlaylist("missing")).rejects.toThrow();
  });

  it("keeps the desktop hook transparent and retains polling fallback", async () => {
    vi.useFakeTimers();
    try {
      savePlaylists([playlist()]);
      const originalAdd = vi.fn().mockResolvedValue("spotify-result");
      desktopPlatform.PlaylistAPI = {
        add: originalAdd,
        getContents: vi.fn(),
      };
      const service = new SmartPlaylistSyncService();
      service.startBackgroundReconciliation();
      await vi.runAllTicks();

      const result = await desktopPlatform.PlaylistAPI.add(
        "spotify:playlist:playlist-1",
        ["spotify:track:desktop"],
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(result).toBe("spotify-result");
      expect(originalAdd).toHaveBeenCalledTimes(1);
      expect(await writtenTracks()).toHaveProperty(["spotify:track:desktop"]);

      const callsAfterImmediateAdd =
        mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mock.calls.length;
      await vi.advanceTimersByTimeAsync(300_000);
      expect(
        mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mock.calls.length,
      ).toBeGreaterThan(callsAfterImmediateAdd);
      service.stopBackgroundReconciliation();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves desktop PlaylistAPI.add errors and installs the hook only once", async () => {
    const failure = new Error("Spotify rejected the add");
    const originalAdd = vi.fn().mockRejectedValue(failure);
    desktopPlatform.PlaylistAPI = {
      add: originalAdd,
      getContents: vi.fn(),
    };
    const service = new SmartPlaylistSyncService();
    service.startBackgroundReconciliation();
    const wrappedAdd = desktopPlatform.PlaylistAPI.add;
    service.startBackgroundReconciliation();

    await expect(
      wrappedAdd("spotify:playlist:playlist-1", ["spotify:track:desktop"]),
    ).rejects.toBe(failure);

    expect(desktopPlatform.PlaylistAPI.add).toBe(wrappedAdd);
    expect(originalAdd).toHaveBeenCalledTimes(1);
    expect(await writtenTracks()).toEqual({});
    service.stopBackgroundReconciliation();
  });

  describe("idle scheduling", () => {
    let service: SmartPlaylistSyncService;
    let visibility: "visible" | "hidden";

    beforeEach(() => {
      vi.useFakeTimers();
      visibility = "visible";
      vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
      desktopPlatform.PlaylistAPI = { add: vi.fn().mockResolvedValue(undefined) };
      savePlaylists([playlist()]);
      service = new SmartPlaylistSyncService();
    });

    afterEach(() => {
      service.stopBackgroundReconciliation();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const settle = () => vi.advanceTimersByTimeAsync(0);
    const setVisibility = (value: "visible" | "hidden") => {
      visibility = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };

    it("does no polling or storage work while hidden, then checks once on return", async () => {
      visibility = "hidden";
      service.startBackgroundReconciliation();
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.indexed.getAllSmartPlaylists).not.toHaveBeenCalled();
      expect(mocks.storage.loadAllStrict).not.toHaveBeenCalled();
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      setVisibility("visible");
      window.dispatchEvent(new Event("focus"));
      await settle();
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(1);

      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("pauses when Spotify loses focus even if its document stays visible", async () => {
      service.startBackgroundReconciliation();
      await settle();
      vi.mocked(document.hasFocus).mockReturnValue(false);
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      vi.mocked(document.hasFocus).mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));
      await settle();
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(2);
    });

    it("does not queue repeated passes behind a slow Spotify request", async () => {
      let finish!: (uris: string[]) => void;
      mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockReturnValueOnce(
        new Promise<string[]>((resolve) => { finish = resolve; }),
      );
      service.startBackgroundReconciliation();
      await settle();
      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      }
      await vi.advanceTimersByTimeAsync(180_000);
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(1);
      finish([]);
      await settle();
      expect(mocks.storage.loadAllStrict).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(299_999);
      expect(mocks.storage.loadAllStrict).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.storage.loadAllStrict).toHaveBeenCalledTimes(2);
    });

    it("rechecks visibility when a pass was queued behind a manual edit", async () => {
      let finish!: () => void;
      mocks.flushLocalPersistence.mockReturnValueOnce(
        new Promise<void>((resolve) => { finish = resolve; }),
      );
      const editing = service.syncTrack("spotify:track:unmatched", track());
      await settle();
      service.startBackgroundReconciliation();
      setVisibility("hidden");
      finish();
      await editing;
      await settle();
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).not.toHaveBeenCalled();
      expect(mocks.storage.loadAllStrict).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not rewrite already confirmed unchanged playlists, timestamps or broadcast updates", async () => {
      confirmMembershipBaseline(playlist());
      const updated = vi.fn();
      window.addEventListener("tagify:smartPlaylistsUpdated", updated);
      try {
        service.startBackgroundReconciliation();
        await vi.advanceTimersByTimeAsync(300_000);
        expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(2);
        expect(mocks.indexed.playlists[0].lastSyncAt).toBe(1);
        expect(updated).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("tagify:smartPlaylistsUpdated", updated);
      }
    });

    it("still handles manual sync and direct tag edits while hidden", async () => {
      visibility = "hidden";
      service.startBackgroundReconciliation();
      await service.reconcilePlaylist("playlist-1");
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(1);
      expect(mocks.indexed.saveSmartPlaylists).toHaveBeenCalledTimes(1);

      await service.syncTrack("spotify:track:matching", track({ rating: 5, energy: 6, tagIds: ["house"] }));
      expect(mocks.spotifyApi.addTrackToSpotifyPlaylist).toHaveBeenCalledWith("spotify:track:matching", "playlist-1");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps desktop additions immediate while hidden", async () => {
      visibility = "hidden";
      service.startBackgroundReconciliation();
      await desktopPlatform.PlaylistAPI.add("spotify:playlist:playlist-1", ["spotify:track:desktop"]);
      await settle();
      expect(await writtenTracks()).toHaveProperty(["spotify:track:desktop"]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("persists inbound additions on return from the background", async () => {
      confirmMembershipBaseline(playlist());
      visibility = "hidden";
      service.startBackgroundReconciliation();
      mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue(["spotify:track:new"]);
      mocks.storage.getTracks.mockResolvedValue(new Map([["spotify:track:new", track()]]));
      setVisibility("visible");
      await settle();
      expect(await writtenTracks()).toHaveProperty(["spotify:track:new"]);
      expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual(["spotify:track:new"]);
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(2);
    });

    it("does not rearm after stopping with a request in flight", async () => {
      let finish!: (uris: string[]) => void;
      mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockReturnValueOnce(
        new Promise<string[]>((resolve) => { finish = resolve; }),
      );
      service.startBackgroundReconciliation();
      await settle();
      service.stopBackgroundReconciliation();
      finish([]);
      await settle();
      expect(vi.getTimerCount()).toBe(0);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(1);
    });

    it("recovers from a failed pass without building a retry queue", async () => {
      mocks.storage.loadAllStrict.mockRejectedValueOnce(new Error("temporarily unavailable"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      service.startBackgroundReconciliation();
      await settle();
      expect(mocks.storage.loadAllStrict).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(mocks.storage.loadAllStrict).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  it("finishes all inbound songs on explicit sync, including beyond the automatic 50-song budget", async () => {
    const p = playlist(); savePlaylists([p]); confirmMembershipBaseline(p);
    const uris = Array.from({ length: 152 }, (_, i) => `spotify:track:inbound-${i}`);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue(uris);
    const summary = await new SmartPlaylistSyncService().reconcilePlaylist(p.playlistId);
    expect(mocks.spotify.getTrack).toHaveBeenCalledTimes(152);
    expect(summary.metadataUpdatedCount).toBe(152);
    expect(summary.failedPlaylistNames).toEqual([]);
    expect(Object.keys(await writtenTracks())).toHaveLength(152);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual(uris);
  });
  it("shares the background cadence across bundle instances and retains deferred songs for the next pass", async () => {
    vi.useFakeTimers();
    try {
      const p = playlist(); savePlaylists([p]); confirmMembershipBaseline(p);
      const uris = Array.from({ length: 52 }, (_, i) => `spotify:track:automatic-${i}`);
      mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue(uris);
      const page = new SmartPlaylistSyncService(), extension = new SmartPlaylistSyncService();
      await (page as any).reconcileNow(undefined, true);
      expect(Object.keys(await writtenTracks())).toHaveLength(50);
      const reads = mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mock.calls.length;
      await (extension as any).reconcileNow(undefined, true);
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(reads);
      await vi.advanceTimersByTimeAsync(300000);
      await (extension as any).reconcileNow(undefined, true);
      expect(Object.keys(await writtenTracks())).toHaveLength(52);
      expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual(uris);
      expect(mocks.spotify.getTrack).toHaveBeenCalledWith(uris[0], undefined, "background", "smart-playlists");
    } finally { vi.useRealTimers(); }
  });
  it("does not mark incomplete explicit sync successful when Spotify stops metadata work", async () => {
    const p = playlist(); savePlaylists([p]); confirmMembershipBaseline(p);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue(["spotify:track:paused"]);
    mocks.spotify.getTrack.mockRejectedValue({ spotifyRequestStopped: true });
    await expect(new SmartPlaylistSyncService().reconcilePlaylist(p.playlistId)).rejects.toMatchObject({ spotifyRequestStopped: true });
    expect(mocks.indexed.patchTracks).not.toHaveBeenCalled();
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([]);
  });
  it("still evaluates local rule edits against version-confirmed background membership", async () => {
    const uri = "spotify:track:kept";
    const saved = playlist({ smartPlaylistTrackUris: [uri] });
    savePlaylists([saved]); confirmMembershipBaseline(saved);
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks: { [uri]: track({ rating: 5, energy: 6, tagIds: ["house"] }) } });
    mocks.spotifyApi.getTrackUrisForBackgroundSync.mockResolvedValue([uri]);
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([]);
    const service = new SmartPlaylistSyncService();
    await (service as any).reconcileNow(undefined, true);
    expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
    mocks.indexed.playlists[0].criteria = { ...criteria, ratingFilters: [1] };
    (globalThis as any).__tagifySmartPlaylistSchedulesV1.clear();
    await (service as any).reconcileNow(undefined, true);
    expect(mocks.spotifyApi.updatePlaylistTracks).toHaveBeenCalledWith(saved.playlistId, [], [uri], [uri], expect.objectContaining({ priority: "background", feature: "smart-playlists" }));
  });

  it("processes 50,000 linked updates without rescanning growing membership", async () => {
    const count = 50_000, tracks: Record<string, TrackData> = {};
    for (let i = 0; i < count; i++) {
      tracks[`spotify:track:${String(i).padStart(22, "0")}`] = track({ rating: 5, energy: 6, tagIds: ["house"], recordingGroupId: `pair-${Math.floor(i / 2)}`,
        recordingIdentity: { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 180000, name: `song-${Math.floor(i / 2)}` } });
    }
    savePlaylists([playlist()]);
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks });
    mocks.spotifyApi.updatePlaylistTracks.mockImplementation(async (_id, added, removed) => ({ success: true, added, removed }));
    // Count operations, not wall time, so slow CI cannot make this flaky.
    const original = Map.prototype.get;
    let lookups = 0;
    const spy = vi.spyOn(Map.prototype, "get").mockImplementation(function (this: Map<unknown, unknown>, key: unknown) {
      lookups++;
      if (lookups > count * 20) throw new Error("Bulk sync exceeded its linear lookup allowance");
      return original.call(this, key);
    });
    try { await new SmartPlaylistSyncService().syncTracks(tracks); }
    finally { spy.mockRestore(); }
    expect(lookups).toBeLessThan(count * 20);
    expect(mocks.spotifyApi.updatePlaylistTracks).toHaveBeenCalledTimes(1);
    expect(mocks.spotifyApi.updatePlaylistTracks.mock.calls[0][1]).toHaveLength(count / 2);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toHaveLength(count / 2);
  });

  it("does not let an edited nonmatching release suppress a matching addition", async () => {
    const a = `spotify:track:${"a".repeat(22)}`, b = `spotify:track:${"b".repeat(22)}`;
    const identity = { isrc: "USABC2400001", artistIds: ["c".repeat(22)], durationMs: 180000, name: "Song" };
    const data = track({ rating: 5, energy: 6, tagIds: ["house"], recordingGroupId: "same", recordingIdentity: identity });
    const p = playlist({ smartPlaylistTrackUris: [a] }); savePlaylists([p]); confirmMembershipBaseline(p);
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks: { [a]: data, [b]: data } });
    await new SmartPlaylistSyncService().syncTracks({ [a]: { ...data, rating: 1 }, [b]: data });
    expect(mocks.spotifyApi.updatePlaylistTracks).toHaveBeenCalledWith(p.playlistId, [b], [a], undefined, expect.objectContaining({ feature: "smart-playlists" }));
  });

  it("retains a manual sync behind another bundle's healthy minute-long update", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
      return controller.signal;
    });
    let release!: () => void;
    let tail: Promise<unknown> = Promise.resolve();
    const manager = { request<T>(_name: string, options: { signal?: AbortSignal }, run: () => Promise<T>): Promise<T> {
      const turn = tail.then(() => { options.signal?.throwIfAborted(); return run(); });
      tail = turn.catch(() => {});
      return new Promise<T>((resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
        turn.then(resolve, reject);
      });
    } };
    savePlaylists([playlist()]);
    mocks.flushLocalPersistence.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const first = new SmartPlaylistSyncService(manager), second = new SmartPlaylistSyncService(manager);
    try {
      const holding = first.syncTrack("spotify:track:edited", track());
      const done = vi.fn();
      const waiting = second.reconcilePlaylist("playlist-1").then(done);
      await vi.advanceTimersByTimeAsync(73_000);
      expect(done).not.toHaveBeenCalled();
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).not.toHaveBeenCalled();
      release(); await holding; await waiting;
      expect(done).toHaveBeenCalledOnce();
      expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("retains the membership baseline when Spotify changes during a background read, then recovers", async () => {
    const p = playlist({ smartPlaylistTrackUris: ["spotify:track:kept"] });
    savePlaylists([p]); confirmMembershipBaseline(p);
    const originalBaseline = localStorage.getItem(SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY);
    mocks.storage.loadAllStrict.mockResolvedValue({ tracks: { "spotify:track:kept": track({ rating: 5, energy: 6, tagIds: ["house"] }) } });
    mocks.spotifyApi.getTrackUrisForBackgroundSync.mockRejectedValueOnce({ spotifyRequestStopped: true })
      .mockResolvedValueOnce(["spotify:track:kept"]);
    const service = new SmartPlaylistSyncService();
    expect(await (service as any).reconcileNow(undefined, true)).toMatchObject({ failedPlaylistNames: [p.playlistName] });
    expect(mocks.indexed.playlists[0]).toEqual(p);
    expect(localStorage.getItem(SMART_PLAYLIST_MEMBERSHIP_BASELINES_KEY)).toBe(originalBaseline);
    expect(mocks.spotifyApi.updatePlaylistTracks).not.toHaveBeenCalled();
    (globalThis as any).__tagifySmartPlaylistSchedulesV1.clear();
    await (service as any).reconcileNow(undefined, true);
    expect(mocks.spotifyApi.getTrackUrisForBackgroundSync).toHaveBeenCalledTimes(2);
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual(["spotify:track:kept"]);
  });

  it("releases the operation queue after a stopped request so the next manual action succeeds", async () => {
    savePlaylists([playlist()]);
    const service = new SmartPlaylistSyncService();
    mocks.flushLocalPersistence.mockRejectedValueOnce({ spotifyRequestStopped: true });
    const first = service.syncTrack("spotify:track:first", track());
    const stopped = expect(first).rejects.toMatchObject({ spotifyRequestStopped: true });
    const waiting = service.syncTrack("spotify:track:next", track({ rating: 5, energy: 6, tagIds: ["house"] }));
    await stopped; await waiting;
    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual(["spotify:track:next"]);
  });

  it("defers a background lock timeout and tries again on the next scheduled check", async () => {
    vi.useFakeTimers();
    savePlaylists([playlist()]);
    let blocked = true;
    const manager = { async request<T>(_name: string, options: { signal?: AbortSignal }, run: () => Promise<T>): Promise<T> {
      if (blocked && options.signal) throw new DOMException("Timeout", "TimeoutError");
      return run();
    } };
    const request = vi.spyOn(manager, "request");
    const service = new SmartPlaylistSyncService(manager);
    try {
      service.startBackgroundReconciliation();
      await vi.advanceTimersByTimeAsync(0);
      expect(request).toHaveBeenCalledOnce();
      expect(mocks.spotifyApi.getTrackUrisForBackgroundSync).not.toHaveBeenCalled();
      blocked = false;
      await vi.advanceTimersByTimeAsync(300_000);
      expect(request).toHaveBeenCalledTimes(2);
      expect(mocks.spotifyApi.getTrackUrisForBackgroundSync).toHaveBeenCalledOnce();
    } finally { service.stopBackgroundReconciliation(); vi.clearAllTimers(); vi.useRealTimers(); }
  });

});
