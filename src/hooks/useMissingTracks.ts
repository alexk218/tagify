import { useState, useEffect } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  added_at?: string;
  is_local_file: boolean;
  file_hash: string;
  modified: string;
}

interface LocalTrackInfo {
  path: string;
  filename: string;
  uri: string;
  track_id: string | null;
  size: number;
  modified: number;
  file_hash: string | null;
  is_local_file: boolean;
}

// Interface for our database results
interface DirectCompareResult {
  success: boolean;
  database_time: string;
  master_tracks: SpotifyTrack[];
  missing_tracks: SpotifyTrack[];
  local_tracks: {
    count: number;
    tracks: LocalTrackInfo[];
  };
  master_tracks_directory: string;
  mapping_method: string;
  message?: string;
}

export function useMissingTracks() {
  const [cachedResults, setCachedResults] = useLocalStorage<{
    masterTracks: SpotifyTrack[];
    missingTracks: SpotifyTrack[];
    localTracksCount: number;
    lastUpdated: string | null;
  }>("tagify:missingTracksData", {
    masterTracks: [],
    missingTracks: [],
    localTracksCount: 0,
    lastUpdated: null,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [masterTracks, setMasterTracks] = useState<SpotifyTrack[]>(cachedResults.masterTracks);
  const [missingTracks, setMissingTracks] = useState<SpotifyTrack[]>(cachedResults.missingTracks);
  const [localTracksCount, setLocalTracksCount] = useState(cachedResults.localTracksCount);

  const [serverUrl, setServerUrl] = useLocalStorage<string>(
    "tagify:localServerUrl",
    "http://localhost:8765"
  );
  const [forceRefresh, setForceRefresh] = useState(false);

  // Load data from the direct comparison endpoint
  const loadData = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const masterTracksDir = localStorage.getItem("tagify:masterTracksDir");
      const sanitizedUrl = serverUrl.replace(/^["'](.*)["']$/, "$1");

      // Build the query URL with parameters
      const queryUrl = new URL(`${sanitizedUrl}/api/tracks/compare`);
      if (masterTracksDir) queryUrl.searchParams.append("master_tracks_dir", masterTracksDir);

      // Make the API request
      const response = await fetch(queryUrl.toString());

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const data: DirectCompareResult = await response.json();

      if (data.success) {
        // Update state with the results
        setMasterTracks(data.master_tracks);
        setMissingTracks(data.missing_tracks);
        setLocalTracksCount(data.local_tracks.count);

        // Update cached data in localStorage
        setCachedResults({
          masterTracks: data.master_tracks,
          missingTracks: data.missing_tracks,
          localTracksCount: data.local_tracks.count,
          lastUpdated: data.database_time,
        });

        // Store the music directory if it was provided
        if (data.master_tracks_directory && !masterTracksDir) {
          localStorage.setItem("tagify:masterTracksDir", data.master_tracks_directory);
        }
      } else {
        throw new Error(data.message || "Unknown error from server");
      }
    } catch (error) {
      console.error("Error loading data:", error);

      if (!silent) {
        setError(`${error}`);
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
      setForceRefresh(false);
    }
  };

  // Create a playlist with missing tracks
  const createPlaylist = async () => {
    try {
      if (missingTracks.length === 0) {
        Spicetify.showNotification("No missing tracks to add to playlist", true);
        return;
      }

      // Get user ID
      const userProfile = await Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me");
      const userId = userProfile.id;

      // Create playlist
      const date = new Date().toLocaleDateString();
      const playlistResponse = await Spicetify.CosmosAsync.post(
        `https://api.spotify.com/v1/users/${userId}/playlists`,
        {
          name: `Missing Tracks (${date})`,
          description: "Tracks from MASTER playlist that are missing from local files",
          public: false,
        }
      );

      const playlistId = playlistResponse.id;

      // Add tracks in batches
      const trackUris = missingTracks.map((track) => track.uri).filter((uri) => uri); // Filter out any undefined URIs

      for (let i = 0; i < trackUris.length; i += 100) {
        const batch = trackUris.slice(i, i + 100);
        await Spicetify.CosmosAsync.post(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          {
            uris: batch,
          }
        );
      }

      Spicetify.showNotification(`Created playlist with ${missingTracks.length} missing tracks!`);

      // Navigate to the playlist
      Spicetify.Platform.History.push(`/playlist/${playlistId}`);
    } catch (error) {
      console.error("Error creating playlist:", error);
      Spicetify.showNotification("Failed to create playlist", true);
    }
  };

  // Load data on mount, but only if cached data is old or empty
  useEffect(() => {
    const shouldRefresh =
      !cachedResults.lastUpdated ||
      new Date().getTime() - new Date(cachedResults.lastUpdated).getTime() > 3600000; // 1 hour

    if (shouldRefresh || missingTracks.length === 0) {
      loadData();
    } else {
      setIsLoading(false); // we're using cached data, so we're not loading
    }
  }, []);

  return {
    isLoading,
    error,
    masterTracks,
    localTracks: { size: localTracksCount },
    missingTracks,
    loadData,
    createPlaylist,
    cachedData: cachedResults.lastUpdated
      ? {
          lastUpdated: new Date(cachedResults.lastUpdated).toLocaleString(),
          tracksCount: masterTracks.length,
          missingCount: missingTracks.length,
          localCount: localTracksCount,
        }
      : null,
  };
}
