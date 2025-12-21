import { useState } from "react";

export function usePlaylistState() {
  const [showLocalTracksModal, setShowLocalTracksModal] = useState(false);
  const [localTracksForPlaylist, setLocalTracksForPlaylist] = useState<string[]>([]);
  const [createdPlaylistInfo, setCreatedPlaylistInfo] = useState<{
    name: string;
    id: string | null;
  }>({ name: "", id: null });

  const createPlaylistFromFilters = async (
    trackUris: string[],
    playlistName: string,
    playlistDescription: string,
    isPublic: boolean,
    isSmartPlaylist: boolean
  ): Promise<string | null> => {
    if (trackUris.length === 0) {
      Spicetify.showNotification("No tracks to add to playlist", true);
      return null;
    }

    const type = isSmartPlaylist ? "smart playlist" : "playlist";

    try {
      const userProfile = await Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me");
      const userId = userProfile.id;

      if (!userId) {
        throw new Error("Could not get user ID");
      }

      const spotifyTrackUris = trackUris.filter((uri) => !uri.startsWith("spotify:local:"));
      const localTrackUris = trackUris.filter((uri) => uri.startsWith("spotify:local:"));

      // Create the playlist
      const playlistResponse = await Spicetify.CosmosAsync.post(
        `https://api.spotify.com/v1/users/${userId}/playlists`,
        {
          name: playlistName,
          description: playlistDescription,
          public: isPublic,
        }
      );

      const playlistId = playlistResponse.id;

      if (!playlistId) {
        throw new Error("Failed to create playlist");
      }

      // Add tracks to the playlist in batches of 100 (API limit)
      for (let i = 0; i < spotifyTrackUris.length; i += 100) {
        const batch = spotifyTrackUris.slice(i, Math.min(i + 100, spotifyTrackUris.length));
        await Spicetify.CosmosAsync.post(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          {
            uris: batch,
          }
        );
      }

      if (localTrackUris.length > 0) {
        // For LocalTracksModal - store the created playlist info
        setCreatedPlaylistInfo({
          name: playlistName,
          id: playlistId,
        });
        setLocalTracksForPlaylist(localTrackUris);

        Spicetify.showNotification(
          `Created ${type} "${playlistName}" with ${spotifyTrackUris.length} tracks. Local tracks need to be added manually.`
        );

        // Show modal with local tracks instructions
        setShowLocalTracksModal(true);
        return playlistId;
      } else {
        Spicetify.showNotification(
          `Created ${type} "${playlistName}" with ${spotifyTrackUris.length} tracks.`
        );
      }
      // Navigate to the newly created playlist
      Spicetify.Platform.History.push(`/playlist/${playlistId}`);
      return playlistId;
    } catch (error) {
      console.error("Error creating playlist:", error);
      Spicetify.showNotification("Failed to create playlist. Please try again.", true);
      return null;
    }
  };

  return {
    showLocalTracksModal,
    setShowLocalTracksModal,
    localTracksForPlaylist,
    setLocalTracksForPlaylist,
    createdPlaylistInfo,
    setCreatedPlaylistInfo,
    createPlaylistFromFilters,
  };
}
