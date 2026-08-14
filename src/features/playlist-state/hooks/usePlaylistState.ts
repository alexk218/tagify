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
    if (trackUris.length === 0) {
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

      let playlistUri: string | null = null;
      let playlistId: string | null = null;

      if (
        typeof (Spicetify.Platform.RootlistAPI as any).createPlaylist ===
        "function"
      ) {
        const result = await (
          Spicetify.Platform.RootlistAPI as any
        ).createPlaylist(playlistName, { before: "start" });
        playlistUri = typeof result === "string" ? result : result?.uri;
      } else {
        const accessToken =
          Spicetify.Platform.AuthorizationAPI?.getState?.()?.token
            ?.accessToken ||
          (Spicetify.Platform.PlaylistAPI as any)?._builder?._accessToken;

        const userId = Spicetify.Platform.username;

        if (!accessToken || !userId) {
          throw new Error("Could not get access token or username");
        }

        const createResponse = await fetch(
          `https://api.spotify.com/v1/users/${userId}/playlists`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: playlistName,
              description: playlistDescription,
              public: isPublic,
            }),
          },
        );

        if (!createResponse.ok) {
          throw new Error(
            `Failed to create playlist: ${createResponse.status}`,
          );
        }

        const playlistData = await createResponse.json();
        playlistId = playlistData.id;
        playlistUri = `spotify:playlist:${playlistId}`;
      }

      if (!playlistUri) {
        throw new Error("Failed to create playlist");
      }

      if (!playlistId) {
        playlistId = playlistUri.split(":").pop() || null;
      }

      if (!playlistId) {
        throw new Error("Failed to get playlist ID");
      }

      if (spotifyTrackUris.length > 0) {
        for (let index = 0; index < spotifyTrackUris.length; index += 100) {
          const batch = spotifyTrackUris.slice(index, index + 100);
          await (Spicetify.Platform.PlaylistAPI as any).add(
            playlistUri,
            batch,
            { after: "end" },
          );
        }
      }

      if (localTrackUris.length > 0) {
        setCreatedPlaylistInfo({
          name: playlistName,
          id: playlistId,
        });
        setLocalTracksForPlaylist(localTrackUris);

        Spicetify.showNotification(
          `Created ${type} "${playlistName}" with ${spotifyTrackUris.length} tracks. Local tracks need to be added manually.`,
        );

        setShowLocalTracksModal(true);
        return playlistId;
      }

      Spicetify.showNotification(
        `Created ${type} "${playlistName}" with ${spotifyTrackUris.length} tracks.`,
      );

      Spicetify.Platform.History.push(`/playlist/${playlistId}`);
      return playlistId;
    } catch (error) {
      console.error("Error creating playlist:", error);
      Spicetify.showNotification(
        "Failed to create playlist. Please try again.",
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
