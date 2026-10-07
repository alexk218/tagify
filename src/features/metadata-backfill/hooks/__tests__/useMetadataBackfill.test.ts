import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { runMetadataBackfill, useMetadataBackfill } from "@/features/metadata-backfill/hooks/useMetadataBackfill";
import { TagDataStructure } from "@/types/tagData";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";

const {
  mockStorageService,
  mockSpotifyService,
  mockSpotifyApiService,
  mockAudioFeaturesService,
} =
  vi.hoisted(() => ({
    mockStorageService: {
      isReady: vi.fn(),
      initialize: vi.fn(),
      loadAll: vi.fn(),
      saveTracks: vi.fn(),
      savePlaylists: vi.fn(),
      saveArtists: vi.fn(),
    },
    mockSpotifyService: {
      getTrack: vi.fn(),
    },
    mockAudioFeaturesService: {
      getAudioFeaturesFromUri: vi.fn(),
    },
    mockSpotifyApiService: {
      getPlaylistMetadata: vi.fn(),
      getArtistMetadata: vi.fn(),
    },
  }));

vi.mock("@/services/storage", () => ({
  storageService: mockStorageService,
}));

vi.mock("@/services/SpotifyService", () => ({
  spotifyService: mockSpotifyService,
}));

vi.mock("@/services/AudioFeaturesService", () => ({
  audioFeaturesService: mockAudioFeaturesService,
}));

vi.mock("@/services/SpotifyApiService", () => ({
  spotifyApiService: mockSpotifyApiService,
}));

