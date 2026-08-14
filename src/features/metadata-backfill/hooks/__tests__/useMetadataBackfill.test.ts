import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMetadataBackfill } from "@/features/metadata-backfill/hooks/useMetadataBackfill";
import { TagDataStructure } from "@/types/tagData";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";

const { mockStorageService, mockSpotifyService, mockAudioFeaturesService } =
  vi.hoisted(() => ({
    mockStorageService: {
      isReady: vi.fn(),
      initialize: vi.fn(),
      loadAll: vi.fn(),
      saveTracks: vi.fn(),
    },
    mockSpotifyService: {
      getTrack: vi.fn(),
    },
    mockAudioFeaturesService: {
      getAudioFeaturesFromUri: vi.fn(),
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

describe("runMetadataBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockStorageService.isReady.mockReturnValue(true);
    mockStorageService.initialize.mockResolvedValue({ status: "ready" });
    mockStorageService.saveTracks.mockResolvedValue(true);
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

  it("skips tracks that reached max attempts", async () => {
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
});
