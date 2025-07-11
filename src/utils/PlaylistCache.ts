import { shouldExcludePlaylist } from "./PlaylistSettings";

interface PlaylistInfo {
  id: string;
  name: string;
  owner: string;
}

interface PlaylistCache {
  tracks: Record<string, PlaylistInfo[]>;
  lastUpdated: number; // timestamp
  playlistSnapshots?: Record<string, string>;
  lastIncrementalUpdate?: number;
  lastLikedSongsSync?: number;
}

const PLAYLIST_CACHE_KEY = "tagify:playlistCache";

export function getPlaylistCache(): PlaylistCache {
  try {
    const cacheString = localStorage.getItem(PLAYLIST_CACHE_KEY);
    if (cacheString) {
      const cache = JSON.parse(cacheString);
      // Ensure new properties exist
      if (!cache.playlistSnapshots) {
        cache.playlistSnapshots = {};
      }
      if (!cache.lastIncrementalUpdate) {
        cache.lastIncrementalUpdate = 0;
      }
      if (!cache.lastLikedSongsSync) {
        cache.lastLikedSongsSync = 0;
      }
      return cache;
    }
  } catch (error) {
    console.error("Tagify: Error reading playlist cache:", error);
  }

  return {
    tracks: {},
    lastUpdated: 0,
    playlistSnapshots: {},
    lastIncrementalUpdate: 0,
    lastLikedSongsSync: 0,
  };
}

export function savePlaylistCache(cache: PlaylistCache): void {
  try {
    localStorage.setItem(PLAYLIST_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Tagify: Error saving playlist cache:", error);
  }
}

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

    cache.lastUpdated = Date.now();
    savePlaylistCache(cache);
  }
}

export function getPlaylistsContainingTrack(trackUri: string): PlaylistInfo[] {
  const cache = getPlaylistCache();
  return cache.tracks[trackUri] || [];
}

async function getAllPlaylistsWithSnapshots(): Promise<
  Array<{
    id: string;
    name: string;
    snapshot_id: string;
    owner: { id: string; display_name: string };
    description?: string;
  }>
> {
  const playlists: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await Spicetify.CosmosAsync.get(
      `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}&fields=items(id,name,snapshot_id,owner,description),next`
    );

    if (response && response.items && response.items.length > 0) {
      playlists.push(...response.items);
      offset += response.items.length;
      hasMore = !!response.next;
    } else {
      hasMore = false;
    }
  }

  return playlists;
}

function removePlaylistFromCache(cache: PlaylistCache, playlistId: string): void {
  Object.keys(cache.tracks).forEach((trackUri) => {
    cache.tracks[trackUri] = cache.tracks[trackUri].filter(
      (playlist) => playlist.id !== playlistId
    );

    // Remove track entry if it has no playlists left
    if (cache.tracks[trackUri].length === 0) {
      delete cache.tracks[trackUri];
    }
  });
}

