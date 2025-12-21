import { useTagData, SmartPlaylistCriteria, TrackData } from "@/hooks/data/useTagData";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { spotifyApiService } from "@/services/SpotifyApiService";

// Mock the SpotifyApiService
vi.mock("../../services/SpotifyApiService", () => ({
  spotifyApiService: {
    addTrackToSpotifyPlaylist: vi.fn(),
    removeTrackFromPlaylist: vi.fn(),
    getAllTrackUrisInPlaylist: vi.fn(),
    getAllUserPlaylists: vi.fn(),
  },
}));

describe("useTagData - Smart Playlist Logic", () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();
    vi.clearAllMocks();

    // Reset localStorage mock implementations to their defaults
    const localStorageMock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };

    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      writable: true,
    });
  });

  describe("Smart Playlist Cleanup", () => {
    it("should remove smart playlists that no longer exist in Spotify", async () => {
      // Mock the getAllUserPlaylists API call
      vi.mocked(spotifyApiService.getAllUserPlaylists).mockResolvedValue([
        "existing-playlist-1",
        "existing-playlist-2",
        // Note: "deleted-playlist" is NOT in this list
      ]);

      const { result } = renderHook(() => useTagData());

      // Set up initial state with both existing and non-existing playlists
      const initialPlaylists: SmartPlaylistCriteria[] = [
        {
          playlistId: "existing-playlist-1",
          playlistName: "Still Exists",
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
        },
        {
          playlistId: "deleted-playlist",
          playlistName: "Was Deleted",
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
        },
      ];

      // Set up the initial state
      act(() => {
        result.current.setSmartPlaylists(initialPlaylists);
      });

      // Verify we start with 2 playlists
      expect(result.current.smartPlaylists).toHaveLength(2);

      // Run the cleanup
      await act(async () => {
        await result.current.cleanupDeletedSmartPlaylists();
      });

      // Verify the API was called
      expect(spotifyApiService.getAllUserPlaylists).toHaveBeenCalledTimes(1);

      // Verify only the existing playlist remains
      expect(result.current.smartPlaylists).toHaveLength(1);
      expect(result.current.smartPlaylists[0].playlistId).toBe("existing-playlist-1");
      expect(result.current.smartPlaylists[0].playlistName).toBe("Still Exists");

      // Verify localStorage was updated (should be called twice: initial set + cleanup)
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "tagify:smartPlaylists",
        expect.stringContaining("existing-playlist-1")
      );
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "tagify:smartPlaylists",
        expect.not.stringContaining("deleted-playlist")
      );
    });

    it("should handle empty smart playlists list gracefully", async () => {
      vi.mocked(spotifyApiService.getAllUserPlaylists).mockResolvedValue([
        "some-playlist-1",
        "some-playlist-2",
      ]);

      const { result } = renderHook(() => useTagData());

      // Start with no smart playlists
      expect(result.current.smartPlaylists).toHaveLength(0);

      // Run cleanup on empty list
      await act(async () => {
        await result.current.cleanupDeletedSmartPlaylists();
      });

      // Should still be empty and not crash
      expect(result.current.smartPlaylists).toHaveLength(0);
      expect(spotifyApiService.getAllUserPlaylists).toHaveBeenCalledTimes(1);
    });

    it("should handle API errors during cleanup gracefully", async () => {
      // Mock API to throw error
      vi.mocked(spotifyApiService.getAllUserPlaylists).mockRejectedValue(
        new Error("Spotify API unavailable")
      );

      const { result } = renderHook(() => useTagData());

      const initialPlaylists: SmartPlaylistCriteria[] = [
        {
          playlistId: "test-playlist",
          playlistName: "Test Playlist",
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
        },
      ];

      act(() => {
        result.current.setSmartPlaylists(initialPlaylists);
      });

      // Should not throw error despite API failure
      await act(async () => {
        await result.current.cleanupDeletedSmartPlaylists();
      });

      // Playlists should remain unchanged since API failed
      expect(result.current.smartPlaylists).toHaveLength(1);
      expect(result.current.smartPlaylists[0].playlistId).toBe("test-playlist");
    });

    it("should preserve all playlists when all still exist", async () => {
      vi.mocked(spotifyApiService.getAllUserPlaylists).mockResolvedValue([
        "playlist-1",
        "playlist-2",
        "playlist-3",
      ]);

      const { result } = renderHook(() => useTagData());

      const initialPlaylists: SmartPlaylistCriteria[] = [
        {
          playlistId: "playlist-1",
          playlistName: "First Playlist",
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
        },
        {
          playlistId: "playlist-2",
          playlistName: "Second Playlist",
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
        },
      ];

      act(() => {
        result.current.setSmartPlaylists(initialPlaylists);
      });

      await act(async () => {
        await result.current.cleanupDeletedSmartPlaylists();
      });

      // All playlists should remain since they all exist
      expect(result.current.smartPlaylists).toHaveLength(2);
      expect(result.current.smartPlaylists.map((p) => p.playlistId)).toEqual([
        "playlist-1",
        "playlist-2",
      ]);
    });
  });

  describe("Smart Playlist Criteria Evaluation", () => {
    it("should evaluate track matches criteria with tag filters", () => {
      const { result } = renderHook(() => useTagData());

      const trackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [
          { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
          { categoryId: "mood", subcategoryId: "energy", tagId: "uplifting" },
        ],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      const criteria: SmartPlaylistCriteria["criteria"] = {
        activeTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
        excludedTagFilters: [],
        ratingFilters: [],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
        isOrFilterMode: false,
      };

      // Access the internal function (you may need to expose this for testing)
      const matches = result.current.evaluateTrackMatchesCriteria(trackData, criteria);
      expect(matches).toBe(true);
    });

    it("should evaluate track does not match excluded tags", () => {
      const { result } = renderHook(() => useTagData());

      const trackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      const criteria: SmartPlaylistCriteria["criteria"] = {
        activeTagFilters: [],
        excludedTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
        ratingFilters: [],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
        isOrFilterMode: false,
      };

      const matches = result.current.evaluateTrackMatchesCriteria(trackData, criteria);
      expect(matches).toBe(false);
    });

    it("should evaluate rating filters correctly", () => {
      const { result } = renderHook(() => useTagData());

      const trackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      const criteria: SmartPlaylistCriteria["criteria"] = {
        activeTagFilters: [],
        excludedTagFilters: [],
        ratingFilters: [4, 5],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
        isOrFilterMode: false,
      };

      const matches = result.current.evaluateTrackMatchesCriteria?.(trackData, criteria);
      expect(matches).toBe(true);
    });

    it("should evaluate energy range filters correctly", () => {
      const { result } = renderHook(() => useTagData());

      const trackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      const criteria: SmartPlaylistCriteria["criteria"] = {
        activeTagFilters: [],
        excludedTagFilters: [],
        ratingFilters: [],
        energyMinFilter: 5,
        energyMaxFilter: 8,
        bpmMinFilter: null,
        bpmMaxFilter: null,
        isOrFilterMode: false,
      };

      const matches = result.current.evaluateTrackMatchesCriteria?.(trackData, criteria);
      expect(matches).toBe(true);
    });

    it("should evaluate BPM range filters correctly", () => {
      const { result } = renderHook(() => useTagData());

      const trackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      const criteria: SmartPlaylistCriteria["criteria"] = {
        activeTagFilters: [],
        excludedTagFilters: [],
        ratingFilters: [],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: 120,
        bpmMaxFilter: 130,
        isOrFilterMode: false,
      };

      const matches = result.current.evaluateTrackMatchesCriteria?.(trackData, criteria);
      expect(matches).toBe(true);
    });

    it("should handle OR mode for tag filters", () => {
      const { result } = renderHook(() => useTagData());

      const trackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      const criteria: SmartPlaylistCriteria["criteria"] = {
        activeTagFilters: [
          { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
          { categoryId: "genre", subcategoryId: "rock", tagId: "alternative" },
        ],
        excludedTagFilters: [],
        ratingFilters: [],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
        isOrFilterMode: true,
      };

      const matches = result.current.evaluateTrackMatchesCriteria?.(trackData, criteria);
      expect(matches).toBe(true);
    });
  });

  describe("Smart Playlist Storage", () => {
    it("should store smart playlist criteria to localStorage", async () => {
      const { result } = renderHook(() => useTagData());

      const smartPlaylistCriteria: SmartPlaylistCriteria = {
        playlistId: "test-playlist-id",
        playlistName: "Test Smart Playlist",
        isActive: true,
        smartPlaylistTrackUris: [],
        lastSyncAt: Date.now(),
        createdAt: Date.now(),
        criteria: {
          activeTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
          excludedTagFilters: [],
          ratingFilters: [4, 5],
          energyMinFilter: 5,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      };

      act(() => {
        result.current.createSmartPlaylist(smartPlaylistCriteria);
      });

      expect(localStorage.setItem).toHaveBeenCalledWith(
        "tagify:smartPlaylists",
        expect.stringContaining("test-playlist-id")
      );
    });

    it("should load smart playlists from localStorage on mount", () => {
      const mockSmartPlaylists = [
        {
          playlistId: "test-playlist-id",
          playlistName: "Test Smart Playlist",
          isActive: true,
          smartPlaylistTrackUris: [],
          lastSyncAt: Date.now(),
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
        },
      ];

      localStorage.getItem = vi.fn().mockReturnValue(JSON.stringify(mockSmartPlaylists));

      const { result } = renderHook(() => useTagData());

      expect(result.current.smartPlaylists).toHaveLength(1);
      expect(result.current.smartPlaylists[0].playlistId).toBe("test-playlist-id");
    });
  });

  describe("Smart Playlist Sync Operations", () => {
    it("should sync single track addition to smart playlist", async () => {
      // Mock Spotify API responses
      const mockAddResult = { success: true, wasAdded: true };
      vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockResolvedValue(mockAddResult);

      const { result } = renderHook(() => useTagData());

      // Set up initial state with a smart playlist
      const smartPlaylist: SmartPlaylistCriteria = {
        playlistId: "test-playlist",
        playlistName: "Test Playlist",
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

      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      // Mock track data that matches the criteria
      const matchingTrackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:test123",
          matchingTrackData
        );
      });

      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:track:test123",
        "test-playlist"
      );
    });

    it("should sync single track removal from smart playlist", async () => {
      // Mock Spotify API responses
      vi.mocked(spotifyApiService.removeTrackFromPlaylist).mockResolvedValue(true);

      const { result } = renderHook(() => useTagData());

      // Set up initial state with a smart playlist that has the track
      const smartPlaylist: SmartPlaylistCriteria = {
        playlistId: "test-playlist",
        playlistName: "Test Playlist",
        isActive: true,
        smartPlaylistTrackUris: ["spotify:track:test123"],
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

      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      // Mock track data that no longer matches the criteria
      const nonMatchingTrackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [{ categoryId: "genre", subcategoryId: "rock", tagId: "alternative" }],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:test123",
          nonMatchingTrackData
        );
      });

      expect(spotifyApiService.removeTrackFromPlaylist).toHaveBeenCalledWith(
        "spotify:track:test123",
        "test-playlist"
      );
    });

    it("should handle full playlist sync correctly", async () => {
      // Mock Spotify API responses
      vi.mocked(spotifyApiService.getAllTrackUrisInPlaylist).mockResolvedValue([
        "spotify:track:old123",
      ]);
      vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockResolvedValue({
        success: true,
        wasAdded: true,
      });
      vi.mocked(spotifyApiService.removeTrackFromPlaylist).mockResolvedValue(true);

      const { result } = renderHook(() => useTagData());

      // Set up tag data with tracks
      const mockTagData = {
        categories: [],
        tracks: {
          "spotify:track:new123": {
            rating: 4,
            energy: 7,
            bpm: 128,
            tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
            dateCreated: Date.now(),
            dateModified: Date.now(),
          },
        },
      };

      act(() => {
        result.current.setTagData?.(mockTagData);
      });

      const smartPlaylist: SmartPlaylistCriteria = {
        playlistId: "test-playlist",
        playlistName: "Test Playlist",
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

      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:track:new123",
        "test-playlist"
      );
      expect(spotifyApiService.removeTrackFromPlaylist).toHaveBeenCalledWith(
        "spotify:track:old123",
        "test-playlist"
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully during sync", async () => {
      const { result } = renderHook(() => useTagData());

      // Verify we start with clean state
      expect(result.current.smartPlaylists).toHaveLength(0);

      // Mock API to throw error
      vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockRejectedValue(
        new Error("Spotify API Error")
      );
      const smartPlaylist: SmartPlaylistCriteria = {
        playlistId: "test-playlist",
        playlistName: "Test Playlist",
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

      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackData: TrackData = {
        rating: 4,
        energy: 7,
        bpm: 128,
        tags: [],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:test123", trackData);
      });

      // Should not throw error, should handle gracefully
      expect(result.current.smartPlaylists).toHaveLength(1);
    });
  });
});