describe("runMetadataBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockStorageService.isReady.mockReturnValue(true);
    mockStorageService.initialize.mockResolvedValue({ status: "ready" });
    mockStorageService.saveTracks.mockResolvedValue(true);
    mockStorageService.savePlaylists.mockResolvedValue(true);
    mockStorageService.saveArtists.mockResolvedValue(true);
  });

  it("repairs placeholder metadata for tagged playlists, albums, and artists", async () => {
    const tagData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {},
      playlists: {
        "spotify:playlist:playlist-1": {
          rating: 0,
          energy: 0,
          tagIds: ["tag_house"],
          name: "Unknown Playlist",
          trackCount: null,
        },
        "spotify:album:album-1": {
          rating: 4,
          energy: 0,
          tagIds: [],
          name: "Unknown Album",
          imageUrl: null,
        },
      },
      artists: {
        "spotify:artist:artist-1": {
          rating: 0,
          energy: 6,
          tagIds: [],
          name: "Unknown Artist",
          imageUrl: null,
        },
      },
    };

    mockStorageService.loadAll.mockResolvedValue(tagData);
    mockSpotifyApiService.getPlaylistMetadata.mockImplementation((uri: string) =>
      Promise.resolve({
        uri,
        name: uri.includes(":album:") ? "Recovered Album" : "Recovered Playlist",
        ownerName: "Recovered Owner",
        imageUrl: "https://example.com/cover.jpg",
        description: null,
        trackCount: 12,
        snapshotId: null,
      }),
    );
    mockSpotifyApiService.getArtistMetadata.mockResolvedValue({
      uri: "spotify:artist:artist-1",
      name: "Recovered Artist",
      imageUrl: "https://example.com/artist.jpg",
      followerCount: 100,
      genres: ["house"],
    });

    await expect(runMetadataBackfill()).resolves.toBe(3);

    expect(mockStorageService.savePlaylists).toHaveBeenCalledTimes(1);
    const savedPlaylists = mockStorageService.savePlaylists.mock.calls[0][0] as Map<
      string,
      TagDataStructure["playlists"][string]
    >;
    expect(savedPlaylists.get("spotify:playlist:playlist-1")?.name).toBe(
      "Recovered Playlist",
    );
    expect(savedPlaylists.get("spotify:album:album-1")?.name).toBe(
      "Recovered Album",
    );

    expect(mockStorageService.saveArtists).toHaveBeenCalledTimes(1);
    const savedArtists = mockStorageService.saveArtists.mock.calls[0][0] as Map<
      string,
      TagDataStructure["artists"][string]
    >;
    expect(savedArtists.get("spotify:artist:artist-1")?.name).toBe(
      "Recovered Artist",
    );
  });

  it("increments attempts when audio features are still missing", async () => {
    const tagData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {
        "spotify:track:abc": {
          rating: 5,
          energy: 4,
          bpm: null,
          camelotKey: null,
          tagIds: ["tag_house"],
          albumUri: "spotify:album:test",
          albumName: "Album",
          albumImageUrl: "https://example.com/cover.jpg",
          name: "Existing Name",
          artists: "Existing Artist",
        },
      },
      playlists: {},
      artists: {},
    };

    mockStorageService.loadAll.mockResolvedValue(tagData);
    mockAudioFeaturesService.getAudioFeaturesFromUri.mockResolvedValue(null);

    const updatedCount = await runMetadataBackfill();

    expect(updatedCount).toBe(1);
    expect(mockSpotifyService.getTrack).not.toHaveBeenCalled();
    expect(mockAudioFeaturesService.getAudioFeaturesFromUri).toHaveBeenCalledWith(
      "spotify:track:abc",
    );
    expect(mockStorageService.saveTracks).toHaveBeenCalledTimes(1);

    const savedTracks = mockStorageService.saveTracks.mock.calls[0][0] as Map<
      string,
      TagDataStructure["tracks"][string]
    >;

    expect(savedTracks.get("spotify:track:abc")?.backfillAttempts).toBe(1);
  });

  it("retries tracks that reached max attempts before the current audio endpoint", async () => {
    const tagData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {
        "spotify:track:max-attempts": {
          rating: 5,
          energy: 4,
          bpm: null,
          camelotKey: null,
          tagIds: ["tag_house"],
          name: "Existing Name",
          artists: "Existing Artist",
          backfillAttempts: 3,
          dateCreated: 100,
          dateModified: 200,
        },
      },
      playlists: {},
      artists: {},
    };

    mockStorageService.loadAll.mockResolvedValue(tagData);
    mockAudioFeaturesService.getAudioFeaturesFromUri.mockResolvedValue({
      bpm: 124,
      key: "G",
      mode: 1,
      camelotKey: "9B",
    });

    const updatedCount = await runMetadataBackfill();

    expect(updatedCount).toBe(1);
    expect(mockAudioFeaturesService.getAudioFeaturesFromUri).toHaveBeenCalledWith(
      "spotify:track:max-attempts",
    );

    const savedTracks = mockStorageService.saveTracks.mock.calls[0][0] as Map<
      string,
      TagDataStructure["tracks"][string]
    >;

    expect(savedTracks.get("spotify:track:max-attempts")).toMatchObject({
      bpm: 124,
      camelotKey: "9B",
      dateCreated: 100,
      dateModified: 200,
    });
    expect(savedTracks.get("spotify:track:max-attempts")?.backfillAttempts).toBeUndefined();
    expect(
      savedTracks.get("spotify:track:max-attempts")?.audioFeaturesBackfillRevision,
    ).toBeUndefined();
  });

  it("skips tracks that reached max attempts with the current audio endpoint", async () => {
    const tagData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {
        "spotify:track:max-current-attempts": {
          rating: 5,
          energy: 4,
          bpm: null,
          camelotKey: null,
          tagIds: ["tag_house"],
          albumUri: "spotify:album:test",
          albumName: "Album",
          albumImageUrl: "https://example.com/cover.jpg",
          name: "Existing Name",
          artists: "Existing Artist",
          backfillAttempts: 3,
          audioFeaturesBackfillRevision: "spotify-client-audio-analysis-v1",
        },
      },
      playlists: {},
      artists: {},
    };

    mockStorageService.loadAll.mockResolvedValue(tagData);

    const updatedCount = await runMetadataBackfill();

    expect(updatedCount).toBe(0);
    expect(mockAudioFeaturesService.getAudioFeaturesFromUri).not.toHaveBeenCalled();
    expect(mockStorageService.saveTracks).not.toHaveBeenCalled();
  });

  it("runs again after a confirmed remote snapshot is applied", async () => {
    const emptyData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {},
      playlists: {},
      artists: {},
    };
    const recoveredData: TagDataStructure = {
      ...emptyData,
      tracks: {
        "spotify:track:restored": {
          rating: 5,
          energy: 4,
          bpm: 124,
          camelotKey: "8A",
          tagIds: ["tag_house"],
        },
      },
    };
    mockStorageService.loadAll
      .mockResolvedValueOnce(emptyData)
      .mockResolvedValue(recoveredData);
    mockSpotifyService.getTrack.mockResolvedValue({
      name: "Recovered Track",
      artists: "Recovered Artist",
    });
    const onComplete = vi.fn();

    renderHook(() => useMetadataBackfill({ enabled: true, onComplete }));
    await waitFor(() => expect(mockStorageService.loadAll).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", {
      detail: { type: "sync", origin: "remote" },
    }));

    await waitFor(() => {
      expect(mockSpotifyService.getTrack).toHaveBeenCalledWith(
        "spotify:track:restored",
      );
      expect(onComplete).toHaveBeenCalled();
    });
  });
  it("limits album recovery to 50 tracks and preserves Last Updated dates", async () => {
    const tracks = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [
      `spotify:track:album-${index}`,
      { name: "Song", artists: "Artist", rating: 4, energy: 5, bpm: 120, camelotKey: "8A", tagIds: [], dateModified: 123, backfillAttempts: 3 },
    ]));
    mockStorageService.loadAll.mockResolvedValue({ schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy: createEmptyTaxonomy(), tracks, playlists: {}, artists: {} });
    mockSpotifyService.getTrack.mockResolvedValue({ name: "Song", artists: "Artist", albumUri: "spotify:album:test", albumName: "Album", albumImageUrl: "https://example.com/cover.jpg" });
    const onProgress = vi.fn();
    await runMetadataBackfill({ batchDelayMs: 0, onProgress });
    expect(mockSpotifyService.getTrack).toHaveBeenCalledTimes(50);
    expect(mockStorageService.saveTracks).toHaveBeenCalledTimes(5);
    for (const [saved] of mockStorageService.saveTracks.mock.calls) {
      for (const track of saved.values()) {
        expect(track.dateModified).toBe(123);
        expect(track.albumUri).toBe("spotify:album:test");
      }
    }
    expect(onProgress).toHaveBeenLastCalledWith({ processed: 50, total: 50, updated: 50, remaining: 70 });
  });

});