// Process a single changed playlist (without filtering since already filtered)
async function processChangedPlaylistNoFilter(
  cache: PlaylistCache,
  playlist: any,
  userId: string
): Promise<number> {
  let tracksProcessed = 0;

  try {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/playlists/${playlist.id}/tracks?limit=100&offset=${offset}&fields=items(track(uri)),next`
      );

      if (response && response.items && response.items.length > 0) {
        response.items.forEach((item: any) => {
          if (item.track && item.track.uri) {
            const trackUri = item.track.uri;

            if (!cache.tracks[trackUri]) {
              cache.tracks[trackUri] = [];
            }

            // Add playlist info (avoid duplicates)
            const existingIndex = cache.tracks[trackUri].findIndex((p) => p.id === playlist.id);
            if (existingIndex === -1) {
              cache.tracks[trackUri].push({
                id: playlist.id,
                name: playlist.name,
                owner: playlist.owner.id === userId ? "You" : playlist.owner.display_name,
              });
            }

            tracksProcessed++;
          }
        });

        offset += response.items.length;
        hasMore = !!response.next;
      } else {
        hasMore = false;
      }

      // Small delay between pages
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    return tracksProcessed;
  } catch (error) {
    console.error(`Error processing playlist ${playlist.name}:`, error);
    return 0;
  }
}

async function processLikedSongs(
  cache: PlaylistCache,
  forceFullSync: boolean = false
): Promise<number> {
  try {
    const now = Date.now();
    const lastSync = cache.lastLikedSongsSync || 0;
    const isFirstSync = lastSync === 0;

    if (isFirstSync || forceFullSync) {
      // Remove all existing "liked" entries first for full sync
      Object.keys(cache.tracks).forEach((trackUri) => {
        cache.tracks[trackUri] = cache.tracks[trackUri].filter((p) => p.id !== "liked");
        if (cache.tracks[trackUri].length === 0) {
          delete cache.tracks[trackUri];
        }
      });
    } else {
      Spicetify.showNotification("Processing Liked Songs (checking for new additions)");
    }

    let offset = 0;
    let hasMore = true;
    let tracksProcessed = 0;
    const lastSyncDate = new Date(lastSync);

    while (hasMore) {
      const response = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset}&fields=items(added_at,track(uri)),next`
      );

      if (response && response.items && response.items.length > 0) {
        let foundOldTrack = false;

        for (const item of response.items) {
          if (item.track && item.track.uri && item.added_at) {
            const addedAt = new Date(item.added_at);

            if (!isFirstSync && !forceFullSync && addedAt <= lastSyncDate) {
              foundOldTrack = true;
              break;
            }

            const trackUri = item.track.uri;

            if (!cache.tracks[trackUri]) {
              cache.tracks[trackUri] = [];
            }

            // Check if Liked Songs already exists for this track
            const existingIndex = cache.tracks[trackUri].findIndex((p) => p.id === "liked");

            if (existingIndex === -1) {
              cache.tracks[trackUri].push({
                id: "liked",
                name: "Liked Songs",
                owner: "You",
              });
            }

            tracksProcessed++;
          }
        }

        // If we found an old track during incremental sync, stop pagination
        if (foundOldTrack) {
          hasMore = false;
        } else {
          offset += response.items.length;
          hasMore = response.items.length === 50 && response.next;
        }
      } else {
        hasMore = false;
      }

      // Small delay to be respectful to API
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    // Update the last sync timestamp
    cache.lastLikedSongsSync = now;

    return tracksProcessed;
  } catch (error) {
    console.error("Tagify: Error processing Liked Songs:", error);
    return 0;
  }
}

export async function incrementalRefreshPlaylistCache(): Promise<number> {
  try {
    const cache = getPlaylistCache();
    const now = Date.now();

    // Get user profile
    const userProfile = await Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me");
    const userId = userProfile.id;

    if (!userId) {
      throw new Error("Could not get user ID");
    }

    Spicetify.showNotification("Checking for playlist changes...");
    const allPlaylists = await getAllPlaylistsWithSnapshots();

    const filteredPlaylists = allPlaylists.filter(
      (playlist) =>
        !shouldExcludePlaylist(
          playlist.id,
          playlist.name,
          playlist.owner.id,
          playlist.description || "",
          userId
        )
    );

    const changedPlaylists = filteredPlaylists.filter((playlist) => {
      const lastSnapshot = cache.playlistSnapshots![playlist.id];
      return !lastSnapshot || lastSnapshot !== playlist.snapshot_id;
    });

    if (changedPlaylists.length === 0) {
      // Still update Liked Songs as it doesn't have a snapshot_id
      const likedTracksProcessed = await processLikedSongs(cache, false);

      cache.lastIncrementalUpdate = now;
      savePlaylistCache(cache);

      Spicetify.showNotification(
        `Quick refresh complete - no playlist changes (checked ${likedTracksProcessed} liked songs)`
      );
      return likedTracksProcessed;
    }

    let totalTracksProcessed = 0;

    for (let i = 0; i < changedPlaylists.length; i++) {
      const playlist = changedPlaylists[i];

      try {
        // Remove old entries for this playlist
        removePlaylistFromCache(cache, playlist.id);

        // Add new entries (no need to filter again since we already filtered)
        const trackCount = await processChangedPlaylistNoFilter(cache, playlist, userId);
        totalTracksProcessed += trackCount;

        cache.playlistSnapshots![playlist.id] = playlist.snapshot_id;
      } catch (error) {
        console.error(`Error processing changed playlist ${playlist.name}:`, error);
      }
    }

    const likedTracksProcessed = await processLikedSongs(cache, false);
    totalTracksProcessed += likedTracksProcessed;

    // Clean up deleted playlists (check against filtered playlists)
    const currentFilteredPlaylistIds = new Set(filteredPlaylists.map((p) => p.id));
    Object.keys(cache.playlistSnapshots!).forEach((playlistId) => {
      if (!currentFilteredPlaylistIds.has(playlistId)) {
        removePlaylistFromCache(cache, playlistId);
        delete cache.playlistSnapshots![playlistId];
      }
    });

    // Update cache timestamps and save
    cache.lastUpdated = now;
    cache.lastIncrementalUpdate = now;
    savePlaylistCache(cache);

    Spicetify.showNotification(
      `Quick refresh complete: ${changedPlaylists.length} changed playlists (${totalTracksProcessed} tracks processed)`
    );

    return totalTracksProcessed;
  } catch (error) {
    console.error("Error in incremental playlist refresh:", error);
    Spicetify.showNotification("Error during quick refresh", true);
    return 0;
  }
}

