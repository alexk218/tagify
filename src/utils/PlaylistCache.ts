import { shouldExcludePlaylist } from "./PlaylistSettings";

interface PlaylistInfo {
  id: string;
  name: string;
  owner: string;
}

interface PlaylistCache {
  tracks: Record<string, PlaylistInfo[]>;
  lastUpdated: number; // timestamp
}

// Storage key for the cache
const PLAYLIST_CACHE_KEY = "tagify:playlistCache";

// Function to get the cache from localStorage
export function getPlaylistCache(): PlaylistCache {
  try {
    const cacheString = localStorage.getItem(PLAYLIST_CACHE_KEY);
    if (cacheString) {
      return JSON.parse(cacheString);
    }
  } catch (error) {
    console.error("Tagify: Error reading playlist cache:", error);
  }

  // Return empty cache if not found or error
  return {
    tracks: {},
    lastUpdated: 0,
  };
}

// Function to save the cache to localStorage
export function savePlaylistCache(cache: PlaylistCache): void {
  try {
    localStorage.setItem(PLAYLIST_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Tagify: Error saving playlist cache:", error);
  }
}

// Function to add a track to a playlist in the cache
export function addTrackToPlaylistInCache(
  trackUri: string,
  playlistId: string,
  playlistName: string,
  playlistOwner: string
): void {
  const cache = getPlaylistCache();

  if (!cache.tracks[trackUri]) {
    cache.tracks[trackUri] = [];
  }

  // Check if the playlist is already in the track's list
  const existingIndex = cache.tracks[trackUri].findIndex((p) => p.id === playlistId);

  if (existingIndex === -1) {
    // Add playlist info to the track's list
    cache.tracks[trackUri].push({
      id: playlistId,
      name: playlistName,
      owner: playlistOwner,
    });

    // Update the timestamp
    cache.lastUpdated = Date.now();

    // Save the updated cache
    savePlaylistCache(cache);
  }
}

// Function to get playlists containing a track from the cache
export function getPlaylistsContainingTrack(trackUri: string): PlaylistInfo[] {
  const cache = getPlaylistCache();
  return cache.tracks[trackUri] || [];
}

// Function to refresh the entire cache
export async function refreshPlaylistCache(): Promise<number> {
  try {
    // Get user profile
    const userProfile = await Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me");
    const userId = userProfile.id;

    if (!userId) {
      throw new Error("Could not get user ID");
    }

    // Create a new empty cache
    const newCache: PlaylistCache = {
      tracks: {},
      lastUpdated: Date.now(),
    };

    // Get all user's playlists
    const playlists: Array<{
      id: string;
      name: string;
      owner: { id: string; display_name: string };
      tracks: { total: number };
      description: string;
    }> = [];

    let offset = 0;
    let hasMore = true;

    // First, fetch all playlists
    while (hasMore) {
      const response = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}&fields=items(id,name,owner,tracks.total,description)`
      );

      if (response && response.items && response.items.length > 0) {
        playlists.push(...response.items);
        offset += response.items.length;
        hasMore = response.items.length === 50;
      } else {
        hasMore = false;
      }
    }

    console.log(`Tagify: Found ${playlists.length} total playlists`);

    // Filter playlists based on exclusion settings
    const filteredPlaylists = playlists.filter(
      (playlist) =>
        !shouldExcludePlaylist(
          playlist.id,
          playlist.name,
          playlist.owner.id,
          playlist.description || "",
          userId
        )
    );

    console.log(
      `Tagify: After filtering, processing ${filteredPlaylists.length} playlists (excluded ${
        playlists.length - filteredPlaylists.length
      })`
    );

    // Clear previous cached data for excluded playlists
    const oldCache = getPlaylistCache();

    // For each track in the old cache
    Object.entries(oldCache.tracks).forEach(([trackUri, playlistsArray]) => {
      // Filter out playlists that should be excluded
      const filteredPlaylistsForTrack = playlistsArray.filter(
        (playlist) =>
          // Keep "Liked Songs" and any playlists that aren't excluded
          playlist.id === "liked" || filteredPlaylists.some((p) => p.id === playlist.id)
      );

      // If there are still playlists for this track after filtering
      if (filteredPlaylistsForTrack.length > 0) {
        newCache.tracks[trackUri] = filteredPlaylistsForTrack;
      }
    });

    // Process filtered playlists
    let totalTracksProcessed = 0;
    let playlistsProcessed = 0;
    let localFilesFound = 0;

    // Process playlists one by one to avoid rate limits
    for (const playlist of filteredPlaylists) {
      // Skip very large playlists (optional)
      if (playlist.tracks.total > 1000) {
        console.log(
          `Tagify: Skipping large playlist ${playlist.name} with ${playlist.tracks.total} tracks`
        );
        continue;
      }

      try {
        if (playlistsProcessed % 50 === 0) {
          Spicetify.showNotification(
            `Refreshing playlist cache: ${playlistsProcessed}/${filteredPlaylists.length} playlists`
          );
        }

        // Get all tracks from this playlist including local files
        let tracksOffset = 0;
        let hasMoreTracks = true;

        while (hasMoreTracks) {
          // Add a delay to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Modified to include fields needed for both regular and local tracks
          const tracksResponse = await Spicetify.CosmosAsync.get(
            `https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100&offset=${tracksOffset}&fields=items(track(uri,name,artists,local)),next`
          );

          if (tracksResponse && tracksResponse.items && tracksResponse.items.length > 0) {
            // Process tracks
            tracksResponse.items.forEach((item: any) => {
              if (item.track && item.track.uri) {
                const trackUri = item.track.uri;
                const isLocalFile = trackUri.startsWith("spotify:local:");

                // Process both regular and local tracks
                if (!newCache.tracks[trackUri]) {
                  newCache.tracks[trackUri] = [];
                }

                // Check if playlist already exists for this track
                const existingIndex = newCache.tracks[trackUri].findIndex(
                  (p) => p.id === playlist.id
                );

                if (existingIndex === -1) {
                  newCache.tracks[trackUri].push({
                    id: playlist.id,
                    name: playlist.name,
                    owner: playlist.owner.id === userId ? "You" : playlist.owner.display_name,
                  });

                  if (isLocalFile) {
                    localFilesFound++;
                    console.log(
                      `Tagify: Found local file ${trackUri} in playlist ${playlist.name}`
                    );
                  }
                }
              }
            });

            totalTracksProcessed += tracksResponse.items.length;
            tracksOffset += tracksResponse.items.length;
            hasMoreTracks = tracksResponse.items.length === 100;
          } else {
            hasMoreTracks = false;
          }
        }

        playlistsProcessed++;
      } catch (error) {
        console.error(`Tagify: Error processing playlist ${playlist.name}:`, error);
      }
    }

    // Add Liked Songs information
    try {
      Spicetify.showNotification("Refreshing playlist cache: Processing Liked Songs");

      let likedOffset = 0;
      let hasMoreLiked = true;

      while (hasMoreLiked) {
        // Add a delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 100));

        const likedResponse = await Spicetify.CosmosAsync.get(
          `https://api.spotify.com/v1/me/tracks?limit=50&offset=${likedOffset}`
        );

        if (likedResponse && likedResponse.items && likedResponse.items.length > 0) {
          likedResponse.items.forEach((item: any) => {
            if (item.track && item.track.uri) {
              const trackUri = item.track.uri;

              // Add both regular and local tracks from Liked Songs
              if (!newCache.tracks[trackUri]) {
                newCache.tracks[trackUri] = [];
              }

              // Check if Liked Songs already exists for this track
              const existingIndex = newCache.tracks[trackUri].findIndex((p) => p.id === "liked");

              if (existingIndex === -1) {
                newCache.tracks[trackUri].push({
                  id: "liked",
                  name: "Liked Songs",
                  owner: "You",
                });
              }
            }
          });

          totalTracksProcessed += likedResponse.items.length;
          likedOffset += likedResponse.items.length;
          hasMoreLiked = likedResponse.items.length === 50;
        } else {
          hasMoreLiked = false;
        }
      }
    } catch (error) {
      console.error("Tagify: Error processing Liked Songs:", error);
    }

    // Save the new cache
    savePlaylistCache(newCache);

    console.log(
      `Tagify: Refreshed playlist cache with ${
        Object.keys(newCache.tracks).length
      } unique tracks (${localFilesFound} local files) across ${filteredPlaylists.length} playlists`
    );

    Spicetify.showNotification(
      `Playlist data refreshed: ${
        Object.keys(newCache.tracks).length
      } tracks (${localFilesFound} local) in ${filteredPlaylists.length} playlists`
    );

    return totalTracksProcessed;
  } catch (error) {
    console.error("Tagify: Error refreshing playlist cache:", error);
    Spicetify.showNotification("Error refreshing playlist data", true);
    return 0;
  }
}

// Check if the cache should be automatically updated (once per day)
export async function checkAndUpdateCacheIfNeeded(): Promise<void> {
  const cache = getPlaylistCache();
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  // If cache is empty or older than a day, update it
  if (Object.keys(cache.tracks).length === 0 || now - cache.lastUpdated > oneDayMs) {
    console.log("Tagify: Playlist cache is outdated, updating...");
    await refreshPlaylistCache();
  } else {
    console.log("Tagify: Playlist cache is up to date");
  }
}
