import { spotifyWrite } from "@/services/SpotifyRequests";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { useState } from "react";
import { notePlaylistMade } from "@/features/onboarding/howToTips";
import { addableHere, isLocalFileUri, localFileAddsAvailable, stopLocalFileAdds } from "@/services/localFilesOnThisComputer";

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
      const playlistId = await spotifyApiService.createPlaylist(playlistName, { description: playlistDescription, isPublic });
      const playlistUri = `spotify:playlist:${playlistId}`;

      // Local files this computer's Spotify lists are added like any song; only the rest
      // (files on another computer, or ones Spotify refused) are left to add by hand.
      const { addable } = await addableHere(trackUris);
      const catalogUris = addable.filter((uri) => !isLocalFileUri(uri));
      const localUris = addable.filter(isLocalFileUri);
      const added: string[] = [];
      const addBatches = async (uris: string[]) => {
        for (let index = 0; index < uris.length; index += 100) {
          const batch = uris.slice(index, index + 100);
          await spotifyWrite(() => (Spicetify.Platform.PlaylistAPI as any).add(
            playlistUri,
            batch,
            { after: "end" },
          ), { resource: playlistUri });
          added.push(...batch);
        }
      };
      await addBatches(catalogUris);
      if (localUris.length && localFileAddsAvailable()) {
        try {
          await addBatches(localUris);
        } catch (error) {
          stopLocalFileAdds(error);
        }
      }
      const addedSet = new Set(added);
      const localTrackUris = trackUris.filter((uri) => isLocalFileUri(uri) && !addedSet.has(uri));
      const addedCount = added.length;

      if (!isSmartPlaylist) notePlaylistMade();

      if (localTrackUris.length > 0) {
        setCreatedPlaylistInfo({
          name: playlistName,
          id: playlistId,
        });
        setLocalTracksForPlaylist(localTrackUris);

        if (!isSmartPlaylist) {
          Spicetify.showNotification(
            `Created ${type} "${playlistName}" with ${addedCount} ${addedCount === 1 ? "track" : "tracks"}. Local tracks need to be added manually.`,
          );
        }

        setShowLocalTracksModal(true);
        return playlistId;
      }

      if (!isSmartPlaylist) {
        Spicetify.showNotification(
          `Created ${type} "${playlistName}" with ${addedCount} ${addedCount === 1 ? "track" : "tracks"}.`,
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
