import { spotifyWrite } from "@/services/SpotifyRequests";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { useState } from "react";

export interface CreatedPlaylistInfo {
  name: string;
  id: string | null;
}

export function usePlaylistState() {
  const [showLocalTracksModal, setShowLocalTracksModal] = useState(false);
  const [localTracksForPlaylist, setLocalTracksForPlaylist] = useState<
    string[]
  >([]);
  const [createdPlaylistInfo, setCreatedPlaylistInfo] =
    useState<CreatedPlaylistInfo>({ name: "", id: null });

  const createPlaylistFromFilters = async (
    trackUris: string[],
    playlistName: string,
    playlistDescription: string,
    isPublic: boolean,
    isSmartPlaylist: boolean,
  ): Promise<string | null> => {
    if (trackUris.length === 0 && !isSmartPlaylist) {
      Spicetify.showNotification("No tracks to add to playlist", true);
      return null;
    }

    const type = isSmartPlaylist ? "smart playlist" : "playlist";

    try {
      const spotifyTrackUris = trackUris.filter(
        (uri) => !uri.startsWith("spotify:local:"),
      );
      const localTrackUris = trackUris.filter((uri) =>
        uri.startsWith("spotify:local:"),
      );

      const playlistId = await spotifyApiService.createPlaylist(playlistName, { description: playlistDescription, isPublic });
      const playlistUri = `spotify:playlist:${playlistId}`;

      if (spotifyTrackUris.length > 0) {
        for (let index = 0; index < spotifyTrackUris.length; index += 100) {
          const batch = spotifyTrackUris.slice(index, index + 100);
          await spotifyWrite(() => (Spicetify.Platform.PlaylistAPI as any).add(
            playlistUri,
            batch,
            { after: "end" },
          ));
        }
      }

      if (localTrackUris.length > 0) {
        setCreatedPlaylistInfo({
          name: playlistName,
          id: playlistId,
        });
        setLocalTracksForPlaylist(localTrackUris);

        if (!isSmartPlaylist) {
          Spicetify.showNotification(
            `Created ${type} "${playlistName}" with ${spotifyTrackUris.length} ${spotifyTrackUris.length === 1 ? "track" : "tracks"}. Local tracks need to be added manually.`,
          );
        }

        setShowLocalTracksModal(true);
        return playlistId;
      }

      if (!isSmartPlaylist) {
        Spicetify.showNotification(
          `Created ${type} "${playlistName}" with ${spotifyTrackUris.length} ${spotifyTrackUris.length === 1 ? "track" : "tracks"}.`,
        );
      }

      if (!isSmartPlaylist) {
        Spicetify.Platform.History.push(`/playlist/${playlistId}`);
      }
      return playlistId;
    } catch (error) {
      console.error("Error creating playlist:", error);
      Spicetify.showNotification(
        // Playlist creation explains its own failures in plain language.
        error instanceof Error && error.message.startsWith("Spotify") ? error.message : "Failed to create playlist. Please try again.",
        true,
      );
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