export async function fullRefreshPlaylistCache(): Promise<number> {
  try {
    // Get user profile
    const userProfile = await Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me");
    const userId = userProfile.id;

    if (!userId) {
      throw new Error("Could not get user ID");
    }

    const newCache: PlaylistCache = {
      tracks: {},
      lastUpdated: Date.now(),
      playlistSnapshots: {},
      lastIncrementalUpdate: Date.now(),
      lastLikedSongsSync: 0,
    };

    // Get all user's playlists
    const playlists: Array<{
      id: string;
      name: string;
      owner: { id: string; display_name: string };
      tracks: { total: number };
      description: string;
      snapshot_id: string;
    }> = [];

    let offset = 0;
    let hasMore = true;

    // Fetch all playlists
    while (hasMore) {
      const response = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}&fields=items(id,name,owner,tracks.total,description,snapshot_id)`
      );

      if (response && response.items && response.items.length > 0) {
        playlists.push(...response.items);
        offset += response.items.length;
        hasMore = response.items.length === 50;
      } else {
        hasMore = false;
      }
    }

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

    // Process filtered playlists
    let totalTracksProcessed = 0;
    let localFilesFound = 0;

    // Process playlists one by one to avoid rate limits
    for (const playlist of filteredPlaylists) {
      // Skip very large playlists
      if (playlist.tracks.total > 1000) {
        continue;
      }

      try {
        // Get all tracks from this playlist including local files
        let tracksOffset = 0;
        let hasMoreTracks = true;

        while (hasMoreTracks) {
          // Add a delay to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 100));

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

        // Store the snapshot_id for this playlist
        newCache.playlistSnapshots![playlist.id] = playlist.snapshot_id;
      } catch (error) {
        console.error(`Tagify: Error processing playlist ${playlist.name}:`, error);
      }
    }

    // Add Liked Songs information (using optimized processing)
    try {
      const likedTracksProcessed = await processLikedSongs(newCache, true); // Force full sync
      totalTracksProcessed += likedTracksProcessed;
    } catch (error) {
      console.error("Tagify: Error processing Liked Songs:", error);
    }

    // Save the new cache
    savePlaylistCache(newCache);

    Spicetify.showNotification(
      `Full refresh complete: ${
        Object.keys(newCache.tracks).length
      } tracks (${localFilesFound} local) in ${filteredPlaylists.length} playlists`
    );

    return totalTracksProcessed;
  } catch (error) {
    console.error("Tagify: Error in full playlist refresh:", error);
    Spicetify.showNotification("Error during full refresh", true);
    return 0;
  }
}

// Check if the cache should be automatically updated (once per day)
export async function checkAndUpdateCacheIfNeeded(): Promise<void> {
  const cache = getPlaylistCache();
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sixHoursMs = 6 * 60 * 60 * 1000;

  // If cache is empty or older than a day, do a full update
  if (Object.keys(cache.tracks).length === 0 || now - cache.lastUpdated > oneDayMs) {
    await fullRefreshPlaylistCache();
  }
  // If cache exists but incremental update is old (6 hours), do incremental update
  else if (now - (cache.lastIncrementalUpdate || 0) > sixHoursMs) {
    await incrementalRefreshPlaylistCache();
  }
}
