import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTagData, SmartPlaylistCriteria, TrackData } from "@/hooks/data/useTagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import {
  createMockSmartPlaylist,
  createMockTrackData,
  simulateNetworkError,
  simulateRateLimitError,
} from "../utils/test-helpers";
import { useSmartPlaylists } from "@/hooks/data/useSmartPlaylists";

vi.mock("../../services/SpotifyApiService", () => ({
  spotifyApiService: {
    addTrackToSpotifyPlaylist: vi.fn(),
    removeTrackFromPlaylist: vi.fn(),
    getAllTrackUrisInPlaylist: vi.fn(),
  },
}));

const waitForHookInitialization = (result: any) => {
  return new Promise((resolve) => {
    const checkInitialization = () => {
      if (result.current && result.current.storeSmartPlaylist) {
        resolve(result.current);
      } else {
        setTimeout(checkInitialization, 10);
      }
    };
    checkInitialization();
  });
};

describe.skip("Smart Playlist Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default successful mocks
    vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockResolvedValue({
      success: true,
      wasAdded: true,
    });
    vi.mocked(spotifyApiService.removeTrackFromPlaylist).mockResolvedValue(true);
    vi.mocked(spotifyApiService.getAllTrackUrisInPlaylist).mockResolvedValue([]);
  });

  describe("Local File Handling", () => {
    it("should handle local files correctly in smart playlists", async () => {
      const { result1 } = renderHook(() => useTagData());
      const { result } = renderHook(() => useSmartPlaylists(result1.tagData));
      
      const smartPlaylist = createMockSmartPlaylist({
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
      });

      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      // Create local file track data that matches criteria
      const localTrackData: TrackData = {
        rating: 5,
        energy: 8,
        bpm: null, // Local files typically don't have BPM
        tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
        dateCreated: Date.now(),
        dateModified: Date.now(),
      };

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:local:Artist:Album:Track:Duration",
          localTrackData
        );
      });

      // Should attempt to add local file (even though it might not work in Spotify)
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
        "spotify:local:Artist:Album:Track:Duration",
        smartPlaylist.playlistId
      );

      // Should show appropriate notification for local files
      expect(global.Spicetify.showNotification).toHaveBeenCalledWith(
        expect.stringContaining("Local file"),
        true,
        5000
      );
    });

    it("should handle mixed local and regular tracks in batch operations", async () => {
      const { result } = renderHook(() => useTagData());

      const smartPlaylist = createMockSmartPlaylist();
      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackUpdates: Record<string, TrackData> = {
        "spotify:track:regular1": createMockTrackData(),
        "spotify:local:Artist:Album:Track:Duration": createMockTrackData({ bpm: null }),
        "spotify:track:regular2": createMockTrackData(),
      };

      await act(async () => {
        await result.current.syncMultipleTracksWithSmartPlaylists(trackUpdates);
      });

      // Should handle both regular and local tracks
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledTimes(3);
    });
  });

  describe("Network and API Error Handling", () => {
    it("should gracefully handle network timeouts", async () => {
      const { result } = renderHook(() => useTagData());

      // Simulate network timeout
      vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Network timeout")), 100);
          })
      );

      const smartPlaylist = createMockSmartPlaylist();
      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackData = createMockTrackData();

      // Should not crash on network timeout
      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:timeout", trackData);
      });

      expect(result.current.smartPlaylists).toHaveLength(1);
    });

    it("should handle Spotify API service unavailable", async () => {
      const { result } = renderHook(() => useTagData());

      simulateNetworkError();

      const smartPlaylist = createMockSmartPlaylist();
      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackData = createMockTrackData();

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:service-down", trackData);
      });

      // Should maintain smart playlist state even when API is down
      expect(result.current.smartPlaylists).toHaveLength(1);
      expect(result.current.smartPlaylists[0].isActive).toBe(true);
    });

    it("should handle rate limiting with exponential backoff simulation", async () => {
      const { result } = renderHook(() => useTagData());

      let callCount = 0;
      // Mock to fail first few attempts, then succeed
      vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          // Fail first 2 attempts
          const error = new Error("Rate limit exceeded. Try again in 60 seconds.");
          error.name = "RateLimitError"; // Add specific error type
          throw error;
        }
        return { success: true, wasAdded: true };
      });

      const smartPlaylist = createMockSmartPlaylist();
      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackData = createMockTrackData();

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:rate-limited", trackData);
      });

      // Should have made at least 3 calls (2 failures + 1 success)
      expect(callCount).toBeGreaterThanOrEqual(3);
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledTimes(3);
    });

    it("should handle invalid playlist IDs gracefully", async () => {
      const { result } = renderHook(() => useTagData());

      vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockRejectedValue(
        new Error("Invalid playlist ID")
      );

      const smartPlaylist = createMockSmartPlaylist({
        playlistId: "invalid-playlist-id",
        playlistName: "Invalid Playlist",
      });

      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackData = createMockTrackData();

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:test", trackData);
      });

      // Should handle invalid playlist ID without crashing
      expect(result.current.smartPlaylists).toHaveLength(1);
    });
  });

  describe("Data Corruption and Recovery", () => {
    it("should handle corrupted localStorage data", () => {
      // Corrupt localStorage with invalid JSON
      localStorage.setItem("tagify:smartPlaylists", "invalid json {");

      const { result } = renderHook(() => useTagData());

      // Should initialize with empty array despite corrupted data
      expect(result.current.smartPlaylists).toEqual([]);
    });

    it("should handle missing required fields in smart playlist data", () => {
      // Create playlist data missing required fields
      const corruptedPlaylist = {
        playlistId: "test-id",
        // Missing playlistName, isActive, criteria, etc.
      };

      localStorage.setItem("tagify:smartPlaylists", JSON.stringify([corruptedPlaylist]));

      const { result } = renderHook(() => useTagData());

      // Should filter out corrupted playlists
      expect(result.current.smartPlaylists).toEqual([]);
    });

    it("should recover from partial data corruption", () => {
      const validPlaylist1 = createMockSmartPlaylist({ playlistId: "valid-1" });
      const validPlaylist2 = createMockSmartPlaylist({ playlistId: "valid-2" });

      // Create properly corrupted data that's missing required fields
      const corruptedPlaylist = {
        playlistId: "corrupt",
        // Missing required fields: playlistName, isActive, criteria, etc.
      };

      // Set the corrupted data in localStorage
      localStorage.setItem(
        "tagify:smartPlaylists",
        JSON.stringify([validPlaylist1, corruptedPlaylist, validPlaylist2])
      );

      const { result } = renderHook(() => useTagData());

      // Wait for hook to initialize and filter corrupted data
      expect(result.current.smartPlaylists).toHaveLength(2);
      expect(result.current.smartPlaylists.map((p) => p.playlistId)).toEqual([
        "valid-1",
        "valid-2",
      ]);
    });

    it("should handle extremely large localStorage data", () => {
      // Create extremely large playlist data
      const largePlaylist = createMockSmartPlaylist({
        criteria: {
          activeTagFilters: Array.from({ length: 10000 }, (_, i) => ({
            categoryId: `category-${i}`,
            subcategoryId: `subcategory-${i}`,
            tagId: `tag-${i}`,
          })),
          excludedTagFilters: [],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      });

      // Should handle large data without crashing
      expect(() => {
        const { result } = renderHook(() => useTagData());
        act(() => {
          result.current.createSmartPlaylist(largePlaylist);
        });
      }).not.toThrow();
    });
  });

  describe("Concurrent Operations and Race Conditions", () => {
    it("should handle concurrent playlist creation", async () => {
      const { result } = renderHook(() => useTagData());

      const playlist1 = createMockSmartPlaylist({ playlistId: "concurrent-1" });
      const playlist2 = createMockSmartPlaylist({ playlistId: "concurrent-2" });
      const playlist3 = createMockSmartPlaylist({ playlistId: "concurrent-3" });

      // Simulate concurrent playlist creation
      await act(async () => {
        await Promise.all([
          Promise.resolve(result.current.createSmartPlaylist(playlist1)),
          Promise.resolve(result.current.createSmartPlaylist(playlist2)),
          Promise.resolve(result.current.createSmartPlaylist(playlist3)),
        ]);
      });

      expect(result.current.smartPlaylists).toHaveLength(3);
    });

    it("should handle concurrent track sync operations", async () => {
      const { result } = renderHook(() => useTagData());

      const smartPlaylist = createMockSmartPlaylist();
      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackData = createMockTrackData();

      // Simulate multiple concurrent sync operations for the same track
      const concurrentSyncs = Array.from({ length: 5 }, (_, i) =>
        act(async () => {
          await result.current.syncTrackWithSmartPlaylists(
            `spotify:track:concurrent-${i}`,
            trackData
          );
        })
      );

      await Promise.all(concurrentSyncs);

      // Should handle all operations without data corruption
      expect(result.current.smartPlaylists).toHaveLength(1);
    });

    it("should handle playlist deletion during sync", async () => {
      const { result } = renderHook(() => useTagData());

      // Wait for hook to be fully initialized
      await waitForHookInitialization(result);

      const smartPlaylist = createMockSmartPlaylist();
      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      const trackData = createMockTrackData();

      // Start sync operation
      const syncPromise = act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:test", trackData);
      });

      // Immediately delete playlist
      act(() => {
        result.current.setSmartPlaylists([]);
      });

      // Should complete without error
      await syncPromise;

      expect(result.current.smartPlaylists).toHaveLength(0);
    });
  });

  describe("Boundary Value Testing", () => {
    it("should handle minimum and maximum rating values", async () => {
      const { result } = renderHook(() => useTagData());

      const minRatingPlaylist = createMockSmartPlaylist({
        criteria: {
          activeTagFilters: [],
          excludedTagFilters: [],
          ratingFilters: [1], // Minimum rating
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      });

      const maxRatingPlaylist = createMockSmartPlaylist({
        playlistId: "max-rating-playlist",
        criteria: {
          activeTagFilters: [],
          excludedTagFilters: [],
          ratingFilters: [5], // Maximum rating
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      });

      act(() => {
        result.current.createSmartPlaylist(minRatingPlaylist);
        result.current.createSmartPlaylist(maxRatingPlaylist);
      });

      // Test with minimum rating track
      const minRatingTrack = createMockTrackData({ rating: 1 });
      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:min-rating",
          minRatingTrack
        );
      });

      // Test with maximum rating track
      const maxRatingTrack = createMockTrackData({ rating: 5 });
      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:max-rating",
          maxRatingTrack
        );
      });

      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledTimes(2);
    });

    it("should handle zero and negative values gracefully", async () => {
      const { result } = renderHook(() => useTagData());

      const smartPlaylist = createMockSmartPlaylist();
      act(() => {
        result.current.createSmartPlaylist(smartPlaylist);
      });

      // Test with zero/negative values
      const edgeTrackData: TrackData = {
        rating: 0,
        energy: -1, // Invalid negative energy
        bpm: 0,
        tags: [],
        dateCreated: 0,
        dateModified: -1000, // Negative timestamp
      };

      // Should handle invalid values without crashing
      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists(
          "spotify:track:edge-values",
          edgeTrackData
        );
      });

      expect(result.current.smartPlaylists).toHaveLength(1);
    });

    it("should handle extremely high BPM and energy values", async () => {
      const { result } = renderHook(() => useTagData());

      const highValuePlaylist = createMockSmartPlaylist({
        criteria: {
          activeTagFilters: [],
          excludedTagFilters: [],
          ratingFilters: [],
          energyMinFilter: 999,
          energyMaxFilter: 1000,
          bpmMinFilter: 9999,
          bpmMaxFilter: 10000,
          isOrFilterMode: false,
        },
      });

      act(() => {
        result.current.createSmartPlaylist(highValuePlaylist);
      });

      const extremeTrack = createMockTrackData({
        energy: 1000,
        bpm: 10000,
      });

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:extreme", extremeTrack);
      });

      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalled();
    });
  });

  describe("Unicode and Special Characters", () => {
    it("should handle unicode characters in playlist names and tags", async () => {
      const { result } = renderHook(() => useTagData());

      const unicodePlaylist = createMockSmartPlaylist({
        playlistName: "🎵 Electronic Music 音楽 🎧",
        criteria: {
          activeTagFilters: [
            { categoryId: "genre", subcategoryId: "electronic", tagId: "house-музыка" },
          ],
          excludedTagFilters: [],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: false,
        },
      });

      act(() => {
        result.current.createSmartPlaylist(unicodePlaylist);
      });

      const unicodeTrackData = createMockTrackData({
        tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house-музыка" }],
      });

      await act(async () => {
        await result.current.syncTrackWithSmartPlaylists("spotify:track:unicode", unicodeTrackData);
      });

      expect(result.current.smartPlaylists[0].playlistName).toBe("🎵 Electronic Music 音楽 🎧");
      expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalled();
    });

    it("should handle very long playlist names and descriptions", async () => {
      const { result } = renderHook(() => useTagData());

      const longName = "A".repeat(1000); // Very long name
      const longPlaylist = createMockSmartPlaylist({
        playlistName: longName,
      });

      act(() => {
        result.current.createSmartPlaylist(longPlaylist);
      });

      expect(result.current.smartPlaylists[0].playlistName).toBe(longName);
    });
  });

  describe("Memory and Resource Management", () => {
    it("should handle cleanup of deleted playlists", async () => {
      const { result } = renderHook(() => useTagData());

      // Mock API to return that playlist no longer exists
      vi.mocked(spotifyApiService.getAllTrackUrisInPlaylist).mockRejectedValue(
        new Error("Playlist not found")
      );

      const deletedPlaylist = createMockSmartPlaylist({
        playlistId: "deleted-playlist",
      });

      act(() => {
        result.current.createSmartPlaylist(deletedPlaylist);
      });

      // Trigger cleanup by attempting sync
      await act(async () => {
        await result.current.cleanupDeletedSmartPlaylists?.();
      });

      // Should remove deleted playlists from state
      expect(result.current.smartPlaylists).toHaveLength(0);
    });

    it("should handle memory pressure scenarios", async () => {
      const { result } = renderHook(() => useTagData());

      await waitForHookInitialization(result);

      // Use a more reasonable number for testing
      const manyPlaylists = Array.from({ length: 100 }, (_, i) =>
        createMockSmartPlaylist({
          playlistId: `playlist-${i}`,
          playlistName: `Playlist ${i}`,
        })
      );

      // Store playlists in batches to avoid overwhelming the system
      expect(() => {
        act(() => {
          manyPlaylists.forEach((playlist) => {
            result.current.createSmartPlaylist(playlist);
          });
        });
      }).not.toThrow();

      expect(result.current.smartPlaylists).toHaveLength(100);
    });
  });
});
