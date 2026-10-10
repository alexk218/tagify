import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import {
  SMART_PLAYLIST_SYNC_LOCK,
  SmartPlaylistSyncService,
  type SmartPlaylistSyncLockManager,
} from "@/services/SmartPlaylistSyncService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import { setLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { markConfirmedMembershipBaselines, hasConfirmedMembershipBaseline } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import type { SmartPlaylistCriteria, SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import type { TrackData } from "@/types/tagData";

// Real saved-song storage; only Spotify is simulated. Each scenario reproduces
// a "lag moment": a slow Spotify read or lookup while the user keeps tagging.

const [house, deep, vocal] = Object.keys(defaultTagData.taxonomy.tagsById);
const songX = `spotify:track:${"x".repeat(22)}`;
const songY = `spotify:track:${"y".repeat(22)}`;
const older = [`spotify:track:${"a".repeat(22)}`, `spotify:track:${"b".repeat(22)}`];
const noFilters: SmartPlaylistFilterCriteria = {
  includeTagClauses: [], clauseConnectors: [], ratingFilters: [],
  energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null,
};
const desktopPlatform = Spicetify.Platform as unknown as { PlaylistAPI: { add: (...args: unknown[]) => Promise<unknown> } };

function playlist(criteria: Partial<SmartPlaylistFilterCriteria>, overrides: Partial<SmartPlaylistCriteria> = {}): SmartPlaylistCriteria {
  return {
    id: "smart", playlistId: "spotify-playlist", playlistName: "Late night", criteria: { ...noFilters, ...criteria },
    isActive: true, createdAt: 1, lastSyncAt: 1, smartPlaylistTrackUris: [], ...overrides,
  };
}

function song(overrides: Partial<TrackData> = {}): TrackData {
  return { name: "Song", artists: "Artist", rating: 0, energy: 0, bpm: 120, tagIds: [], dateCreated: 5, dateModified: 10, ...overrides };
}

async function seed(p: SmartPlaylistCriteria, tracks: Record<string, TrackData>, { confirmed = true } = {}) {
  expect(await indexedDBStorage.saveAll({ ...defaultTagData, tracks, smartPlaylists: [p] })).toBe(true);
  if (confirmed) markConfirmedMembershipBaselines([p], new Set([p.playlistId]));
}

async function saved(uri: string): Promise<TrackData | undefined> {
  return (await indexedDBStorage.loadAllStrict()).tracks[uri];
}

async function savedPlaylist(): Promise<SmartPlaylistCriteria> {
  return (await indexedDBStorage.getAllSmartPlaylists())[0];
}

