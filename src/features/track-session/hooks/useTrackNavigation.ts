import { useCallback } from "react";
import { SpotifyTrack } from "@/types/SpotifyTypes";
import { spotifyService } from "@/services/SpotifyService";

interface UseTrackNavigationOptions {
  displayedTrack: SpotifyTrack;
  contextUri: string | null;
  sourceContext: string | null;
}

export function useTrackNavigation({
  displayedTrack,
  contextUri,
  sourceContext,
}: UseTrackNavigationOptions) {
  const navigateToAlbum = useCallback(async (): Promise<void> => {
    try {
      if (displayedTrack.uri.startsWith("spotify:local:")) {
        Spicetify.Platform.History.push("/collection/local-files");
        return;
      }

      if (Spicetify.Player.data?.item?.uri === displayedTrack.uri) {
        const albumUri = Spicetify.Player.data.item.album?.uri;
        if (albumUri) {
          const albumId = albumUri.split(":").pop();
          if (albumId) {
            Spicetify.Platform.History.push(`/album/${albumId}`);
            return;
          }
        }
      }

      const albumUri = await spotifyService.getTrackAlbumUri(displayedTrack.uri);
      if (albumUri) {
        const albumId = albumUri.split(":").pop();
        if (albumId) {
          Spicetify.Platform.History.push(`/album/${albumId}`);
          return;
        }
      }

      Spicetify.showNotification("Couldn't navigate to album", true);
    } catch (error) {
      console.error("Error navigating to album:", error);
      Spicetify.showNotification("Error navigating to album", true);
    }
  }, [displayedTrack.uri]);

  const navigateToArtist = useCallback(
    async (artistName: string): Promise<void> => {
      try {
        if (displayedTrack.uri.startsWith("spotify:local:")) {
          Spicetify.showNotification(
            "Cannot navigate to artist for local files",
            true,
          );
          return;
        }

        const artists = await spotifyService.getTrackArtists(displayedTrack.uri);
        const artist = artists.find((item) => item.name === artistName);

        if (artist?.uri) {
          const artistId = artist.uri.split(":").pop();
          if (artistId) {
            Spicetify.Platform.History.push(`/artist/${artistId}`);
            return;
          }
        }

        Spicetify.Platform.History.push(
          `/search/${encodeURIComponent(artistName)}/artists`,
        );
      } catch (error) {
        console.error("Error navigating to artist:", error);
        Spicetify.Platform.History.push(
          `/search/${encodeURIComponent(artistName)}/artists`,
        );
      }
    },
    [displayedTrack.uri],
  );

  const navigateToContext = useCallback((): void => {
    if (sourceContext === "Local Files") {
      Spicetify.Platform.History.push("/collection/local-files");
      return;
    }

    if (!contextUri) {
      Spicetify.showNotification("No context available to navigate to", true);
      return;
    }

    try {
      const parts = contextUri.split(":");
      if (parts.length < 3) {
        Spicetify.showNotification("Invalid context URI", true);
        return;
      }

      const contextType = parts[1];
      const contextId = parts[2];

      switch (contextType) {
        case "playlist":
          Spicetify.Platform.History.push(`/playlist/${contextId}`);
          break;
        case "album":
          Spicetify.Platform.History.push(`/album/${contextId}`);
          break;
        case "artist":
          Spicetify.Platform.History.push(`/artist/${contextId}`);
          break;
        case "show":
          Spicetify.Platform.History.push(`/show/${contextId}`);
          break;
        case "collection":
          if (parts.includes("tracks")) {
            Spicetify.Platform.History.push("/collection/tracks");
          }
          break;
        case "user":
          Spicetify.Platform.History.push("/collection/tracks");
          break;
        default:
          console.log(`Unsupported context type: ${contextType}`);
          Spicetify.showNotification(`Cannot navigate to ${contextType}`, true);
      }
    } catch (error) {
      console.error("Error navigating to context:", error);
      Spicetify.showNotification("Error navigating to context", true);
    }
  }, [contextUri, sourceContext]);

  return {
    navigateToAlbum,
    navigateToArtist,
    navigateToContext,
  };
}
