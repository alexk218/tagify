import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { useTagData, SmartPlaylistCriteria, TrackData } from "@/hooks/data/useTagData";
import { spotifyApiService } from "@/services/SpotifyApiService";

// Mock the entire SpotifyApiService
vi.mock("../../services/SpotifyApiService", () => ({
  spotifyApiService: {
    addTrackToSpotifyPlaylist: vi.fn(),
    removeTrackFromPlaylist: vi.fn(),
    getAllTrackUrisInPlaylist: vi.fn(),
    fetchBpm: vi.fn(),
    getAudioFeatures: vi.fn(),
    extractTrackId: vi.fn(),
    isTrackInPlaylist: vi.fn(),
    getAllUserPlaylists: vi.fn(),
  },
}));

describe("Smart Playlist Integration Flow", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    // Setup default Spotify API mocks
    vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockResolvedValue({
      success: true,
      wasAdded: true,
    });
    vi.mocked(spotifyApiService.removeTrackFromPlaylist).mockResolvedValue(true);
    vi.mocked(spotifyApiService.getAllTrackUrisInPlaylist).mockResolvedValue([]);
  });

  describe("Complete Smart Playlist Workflow", () => {
    it("should create smart playlist and automatically sync new tracks", async () => {
      const { result } = renderHook(() => useTagData());

      // Step 1: Create a smart playlist with specific criteria
      const smartPlaylistCriteria: SmartPlaylistCriteria = {
        playlistId: "test-smart-playlist",
        playlistName: "Electronic House Mix",
        isActive: true,
        smartPlaylistTrackUris: [],
        lastSyncAt: Date.now(),
        createdAt: Date.now(),
        criteria: {
          activeTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
          excludedTagFilters: [],
          ratingFilters: [4, 5],
          energyMinFilter: 6,
          energyMaxFilter: null,
          bpmMinFilter: 120,
          bpmMaxFilter: 130,
          isOrFilterMode: false,
        },
      };

      // Store the smart playlist
      act(() => {
        result.current.createSmartPlaylist(smartPlaylistCriteria);
      });

      // Verify it's stored in localStorage
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "tagify:smartPlaylists",
        expect.stringContaining("test-smart-playlist")
      );

      // Step 2: Add a track that matches the criteria
      const matchingTrackData: TrackData = {
        rating: 5,
        energy: 8,
        bpm: 125,
        tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      // Sync the track with smart playlists
      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:matching123",
          matchingTrackData
        );
      });

      // Verify the track was added to the playlist
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:track:matching123",
        "test-smart-playlist"
      );

      // Verify the smart playlist state was updated
      const updatedPlaylists = result.current.smartPlaylists;
      expect(updatedPlaylists[0].smartPlaylistTrackUris).toContain("spotify:track:matching123");

      // Step 3: Add a track that doesn't match the criteria
      const nonMatchingTrackData: TrackData = {
        rating: 2, // Below rating filter
        energy: 4, // Below energy filter
        bpm: 90, // Below BPM filter
        tags: [{ categoryId: "genre", subcategoryId: "rock", tagId: "alternative" }],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      // Sync the non-matching track
      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:nonmatching456",
          nonMatchingTrackData
        );
      });

      // Verify the track was NOT added to the playlist
      expect(spotifyApiService.addTrackToSpotifyPlaylist).not.toHaveBeenCalledWith(
        "spotify:track:nonmatching456",
        "test-smart-playlist"
      );

      // Step 4: Update an existing track to no longer match criteria
      const updatedTrackData: TrackData = {
        ...matchingTrackData,
        rating: 1, // Changed to not match rating filter
        tags: [], // Removed tags
      };

      // Sync the updated track
      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:matching123",
          updatedTrackData
        );
      });

      // Verify the track was removed from the playlist
      expect(spotifyApiService.removeTrackFromPlaylist).toHaveBeenCalledWith(
        "spotify:track:matching123",
        "test-smart-playlist"
      );
    });

    it("should handle multiple smart playlists with different criteria", async () => {
      const { result } = renderHook(() => useTagData());

      // Create two smart playlists with different criteria
      const housePlaylist: SmartPlaylistCriteria = {
        playlistId: "house-playlist",
        playlistName: "House Music",
        isActive: true,
        smartPlaylistTrackUris: [],
        lastSyncAt: Date.now(),
        createdAt: Date.now(),
        criteria: {
          activeTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
          excludedTagFilters: [],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      };

      const chillPlaylist: SmartPlaylistCriteria = {
        playlistId: "chill-playlist",
        playlistName: "Chill Vibes",
        isActive: true,
        smartPlaylistTrackUris: [],
        lastSyncAt: Date.now(),
        createdAt: Date.now(),
        criteria: {
          activeTagFilters: [{ categoryId: "mood", subcategoryId: "energy", tagId: "chill" }],
          excludedTagFilters: [],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: 5,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      };

      await act(async () => {
        result.current.createSmartPlaylist(housePlaylist);
        result.current.createSmartPlaylist(chillPlaylist);
      });

      // Add a track that matches both playlists
      const versatileTrackData: TrackData = {
        rating: 4,
        energy: 3,
        bpm: 100,
        tags: [
          { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
          { categoryId: "mood", subcategoryId: "energy", tagId: "chill" },
        ],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:versatile789",
          versatileTrackData
        );
      });

      // Verify the track was added to both playlists
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:track:versatile789",
        "house-playlist"
      );
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:track:versatile789",
        "chill-playlist"
      );
    });

    it("should handle full playlist sync correctly", async () => {
      const { result } = renderHook(() => useTagData());

      // Setup mock data
      const tagData = {
        categories: [],
        tracks: {
          "spotify:track:house1": {
            rating: 5,
            energy: 8,
            bpm: 128,
            tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
            dateCreated: Date.now(),
            dateModified: Date.now(),
          },
          "spotify:track:house2": {
            rating: 4,
            energy: 7,
            bpm: 125,
            tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
            dateCreated: Date.now(),
            dateModified: Date.now(),
          },
          "spotify:track:rock1": {
            rating: 3,
            energy: 6,
            bpm: 120,
            tags: [{ categoryId: "genre", subcategoryId: "rock", tagId: "alternative" }],
            dateCreated: Date.now(),
            dateModified: Date.now(),
          },
        },
      };

      act(() => {
        result.current.setTagData?.(tagData);
      });

      // Mock existing tracks in playlist (including one that shouldn't be there)
      vi.mocked(spotifyApiService.getAllTrackUrisInPlaylist).mockResolvedValue([
        "spotify:track:oldtrack",
        "spotify:track:house1", // This one should stay
      ]);

      const smartPlaylist: SmartPlaylistCriteria = {
        playlistId: "sync-test-playlist",
        playlistName: "House Sync Test",
        isActive: true,
        smartPlaylistTrackUris: [],
        lastSyncAt: Date.now(),
        createdAt: Date.now(),
        criteria: {
          activeTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
          excludedTagFilters: [],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      };

      await act(async () => {
        await result.current.syncSmartPlaylistFull(smartPlaylist);
      });

      // Should add house2 (new matching track)
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:track:house2",
        "sync-test-playlist"
      );

      // Should remove oldtrack (doesn't match criteria)
      expect(spotifyApiService.removeTrackFromPlaylist).toHaveBeenCalledWith(
        "spotify:track:oldtrack",
        "sync-test-playlist"
      );

      // Should NOT add rock1 (doesn't match criteria)
      expect(spotifyApiService.addTrackToSpotifyPlaylist).not.toHaveBeenCalledWith(
        "spotify:track:rock1",
        "sync-test-playlist"
      );

      // Should NOT remove house1 (already in playlist and matches)
      expect(spotifyApiService.removeTrackFromPlaylist).not.toHaveBeenCalledWith(
        "spotify:track:house1",
        "sync-test-playlist"
      );
    });
  });

  describe("Error Handling Integration", () => {
    it("should gracefully handle API failures during sync", async () => {
      const { result } = renderHook(() => useTagData());

      // Mock API failure
      vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockRejectedValue(
        new Error("Spotify API unavailable")
      );

      const smartPlaylist: SmartPlaylistCriteria = {
        playlistId: "error-test-playlist",
        playlistName: "Error Test",
        isActive: true,
        smartPlaylistTrackUris: [],
        lastSyncAt: Date.now(),
        createdAt: Date.now(),
        criteria: {
          activeTagFilters: [],
          excludedTagFilters: [],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      };

      await act(async () => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackData: TrackData = {
        rating: 5,
        energy: 8,
        bpm: 128,
        tags: [],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      // This should not throw an error
      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:errortest", trackData);
      });

      // The smart playlist should still exist in state
      expect(result.current.smartPlaylists).toHaveLength(1);
      expect(result.current.smartPlaylists[0].playlistId).toBe("error-test-playlist");

      // Verify that the API was called despite the error
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:track:errortest",
        "error-test-playlist"
      );
    });

    it("should handle localStorage errors gracefully", () => {
      // Mock localStorage to throw error
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      setItemSpy.mockImplementation(() => {
        throw new Error("localStorage full");
      });

      const { result } = renderHook(() => useTagData());

      const smartPlaylist: SmartPlaylistCriteria = {
        playlistId: "storage-error-test",
        playlistName: "Storage Error Test",
        isActive: true,
        smartPlaylistTrackUris: [],
        lastSyncAt: Date.now(),
        createdAt: Date.now(),
        criteria: {
          activeTagFilters: [],
          excludedTagFilters: [],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      };

      // Should not throw error despite localStorage failure
      expect(() => {
        act(() => {
          result.current.createSmartPlaylist(smartPlaylist);
        });
      }).not.toThrow();

      setItemSpy.mockRestore();
    });
  });

  describe("Complex Criteria Evaluation", () => {
    it("should handle complex multi-criteria evaluation correctly", async () => {
      const { result } = renderHook(() => useTagData());

      const complexPlaylist: SmartPlaylistCriteria = {
        playlistId: "complex-playlist",
        playlistName: "Complex Criteria",
        isActive: true,
        smartPlaylistTrackUris: [],
        lastSyncAt: Date.now(),
        createdAt: Date.now(),
        criteria: {
          activeTagFilters: [
            { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
            { categoryId: "mood", subcategoryId: "energy", tagId: "uplifting" },
          ],
          excludedTagFilters: [
            { categoryId: "genre", subcategoryId: "electronic", tagId: "trance" },
          ],
          ratingFilters: [4, 5],
          energyMinFilter: 6,
          energyMaxFilter: 9,
          bpmMinFilter: 120,
          bpmMaxFilter: 130,
          isOrFilterMode: false, // AND mode
        },
      };

      await act(async () => {
        result.current.createSmartPlaylist(complexPlaylist);
      });

      // Test track that meets ALL criteria
      const perfectMatch: TrackData = {
        rating: 5,
        energy: 7,
        bpm: 125,
        tags: [
          { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
          { categoryId: "mood", subcategoryId: "energy", tagId: "uplifting" },
        ],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:perfect", perfectMatch);
      });

      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:track:perfect",
        "complex-playlist"
      );

      // Test track with excluded tag (should be rejected)
      const excludedTrack: TrackData = {
        rating: 5,
        energy: 7,
        bpm: 125,
        tags: [
          { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
          { categoryId: "genre", subcategoryId: "electronic", tagId: "trance" }, // Excluded!
          { categoryId: "mood", subcategoryId: "energy", tagId: "uplifting" },
        ],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:excluded", excludedTrack);
      });

      expect(spotifyApiService.addTrackToSpotifyPlaylist).not.toHaveBeenCalledWith(
        "spotify:track:excluded",
        "complex-playlist"
      );
    });
  });
});
