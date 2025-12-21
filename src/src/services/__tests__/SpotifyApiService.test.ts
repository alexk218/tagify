import { describe, it, expect, vi, beforeEach } from "vitest";
import { spotifyApiService } from "../../services/SpotifyApiService";

describe("SpotifyApiService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAllTrackUrisInPlaylist", () => {
    it("should fetch all track URIs from a playlist", async () => {
      const mockResponse = {
        items: [{ track: { uri: "spotify:track:123" } }, { track: { uri: "spotify:track:456" } }],
        total: 2,
      };

      global.Spicetify.CosmosAsync.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await spotifyApiService.getAllTrackUrisInPlaylist("playlist123");

      expect(result).toEqual(["spotify:track:123", "spotify:track:456"]);
      expect(global.Spicetify.CosmosAsync.get).toHaveBeenCalledWith(
        expect.stringContaining("playlists/playlist123/tracks")
      );
    });

    it("should handle pagination correctly", async () => {
      const firstPageResponse = {
        items: Array.from({ length: 100 }, (_, i) => ({
          track: { uri: `spotify:track:${i}` },
        })),
        total: 150,
      };

      const secondPageResponse = {
        items: Array.from({ length: 50 }, (_, i) => ({
          track: { uri: `spotify:track:${i + 100}` },
        })),
        total: 150,
      };

      global.Spicetify.CosmosAsync.get = vi
        .fn()
        .mockResolvedValueOnce(firstPageResponse)
        .mockResolvedValueOnce(secondPageResponse);

      const result = await spotifyApiService.getAllTrackUrisInPlaylist("playlist123");

      expect(result).toHaveLength(150);
      expect(global.Spicetify.CosmosAsync.get).toHaveBeenCalledTimes(2);
    });

    it("should handle empty playlists", async () => {
      const mockResponse = {
        items: [],
        total: 0,
      };

      global.Spicetify.CosmosAsync.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await spotifyApiService.getAllTrackUrisInPlaylist("playlist123");

      expect(result).toEqual([]);
    });

    it("should handle API errors gracefully", async () => {
      global.Spicetify.CosmosAsync.get = vi.fn().mockRejectedValue(new Error("API Error"));

      const result = await spotifyApiService.getAllTrackUrisInPlaylist("playlist123");

      expect(result).toEqual([]);
    });
  });

  describe("isTrackInPlaylist", () => {
    it("should return true if track is in playlist", async () => {
      const mockResponse = {
        items: [
          { track: { uri: "spotify:track:123" } },
          { track: { uri: "spotify:track:target" } },
        ],
        total: 2,
      };

      global.Spicetify.CosmosAsync.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await spotifyApiService.isTrackInPlaylist(
        "spotify:track:target",
        "playlist123"
      );

      expect(result).toBe(true);
    });

    it("should return false if track is not in playlist", async () => {
      const mockResponse = {
        items: [{ track: { uri: "spotify:track:123" } }, { track: { uri: "spotify:track:456" } }],
        total: 2,
      };

      global.Spicetify.CosmosAsync.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await spotifyApiService.isTrackInPlaylist(
        "spotify:track:notfound",
        "playlist123"
      );

      expect(result).toBe(false);
    });

    it("should handle pagination when searching for tracks", async () => {
      const firstPageResponse = {
        items: Array.from({ length: 100 }, (_, i) => ({
          track: { uri: `spotify:track:${i}` },
        })),
        total: 150,
      };

      const secondPageResponse = {
        items: [
          ...Array.from({ length: 49 }, (_, i) => ({
            track: { uri: `spotify:track:${i + 100}` },
          })),
          { track: { uri: "spotify:track:target" } },
        ],
        total: 150,
      };

      global.Spicetify.CosmosAsync.get = vi
        .fn()
        .mockResolvedValueOnce(firstPageResponse)
        .mockResolvedValueOnce(secondPageResponse);

      const result = await spotifyApiService.isTrackInPlaylist(
        "spotify:track:target",
        "playlist123"
      );

      expect(result).toBe(true);
      expect(global.Spicetify.CosmosAsync.get).toHaveBeenCalledTimes(2);
    });
  });

  describe("getAudioFeatures", () => {
    it("should fetch audio features for a track", async () => {
      const mockAudioFeatures = {
        tempo: 129,
        energy: 0.7,
        valence: 0.8,
      };

      global.Spicetify.CosmosAsync.get = vi.fn().mockResolvedValue(mockAudioFeatures);

      const result = await spotifyApiService.getAudioFeatures("track123");

      expect(result).toEqual({ tempo: 129 });
      expect(global.Spicetify.CosmosAsync.get).toHaveBeenCalledWith(
        "https://api.spotify.com/v1/audio-features/track123"
      );
    });

    it("should handle missing tempo gracefully", async () => {
      const mockAudioFeatures = {
        energy: 0.7,
        valence: 0.8,
      };

      global.Spicetify.CosmosAsync.get = vi.fn().mockResolvedValue(mockAudioFeatures);

      const result = await spotifyApiService.getAudioFeatures("track123");

      expect(result).toBeNull();
    });

    it("should handle API errors", async () => {
      global.Spicetify.CosmosAsync.get = vi.fn().mockRejectedValue(new Error("API Error"));

      const result = await spotifyApiService.getAudioFeatures("track123");

      expect(result).toBeNull();
    });
  });

  describe("extractTrackId", () => {
    it("should extract track ID from Spotify URI", () => {
      const result = spotifyApiService.extractTrackId("spotify:track:4iV5W9uYEdYUVa79Axb7Rh");
      expect(result).toBe("4iV5W9uYEdYUVa79Axb7Rh");
    });

    it("should return null for local file URIs", () => {
      const result = spotifyApiService.extractTrackId("spotify:local:Artist:Album:Track:Duration");
      expect(result).toBeNull();
    });

    it("should handle malformed URIs", () => {
      const result = spotifyApiService.extractTrackId("invalid:uri");
      expect(result).toBe("uri");
    });
  });

  describe("fetchBpm", () => {
    it("should fetch BPM for a valid track", async () => {
      const mockAudioFeatures = {
        tempo: 129,
      };

      global.Spicetify.CosmosAsync.get = vi.fn().mockResolvedValue(mockAudioFeatures);

      const result = await spotifyApiService.fetchBpm("spotify:track:4iV5W9uYEdYUVa79Axb7Rh");

      expect(result).toBe(129);
    });

    it("should return null for local files", async () => {
      const result = await spotifyApiService.fetchBpm("spotify:local:Artist:Album:Track:Duration");

      expect(result).toBeNull();
      expect(global.Spicetify.CosmosAsync.get).not.toHaveBeenCalled();
    });

    it("should handle tracks with no audio features", async () => {
      global.Spicetify.CosmosAsync.get = vi.fn().mockResolvedValue(null);

      const result = await spotifyApiService.fetchBpm("spotify:track:4iV5W9uYEdYUVa79Axb7Rh");

      expect(result).toBeNull();
    });
  });

  describe("addTrackToSpotifyPlaylist", () => {
    it("should add track to playlist successfully", async () => {
      global.Spicetify.CosmosAsync.post = vi.fn().mockResolvedValue({ snapshot_id: "snap123" });

      const result = await spotifyApiService.addTrackToSpotifyPlaylist(
        "spotify:track:123",
        "playlist123"
      );

      expect(result).toEqual({ success: true, wasAdded: true });
      expect(global.Spicetify.CosmosAsync.post).toHaveBeenCalledWith(
        "https://api.spotify.com/v1/playlists/playlist123/tracks",
        { uris: ["spotify:track:123"] }
      );
    });

    it("should handle API errors when adding track", async () => {
      global.Spicetify.CosmosAsync.post = vi.fn().mockRejectedValue(new Error("API Error"));

      const result = await spotifyApiService.addTrackToSpotifyPlaylist(
        "spotify:track:123",
        "playlist123"
      );

      expect(result).toEqual({ success: false, wasAdded: false });
    });

    it("should handle local files correctly", async () => {
      const result = await spotifyApiService.addTrackToSpotifyPlaylist(
        "spotify:local:Artist:Album:Track:Duration",
        "playlist123"
      );

      expect(result).toEqual({ success: true, wasAdded: false });
      expect(global.Spicetify.CosmosAsync.post).not.toHaveBeenCalled();
    });
  });

  describe("removeTrackFromPlaylist", () => {
    it("should remove track from playlist successfully", async () => {
      global.Spicetify.CosmosAsync.del = vi.fn().mockResolvedValue({ snapshot_id: "snap123" });

      const result = await spotifyApiService.removeTrackFromPlaylist(
        "spotify:track:123",
        "playlist123"
      );

      expect(result).toBe(true);
      expect(global.Spicetify.CosmosAsync.del).toHaveBeenCalledWith(
        "https://api.spotify.com/v1/playlists/playlist123/tracks",
        { tracks: [{ uri: "spotify:track:123" }] }
      );
    });

    it("should handle API errors when removing track", async () => {
      global.Spicetify.CosmosAsync.del = vi.fn().mockRejectedValue(new Error("API Error"));

      const result = await spotifyApiService.removeTrackFromPlaylist(
        "spotify:track:123",
        "playlist123"
      );

      expect(result).toBe(false);
    });
  });
});
