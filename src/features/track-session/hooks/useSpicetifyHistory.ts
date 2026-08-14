import { useEffect } from "react";
import { spotifyService } from "@/services/SpotifyService";
import { SpicetifyHistoryLocation, SpotifyTrack } from "@/types/SpotifyTypes";
import {
  createFailedSpotifyTrack,
  createLoadingSpotifyTrack,
  createLocalSpotifyTrack,
  createSpotifyTrackFromTrackInfo,
} from "@/features/track-session/utils/trackSession.mappers";
import {
  parseHistoryTrackSelection,
} from "@/features/track-session/utils/spicetifyHistory.location";
import { UseSpicetifyHistoryProps } from "@/features/track-session/model/useSpicetifyHistory.types";

function isHistoryListenAvailable(): boolean {
  return Boolean(
    Spicetify.Platform &&
      Spicetify.Platform.History &&
      typeof Spicetify.Platform.History.listen === "function",
  );
}

export function useSpicetifyHistory({
  isMultiTagging,
  setIsMultiTagging,
  setMultiTagTracks,
  setLockedTrack,
  setIsLocked,
  setLockedMultiTrackUri,
  onSelectTrack,
  onSelectPlaylist,
  onSelectArtist,
}: UseSpicetifyHistoryProps) {
  useEffect(() => {
    const checkForTrackUris = async () => {
      const location = Spicetify.Platform.History
        .location as SpicetifyHistoryLocation;

      const { trackUri, trackUris, playlistUri, artistUri } =
        parseHistoryTrackSelection(location);

      if (artistUri) {
        onSelectArtist?.(artistUri);
        setIsMultiTagging(false);
        setMultiTagTracks([]);
        setLockedMultiTrackUri(null);
        return;
      }

      if (playlistUri) {
        onSelectPlaylist?.(playlistUri);
        setIsMultiTagging(false);
        setMultiTagTracks([]);
        setLockedMultiTrackUri(null);
        return;
      }

      if (trackUri) {
        onSelectTrack?.();

        try {
          if (trackUri.startsWith("spotify:local:")) {
            setLockedTrack(createLocalSpotifyTrack(trackUri));
            setIsLocked(true);
            return;
          }

          const trackData = await spotifyService.getTrack(trackUri);

          if (trackData) {
            setLockedTrack(createSpotifyTrackFromTrackInfo(trackUri, trackData));
            setIsLocked(true);

            if (isMultiTagging) {
              setMultiTagTracks([]);
              setIsMultiTagging(false);
            }
          }
        } catch (error) {
          console.error("Tagify: Error loading track from URI parameter:", error);
          Spicetify.showNotification("Error loading track for tagging", true);
        }
        return;
      }

      if (!trackUris) {
        return;
      }

      try {
        onSelectTrack?.();

        if (trackUris.length === 0) {
          throw new Error("Invalid track URIs format");
        }

        setIsMultiTagging(true);
        setIsLocked(false);
        setLockedMultiTrackUri(null);

        const placeholderTracks: SpotifyTrack[] = trackUris.map((uri) =>
          createLoadingSpotifyTrack(uri),
        );

        setMultiTagTracks(placeholderTracks);

        const fetchTrackData = async () => {
          const currentTracks = [...placeholderTracks];

          for (const uri of trackUris) {
            try {
              let updatedTrack: SpotifyTrack;

              if (uri.startsWith("spotify:local:")) {
                updatedTrack = createLocalSpotifyTrack(uri);
              } else {
                const trackData = await spotifyService.getTrack(uri);
                if (!trackData) {
                  continue;
                }

                updatedTrack = createSpotifyTrackFromTrackInfo(uri, trackData);
              }

              const trackIndex = currentTracks.findIndex(
                (track) => track.uri === uri,
              );

              if (trackIndex !== -1) {
                currentTracks[trackIndex] = updatedTrack;
                setMultiTagTracks([...currentTracks]);
              }
            } catch (error) {
              console.error(`Tagify: Error fetching track ${uri}:`, error);

              const trackIndex = currentTracks.findIndex(
                (track) => track.uri === uri,
              );

              if (trackIndex !== -1) {
                currentTracks[trackIndex] = createFailedSpotifyTrack(uri);
                setMultiTagTracks([...currentTracks]);
              }
            }
          }
        };

        fetchTrackData().catch((error) => {
          console.error("Tagify: Error in async track data fetching:", error);
          Spicetify.showNotification("Error loading some tracks", true);
        });
      } catch (error) {
        console.error("Tagify: Error processing track URIs:", error);
        Spicetify.showNotification("Error loading tracks for tagging", true);
      }
    };

    void checkForTrackUris();

    let unlisten: (() => void) | null = null;

    if (isHistoryListenAvailable()) {
      try {
        const unlistenFunc = Spicetify.Platform.History.listen(() => {
          void checkForTrackUris();
        });

        if (typeof unlistenFunc === "function") {
          unlisten = unlistenFunc;
        } else {
          console.warn("Tagify: History.listen did not return a cleanup function");
          unlisten = () => {
            console.log("Tagify: Using fallback cleanup for history listener");
          };
        }
      } catch (error) {
        console.error("Tagify: Error setting up history listener:", error);
      }
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);
}