/** Saves an edit the way the Tagify page does: only the fields the user changed. */
async function userEdits(uri: string, change: Partial<TrackData>): Promise<TrackData> {
  const before = await indexedDBStorage.getTrack(uri);
  const edited = { ...(before ?? song()), ...change, dateModified: 50 };
  expect(await indexedDBStorage.saveTracks(new Map([[uri, edited]]), before ? { [uri]: before } : undefined)).toBe(true);
  return (await saved(uri))!;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** A Spotify playlist whose first read waits for `firstRead`, if given. */
function spotifyPlaylist(initial: string[], firstRead?: () => Promise<void>) {
  let members = [...initial];
  let reads = 0;
  const read = vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockImplementation(async () => {
    if (reads++ === 0 && firstRead) await firstRead();
    return [...members];
  });
  const add = vi.spyOn(spotifyApiService, "addTrackToSpotifyPlaylist").mockImplementation(async (uri) => {
    if (members.includes(uri)) return { success: true, wasAdded: false };
    members = [...members, uri];
    return { success: true, wasAdded: true };
  });
  vi.spyOn(spotifyApiService, "removeTrackFromPlaylist").mockImplementation(async (uri) => {
    members = members.filter((member) => member !== uri);
    return true;
  });
  return { members: () => members, read, add };
}

/** Web Locks as Spotify provides them: one holder per name, in request order. */
class SharedLocks implements SmartPlaylistSyncLockManager {
  waiting = 0;
  private tails = new Map<string, Promise<unknown>>();
  request<T>(name: string, _options: { mode: "exclusive"; signal?: AbortSignal }, callback: () => Promise<T>): Promise<T> {
    this.waiting += 1;
    const result = (this.tails.get(name) ?? Promise.resolve()).then(() => {
      this.waiting -= 1;
      return callback();
    });
    this.tails.set(name, result.catch(() => undefined));
    return result;
  }
}

const updateNotices = () => vi.mocked(Spicetify.showNotification).mock.calls
  .map(([message]) => String(message)).filter((message) => message.includes("updated"));

describe("Smart Playlist sync while songs are being tagged", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await indexedDBStorage.init()).toBe(true);
    setLocalPersistencePaused(false);
    vi.spyOn(storageService, "isReady").mockReturnValue(true);
    vi.spyOn(spotifyService, "getTrack").mockResolvedValue({ name: "Spotify title", artists: "Spotify artist" } as never);
    vi.spyOn(spotifyApiService, "fetchAudioFeatures").mockResolvedValue({ bpm: 124, camelotKey: "8A" });
    vi.mocked(Spicetify.showNotification).mockClear();
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("confirms restored membership before the other bundle can sync, without tagging historical songs", async () => {
    const p = playlist({ ratingFilters: [5] });
    const tracks = { [songX]: song({ rating: 2 }) };
    await seed(p, tracks);
    const reading = deferred();
    const finishRead = deferred();
    spotifyPlaylist([songX], async () => { reading.resolve(); await finishRead.promise; });
    const locks = new SharedLocks();
    const page = new SmartPlaylistSyncService(locks);
    const extension = new SmartPlaylistSyncService(locks);
    const restore = page.restoreLibrary(async () => { await indexedDBStorage.saveAll({ ...defaultTagData, tracks, smartPlaylists: [p] }); });
    await reading.promise;
    let otherFinished = false;
    const other = extension.reconcileAll().then(() => { otherFinished = true; });
    await Promise.resolve();
    expect(otherFinished).toBe(false);
    finishRead.resolve();
    expect((await restore).failedPlaylistNames).toEqual([]);
    expect(hasConfirmedMembershipBaseline(await savedPlaylist())).toBe(true);
    await other;
    expect(await saved(songX)).toEqual(tracks[songX]);
  });

  it("keeps failed playlist connections while confirming those Spotify can read", async () => {
    const p = playlist({});
    const other = playlist({}, { id: "other", playlistId: "other", playlistName: "Other", isActive: false });
    await indexedDBStorage.saveAll({ ...defaultTagData, smartPlaylists: [p, other] });
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockImplementation(async (id) => {
      if (id === "other") throw new Error("Spotify unavailable");
      return [songX];
    });
    const result = await new SmartPlaylistSyncService().restoreLibrary(async () => {});
    expect(result.failedPlaylistNames).toEqual(["Other"]);
    const saved = await indexedDBStorage.getAllSmartPlaylists();
    const checked = saved.find((item) => item.id === p.id)!;
    const failed = saved.find((item) => item.id === other.id)!;
    expect(checked.smartPlaylistTrackUris).toEqual([songX]);
    expect(hasConfirmedMembershipBaseline(checked)).toBe(true);
    expect(failed).toMatchObject(other);
    expect(hasConfirmedMembershipBaseline(failed)).toBe(false);
  });

  it("automatically confirms an unchanged restored playlist when Spotify comes back", async () => {
    const p = playlist({ ratingFilters: [5] }, { lastSyncAt: 0, smartPlaylistTrackUris: [songX] });
    await seed(p, { [songX]: song({ rating: 5 }) });
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict")
      .mockRejectedValueOnce(new Error("Offline")).mockResolvedValue([songX]);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const service = new SmartPlaylistSyncService();
    expect((await service.restoreLibrary(async () => {})).failedPlaylistNames).toEqual([p.playlistName]);
    expect(hasConfirmedMembershipBaseline(p)).toBe(false);
    service.startBackgroundReconciliation();
    try {
      await vi.waitFor(async () => {
        const checked = await savedPlaylist();
        expect(checked.lastSyncAt).toBeGreaterThan(0);
        expect(hasConfirmedMembershipBaseline(checked)).toBe(true);
      });
    } finally {
      service.stopBackgroundReconciliation();
    }
  });

  it("does not save a Spotify response after switching accounts", async () => {
    const p = playlist({});
    await seed(p, {});
    const write = vi.spyOn(indexedDBStorage, "saveSmartPlaylists");
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockImplementation(async () => {
      localStorage.setItem("tagify:sync:account-id", "another-account");
      return [songX];
    });
    await expect(new SmartPlaylistSyncService().restoreLibrary(async () => {})).rejects.toThrow("account changed");
    expect(write).not.toHaveBeenCalled();
  });

  it("leaves confirmed membership alone when an import fails before saving", async () => {
    const p = playlist({});
    await seed(p, {});
    await expect(new SmartPlaylistSyncService().restoreLibrary(async () => { throw new Error("Invalid backup"); })).rejects.toThrow("Invalid backup");
    expect(hasConfirmedMembershipBaseline(p)).toBe(true);
    expect(await savedPlaylist()).toMatchObject(p);
  });

  it("keeps tags and a rating added while Spotify is read when a new member receives the playlist's tags", async () => {
    await seed(playlist({ includeTagClauses: [{ tagIds: [house], excludedTagIds: [], operator: "AND" }] }), {
      [songX]: song({ tagIds: [vocal] }),
    });
    spotifyPlaylist([songX], async () => { await userEdits(songX, { tagIds: [vocal, deep], rating: 4 }); });

    const summary = await new SmartPlaylistSyncService().reconcileAll();

    expect(summary.metadataUpdatedCount).toBe(1);
    expect(await saved(songX)).toMatchObject({ tagIds: [vocal, deep, house], rating: 4 });
    expect((await savedPlaylist()).smartPlaylistTrackUris).toEqual([songX]);
  });

  it("looks up a new member before saving and fills only details the user has not entered", async () => {
    await seed(playlist({ includeTagClauses: [{ tagIds: [house], excludedTagIds: [], operator: "AND" }], ratingFilters: [5] }), {});
    spotifyPlaylist([songY]);
    vi.mocked(spotifyService.getTrack).mockImplementation(async () => {
      await userEdits(songY, { name: "My title", artists: "", bpm: null, tagIds: [deep], rating: 3 });
      return { name: "Spotify title", artists: "Spotify artist" } as never;
    });

    await new SmartPlaylistSyncService().reconcileAll();

    expect(await saved(songY)).toMatchObject({
      name: "My title", artists: "Spotify artist", bpm: 124, camelotKey: "8A", tagIds: [deep, house], rating: 5,
    });
  });

  it("does not treat a song the Tagify page just added as one added in Spotify", async () => {
    const p = playlist({ ratingFilters: [5], energyMinFilter: 4 });
    await seed(p, { [songX]: song({ tagIds: [vocal] }) });
    const readStarted = deferred();
    const finishRead = deferred();
    const spotify = spotifyPlaylist([], async () => { readStarted.resolve(); await finishRead.promise; });
    const locks = new SharedLocks();
    const lockRequests = vi.spyOn(locks, "request");
    const extension = new SmartPlaylistSyncService(locks);
    const page = new SmartPlaylistSyncService(locks);

    const extensionPass = extension.reconcileAll();
    await readStarted.promise;
    // The user rates the song in Tagify; the page adds it to the playlist.
    const rated = await userEdits(songX, { rating: 5, energy: 6, tagIds: [vocal, deep] });
    let pageFinished = false;
    const pageSync = page.syncTrack(songX, rated).then(() => { pageFinished = true; });
    await vi.waitFor(() => expect(pageFinished || locks.waiting > 0).toBe(true));
    finishRead.resolve();
    await Promise.all([extensionPass, pageSync]);

    expect(lockRequests).toHaveBeenCalledWith(SMART_PLAYLIST_SYNC_LOCK, { mode: "exclusive", signal: expect.any(AbortSignal) }, expect.any(Function));
    expect(spotify.members()).toEqual([songX]);
    expect((await savedPlaylist()).smartPlaylistTrackUris).toEqual([songX]);
    expect(await saved(songX)).toMatchObject({ rating: 5, energy: 6, tagIds: [vocal, deep], dateModified: 50 });
    expect(updateNotices()).toEqual([]);
  });

  it("compares Spotify with the membership saved after the read, not before it", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, { [songX]: song() });
    const readStarted = deferred();
    const finishRead = deferred();
    const spotify = spotifyPlaylist([], async () => { readStarted.resolve(); await finishRead.promise; });
    // Without a shared lock (older Spotify versions) both copies can overlap.
    const extension = new SmartPlaylistSyncService(undefined);
    const page = new SmartPlaylistSyncService(undefined);

    const extensionPass = extension.reconcileAll();
    await readStarted.promise;
    await page.syncTrack(songX, await userEdits(songX, { rating: 5 }));
    expect(spotify.members()).toEqual([songX]);
    // The user changes their mind before the extension's read finishes.
    await userEdits(songX, { rating: 3 });
    finishRead.resolve();
    await extensionPass;

    expect(await saved(songX)).toMatchObject({ rating: 3 });
    expect(updateNotices()).toEqual([]);
    expect(spotify.members()).toEqual([]);
  });

  it("keeps tags added while a new song's details are looked up for a tag choice", async () => {
    const p = playlist({ includeTagClauses: [{ tagIds: [house, vocal], excludedTagIds: [], operator: "OR" }] }, {
      pendingTagChoices: [songY], smartPlaylistTrackUris: [songY],
    });
    await seed(p, {});
    spotifyPlaylist([songY]);
    vi.mocked(spotifyService.getTrack).mockImplementation(async () => {
      await userEdits(songY, { name: "My title", tagIds: [deep], rating: 4 });
      return { name: "Spotify title", artists: "Spotify artist" } as never;
    });

    await new SmartPlaylistSyncService().resolveTagChoice(p.playlistId, songY, { add: [house], remove: [] });

    expect(await saved(songY)).toMatchObject({ name: "My title", tagIds: [deep, house], rating: 4 });
    expect((await savedPlaylist()).pendingTagChoices).toEqual([]);
  });

  it("changes nothing when the saved library cannot be read", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, { [songX]: song({ tagIds: [vocal] }) });
    const before = await saved(songX);
    const spotify = spotifyPlaylist([songX]);
    vi.spyOn(indexedDBStorage, "loadAllStrict").mockRejectedValueOnce(new Error("read failed"));

    await expect(new SmartPlaylistSyncService().reconcileAll()).rejects.toThrow("read failed");

    expect(spotify.read).not.toHaveBeenCalled();
    expect(spotify.add).not.toHaveBeenCalled();
    expect(await saved(songX)).toEqual(before);
    expect(await savedPlaylist()).toMatchObject({ smartPlaylistTrackUris: [], lastSyncAt: 1 });
    expect(Spicetify.showNotification).not.toHaveBeenCalled();
  });

  it("does not give older playlist songs the criteria after one song is added before the first check", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, { [older[0]]: song({ rating: 2 }), [older[1]]: song({ rating: 2 }) }, { confirmed: false });
    const spotify = spotifyPlaylist(older);
    // Adding a song in Spotify's own menus.
    desktopPlatform.PlaylistAPI = {
      add: async (_playlistUri: unknown, uris: unknown) => {
        for (const uri of uris as string[]) await spotifyApiService.addTrackToSpotifyPlaylist(uri, p.playlistId);
      },
    };
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const service = new SmartPlaylistSyncService();
    service.startBackgroundReconciliation();
    try {
      await desktopPlatform.PlaylistAPI.add("spotify:playlist:spotify-playlist", [songY]);
      await service.syncTracks({});
      expect(await saved(songY)).toMatchObject({ rating: 5 });

      await service.reconcileAll();
    } finally {
      service.stopBackgroundReconciliation();
    }

    expect(await saved(older[0])).toMatchObject({ rating: 2, dateModified: 10 });
    expect(await saved(older[1])).toMatchObject({ rating: 2, dateModified: 10 });
    expect((await savedPlaylist()).smartPlaylistTrackUris).toEqual([...older, songY]);
    expect(spotify.members()).toEqual([...older, songY]);
  });
});
