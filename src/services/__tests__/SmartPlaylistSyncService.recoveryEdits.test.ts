import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import {
  SmartPlaylistSyncService,
} from "@/services/SmartPlaylistSyncService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import { graphqlRateLimiter } from "@/utils/RateLimiter";
import { updateSmartPlaylistsInStorage, saveSmartPlaylistsToStorage } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { setLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { markConfirmedMembershipBaselines } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import type { SmartPlaylistCriteria, SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import type { TrackData } from "@/types/tagData";

// Real saved-song storage; only Spotify is simulated. Each scenario reproduces
// a "lag moment": a slow Spotify read or lookup while the user keeps tagging.

const songX = `spotify:track:${"x".repeat(22)}`;
const songY = `spotify:track:${"y".repeat(22)}`;
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
  vi.spyOn(spotifyApiService, "updatePlaylistTracks").mockImplementation(async (_id, additions, removals) => {
    const added = additions.filter(uri => !members.includes(uri));
    const removed = removals.filter(uri => members.includes(uri));
    members = [...members.filter(uri => !removed.includes(uri)), ...added];
    return { added, removed, success: true };
  });
  return { members: () => members, read, add };
}

describe("Smart Playlist recovery preserves newer edits", () => {
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
    graphqlRateLimiter.reset();
    indexedDBStorage.resetConnection();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });


  it("does not replay inbound criteria after confirmation fails and the user undoes the rating", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, { [songX]: song({ rating: 2 }) });
    const remote = spotifyPlaylist([songX]);
    remote.read.mockResolvedValueOnce([songX]).mockRejectedValueOnce(new Error("Confirmation offline"));
    const sync = new SmartPlaylistSyncService();
    await sync.reconcileAll();
    expect((await saved(songX))?.rating).toBe(5);
    expect((await savedPlaylist()).smartPlaylistTrackUris).toEqual([songX]);
    await sync.syncTrack(songX, await userEdits(songX, { rating: 2 }));
    await new SmartPlaylistSyncService().reconcileAll();
    expect((await saved(songX))?.rating).toBe(2);
    expect(remote.members()).toEqual([]);
  });

  it("does not apply old criteria after the playlist is disabled during metadata lookup", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, {});
    spotifyPlaylist([songY]);
    vi.mocked(spotifyService.getTrack).mockImplementationOnce(async () => {
      expect(await indexedDBStorage.saveSmartPlaylists([{ ...p, isActive: false }])).toBe(true);
      return { name: "Song", artists: "Artist" } as never;
    });
    await new SmartPlaylistSyncService().reconcileAll();
    expect((await savedPlaylist()).isActive).toBe(false);
    expect((await saved(songY))?.rating ?? 0).toBe(0);
  });

  it("does not remove a freshly edited existing member using a pre-read library snapshot", async () => {
    const p = playlist({ ratingFilters: [5] }, {smartPlaylistTrackUris: [songX]});
    await seed(p, { [songX]: song({ rating: 2 }) });
    const remote = spotifyPlaylist([songX], async () => {await userEdits(songX, {rating: 5});});
    await new SmartPlaylistSyncService().reconcileAll();
    expect((await saved(songX))?.rating).toBe(5);
    expect(remote.members()).toEqual([songX]);
  });

  it("does not block Spotify native add when a recovery record is malformed", async () => {
    const {rememberPlaylistAdditions} = await import("../SpotifyPlaylistWriteOrigins");
    rememberPlaylistAdditions("spotify-playlist", [songX]);
    const key = Array.from({length: localStorage.length},(_,i)=>localStorage.key(i)!).find(key=>key.startsWith("tagify:playlist-additions:"))!;
    localStorage.setItem(key, "broken JSON");
    const original = vi.fn().mockResolvedValue("added");
    desktopPlatform.PlaylistAPI = { add: original };
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const sync = new SmartPlaylistSyncService();
    sync.startBackgroundReconciliation();
    try {
      await expect(desktopPlatform.PlaylistAPI.add("spotify:playlist:spotify-playlist", [songY])).resolves.toBe("added");
      expect(original).toHaveBeenCalledTimes(1);
    } finally {sync.stopBackgroundReconciliation();}
  });

  it("rolls back processed membership with song edits if their transaction fails", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, { [songX]: song({ rating: 2 }) });
    spotifyPlaylist([songX]);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value, key) {
      if (this.name === "tracks" && value.rating === 5) throw new Error("Disk full");
      return put.call(this, value, key);
    });
    await expect(new SmartPlaylistSyncService().reconcileAll()).rejects.toThrow("could not be saved");
    expect((await saved(songX))?.rating).toBe(2);
    expect((await saved(songX))?.dateModified).toBe(10);
    expect((await savedPlaylist()).smartPlaylistTrackUris).toEqual([]);
  });

  it("does not resurrect a song deleted while another inbound song is being looked up", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, { [songX]: song({ rating: 2 }) });
    const remote = spotifyPlaylist([songX, songY]);
    vi.mocked(spotifyService.getTrack).mockImplementationOnce(async () => {
      await indexedDBStorage.deleteTrack(songX);
      return { name: "New song", artists: "Artist" } as never;
    });
    await new SmartPlaylistSyncService().reconcileAll();
    expect(await saved(songX)).toBeUndefined();
    expect(remote.members()).toEqual([songY]);
  });

  it("leaves changed rules for a fresh pass instead of applying the old rating", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, {});
    spotifyPlaylist([songY]);
    vi.mocked(spotifyService.getTrack).mockImplementationOnce(async () => {
      await updateSmartPlaylistsInStorage(current => current.map(item => ({...item, criteria: {...item.criteria, ratingFilters: [3]}})));
      return { name: "Song", artists: "Artist" } as never;
    });
    const service = new SmartPlaylistSyncService();
    await service.reconcileAll();
    expect(await saved(songY)).toBeUndefined();
    await service.reconcileAll();
    expect((await saved(songY))?.rating).toBe(3);
  });

  it("keeps atomic inbound progress when a settings save holds an older membership snapshot", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, { [songX]: song({rating: 2}) });
    const olderSettings = await savedPlaylist();
    const remote = spotifyPlaylist([songX]);
    remote.read.mockResolvedValueOnce([songX]).mockRejectedValueOnce(new Error("Offline"));
    await new SmartPlaylistSyncService().reconcileAll();
    await saveSmartPlaylistsToStorage([{...olderSettings, isActive: false}], true);
    expect(await savedPlaylist()).toMatchObject({isActive: false, smartPlaylistTrackUris: [songX]});
    await userEdits(songX, {rating: 2});
    await updateSmartPlaylistsInStorage(current => current.map(item => ({...item, isActive: true})));
    await new SmartPlaylistSyncService().reconcileAll();
    expect((await saved(songX))?.rating).toBe(2);
    expect(remote.members()).toEqual([]);
  });

  it("merges sync progress with a disable saved after its preliminary read", async () => {
    const p = playlist({ ratingFilters: [5] });
    await seed(p, {});
    const read = indexedDBStorage.getAllSmartPlaylists.bind(indexedDBStorage);
    vi.spyOn(indexedDBStorage, "getAllSmartPlaylists").mockImplementationOnce(async () => {
      const earlier = await read();
      await indexedDBStorage.saveSmartPlaylists([{...earlier[0], isActive: false}]);
      return earlier;
    });
    await updateSmartPlaylistsInStorage(current => current.map(item => ({...item, smartPlaylistTrackUris: [songX]})));
    expect(await savedPlaylist()).toMatchObject({isActive: false, smartPlaylistTrackUris: [songX]});
  });

  it("revalidates each outbound batch and recovers with the latest edits", async () => {
    const p = playlist({ ratingFilters: [5] });
    const uris = Array.from({length: 201}, (_, i) => `spotify:track:${String(i).padStart(22, "0")}`);
    const tracks = Object.fromEntries(uris.map(uri => [uri, song({rating: 5})]));
    await seed(p, tracks);
    const members: string[] = [];
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockImplementation(async () => [...members]);
    const add = vi.fn(async (_id: unknown, batch: unknown) => {
      members.push(...batch as string[]);
      if (members.length === 100) await userEdits(uris[100], {rating: 2});
    });
    desktopPlatform.PlaylistAPI = { add };
    const reads = vi.spyOn(indexedDBStorage, "getSmartPlaylistSyncState");
    const sync = new SmartPlaylistSyncService();
    await sync.syncTracks(tracks);
    expect(members).toEqual(uris.slice(0, 100));
    expect(graphqlRateLimiter.getStats().consecutiveErrors).toBe(0);
    expect(reads.mock.calls.every(([batch]) => !!batch && batch.length <= 100)).toBe(true);
    expect((await savedPlaylist()).smartPlaylistTrackUris).toEqual(members);
    await sync.reconcileAll();
    expect(members).toEqual(uris.filter(uri => uri !== uris[100]));
    expect((await saved(uris[100]))?.rating).toBe(2);
    expect((await saved(uris[0]))?.dateModified).toBe(10);
  });

  it("stops a queued write when the playlist is disabled during its validation read", async () => {
    const p = playlist({ ratingFilters: [5] });
    const track = song({rating: 5});
    await seed(p, {[songX]: track});
    const start = deferred(); const finish = deferred();
    const read = indexedDBStorage.getSmartPlaylistSyncState.bind(indexedDBStorage);
    vi.spyOn(indexedDBStorage, "getSmartPlaylistSyncState").mockImplementationOnce(async (uris, account) => {
      start.resolve(); await finish.promise; return read(uris, account);
    });
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockResolvedValue([]);
    const add = vi.fn().mockResolvedValue(undefined);
    desktopPlatform.PlaylistAPI = {add};
    const updating = new SmartPlaylistSyncService().syncTrack(songX, track);
    await start.promise;
    await updateSmartPlaylistsInStorage(current => current.map(item => ({...item, isActive: false})));
    finish.resolve(); await updating;
    expect(add).not.toHaveBeenCalled();
    expect(await savedPlaylist()).toMatchObject({isActive: false, smartPlaylistTrackUris: []});
    expect((await saved(songX))?.rating).toBe(5);
  });

  it("does not revive an already resolved tag choice from an older settings view", async () => {
    const p = playlist({ ratingFilters: [5] }, {smartPlaylistTrackUris: [songX], pendingTagChoices: []});
    await seed(p, {[songX]: song({rating: 5})});
    await saveSmartPlaylistsToStorage([{...await savedPlaylist(), isActive: false, pendingTagChoices: [songX]}], true);
    expect(await savedPlaylist()).toMatchObject({isActive: false, pendingTagChoices: []});
    expect((await saved(songX))?.dateModified).toBe(10);
  });

});
