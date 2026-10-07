import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
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
    saveTracks: vi.fn(),
    loadAllStrict: vi.fn(),
  },
  spotifyApi: {
    getAllTrackUrisInPlaylistStrict: vi.fn(),
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
      mocks.indexed.playlists = playlists;
      return true;
    });
    mocks.storage.isReady.mockReturnValue(true);
    mocks.storage.getTracks.mockResolvedValue(new Map());
    mocks.storage.saveTracks.mockResolvedValue(true);
    mocks.storage.loadAllStrict.mockResolvedValue({
      schemaVersion: 1,
      taxonomy: {},
      tracks: {},
      playlists: {},
      artists: {},
    });
    mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mockResolvedValue([]);
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

    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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

    const savedTracks = mocks.storage.saveTracks.mock.calls[0][0] as Map<
      string,
      TrackData
    >;
    expect(savedTracks.get("spotify:track:member")).toMatchObject({
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

    const savedTracks = mocks.storage.saveTracks.mock.calls[0][0] as Map<
      string,
      TrackData
    >;
    expect(savedTracks.get("spotify:track:member")?.rating).toBe(2);
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

    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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

    const savedTracks = mocks.storage.saveTracks.mock.calls[0][0] as Map<
      string,
      TrackData
    >;
    expect(savedTracks.get("spotify:track:new")).toMatchObject({
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

    const savedTracks = mocks.storage.saveTracks.mock.calls[0][0] as Map<
      string,
      TrackData
    >;
    expect(savedTracks.get("spotify:track:new")).toMatchObject({
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

    const savedTracks = mocks.storage.saveTracks.mock.calls[0][0] as Map<
      string,
      TrackData
    >;
    expect(savedTracks.get("spotify:local:Artist:Album:Track:180")).toMatchObject({
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

    const savedTracks = mocks.storage.saveTracks.mock.calls[0][0] as Map<
      string,
      TrackData
    >;
    expect(savedTracks.get("spotify:track:unavailable")).toMatchObject({
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
    mocks.storage.saveTracks.mockResolvedValue(false);
    const service = new SmartPlaylistSyncService();

    await expect(service.reconcileAll()).rejects.toThrow(
      "Failed to persist smart-playlist track criteria",
    );

    expect(mocks.indexed.playlists[0].smartPlaylistTrackUris).toEqual([
      "spotify:track:existing",
    ]);
  });

  it("does not advance membership when final Spotify confirmation fails", async () => {
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
      "spotify:track:existing",
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
      expect(mocks.storage.saveTracks).toHaveBeenCalled();

      const callsAfterImmediateAdd =
        mocks.spotifyApi.getAllTrackUrisInPlaylistStrict.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
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
    expect(mocks.storage.saveTracks).not.toHaveBeenCalled();
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
      await vi.advanceTimersByTimeAsync(59_999);
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

    it("does not rewrite unchanged playlists, timestamps or broadcast updates", async () => {
      const updated = vi.fn();
      window.addEventListener("tagify:smartPlaylistsUpdated", updated);
      try {
        service.startBackgroundReconciliation();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.spotifyApi.getAllTrackUrisInPlaylistStrict).toHaveBeenCalledTimes(2);
        expect(mocks.indexed.saveSmartPlaylists).not.toHaveBeenCalled();
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
      expect(mocks.storage.saveTracks).toHaveBeenCalled();
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
      expect(mocks.storage.saveTracks).toHaveBeenCalled();
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
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.storage.loadAllStrict).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
    });
  });
});
