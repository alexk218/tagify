import { useEffect } from "react";
import {
  SpicetifyHistoryLocation,
  SpotifyArtist,
  SpotifyTrack,
  SpotifyTrackResponse,
} from "@/types/SpotifyTypes";
import { parseLocalFileUri } from "@/utils/LocalFileParser";

/**
 * Props for {@link useSpicetifyHistory}.
 */
export interface UseSpicetifyHistoryProps {
  /** Current multi-tagging state. */
  isMultiTagging: boolean;

  /** Setter for multi-tagging state. */
  setIsMultiTagging: (isMultiTagging: boolean) => void;

  /** Setter for the list of tracks to multi-tag. */
  setMultiTagTracks: (tracks: SpotifyTrack[]) => void;

  /** Setter for the currently locked single track. */
  setLockedTrack: (track: SpotifyTrack | null) => void;

  /** Setter for locked state. */
  setIsLocked: (isLocked: boolean) => void;

  /** Setter for the locked multi-track URI. */
  setLockedMultiTrackUri: (uri: string | null) => void;
}
/**
 * SPICETIFY HISTORY INTERGRATION HOOK
 *
 * @remarks
 * This hook **listens for navigation changes** in `Spicetify.Platform.History`
 * and extracts track URIs from URL parameters to initialize multi-track
 * tagging sessions.
 *
 * ### Responsibilities
 * - Monitor `Spicetify.Platform.History` for navigation changes.
 * - Parse track URIs from URL search params and navigation state.
 * - Fetch track metadata from the Spotify Web API - to populate MultiTrackDetails.
 *
 * ### Integration Flow
 * ```
 * extension.js → Spicetify.Platform.History.push()
 *              ↓
 * useSpicetifyHistory → detects URL change
 *                     ↓
 * setMultiTagTracks() → triggers MultiTrackDetails render
 * ```
 *
 * ### URL Formats
 * - Single track: `/tagify?uri=spotify%3Atrack%3A123`
 * - Multi track:  `/tagify?uris=%5B%22spotify%3Atrack%3A123%22%2C%22spotify%3Atrack%3A456%22%5D`
 *
 */
export function useSpicetifyHistory({
  isMultiTagging,
  setIsMultiTagging,
  setMultiTagTracks,
  setLockedTrack,
  setIsLocked,
  setLockedMultiTrackUri,
}: UseSpicetifyHistoryProps) {
  useEffect(() => {
    const checkForTrackUris = async () => {
      let trackUri = null;

      if (!trackUri && Spicetify.Platform.History.location) {
        const location = Spicetify.Platform.History
          .location as SpicetifyHistoryLocation;

        const historyParams = new URLSearchParams(location.search || "");
        if (historyParams.has("uri")) {
          trackUri = historyParams.get("uri");
        }

        // Also check state as fallback
        if (!trackUri && location.state?.trackUri) {
          trackUri = location.state.trackUri;
        }
      }

      // For multiple tracks
      let trackUris = null;

      if (Spicetify.Platform.History.location) {
        const location = Spicetify.Platform.History
          .location as SpicetifyHistoryLocation;

        if (
          location.state?.trackUris &&
          Array.isArray(location.state.trackUris)
        ) {
          trackUris = location.state.trackUris;
        }
      }

      // SINGLE TRACK HANDLING
      if (trackUri) {
        try {
          // Check if this is a local file
          if (trackUri.startsWith("spotify:local:")) {
            // Use our dedicated parser to get better metadata
            const parsedFile = parseLocalFileUri(trackUri);

            // Create a track object for local files
            const trackInfo: SpotifyTrack = {
              uri: trackUri,
              name: parsedFile.title,
              artists: [{ name: parsedFile.artist }],
              album: { name: parsedFile.album },
              duration_ms: 0,
            };

            // Lock to this track
            setLockedTrack(trackInfo);
            setIsLocked(true);

            return;
          }

          // Extract the track ID from the URI
          const trackId = trackUri.split(":").pop();

          if (!trackId) {
            throw new Error("Invalid track URI");
          }

          // Fetch track info using Spicetify's Cosmos API
          const response: SpotifyTrackResponse =
            await Spicetify.CosmosAsync.get(
              `https://api.spotify.com/v1/tracks/${trackId}`
            );

          if (response) {
            // Format the track info
            const trackInfo: SpotifyTrack = {
              uri: trackUri,
              name: response.name,
              artists: response.artists.map((artist: SpotifyArtist) => ({
                name: artist.name,
              })),
              album: { name: response.album?.name || "Unknown Album" },
              duration_ms: response.duration_ms,
            };

            // Set as locked track and enable lock - IMPORTANT!
            setLockedTrack(trackInfo);
            setIsLocked(true);

            // Reset multi-tagging if active
            if (isMultiTagging) {
              setMultiTagTracks([]);
              setIsMultiTagging(false);
            }
          }
        } catch (error) {
          console.error(
            "Tagify: Error loading track from URI parameter:",
            error
          );
          Spicetify.showNotification("Error loading track for tagging", true);
        }
      }
      // MULTI-TRACK HANDLING
      else if (trackUris) {
        try {
          if (!Array.isArray(trackUris) || trackUris.length === 0) {
            throw new Error("Invalid track URIs format");
          }

          // IMMEDIATE STATE TRANSITION - Set multi-tagging state immediately
          setIsMultiTagging(true);
          setIsLocked(false);
          setLockedMultiTrackUri(null);

          // Create placeholder tracks immediately for instant UI rendering
          const placeholderTracks: SpotifyTrack[] = trackUris.map((uri) => ({
            uri,
            name: "Loading...",
            artists: [{ name: "Loading..." }],
            album: { name: "Loading..." },
            duration_ms: 0,
          }));

          // Set placeholder tracks immediately - this triggers MultiTrackDetails to render
          setMultiTagTracks(placeholderTracks);

          // ASYNC TRACK DATA FETCHING - Now fetch the real data in the background
          const fetchTrackData = async () => {
            const currentTracks = [...placeholderTracks];

            for (const uri of trackUris) {
              try {
                let updatedTrack: SpotifyTrack;

                // Handle local files
                if (uri.startsWith("spotify:local:")) {
                  const parsedFile = parseLocalFileUri(uri);
                  updatedTrack = {
                    uri,
                    name: parsedFile.title,
                    artists: [{ name: parsedFile.artist }],
                    album: { name: parsedFile.album },
                    duration_ms: 0,
                  };
                } else {
                  // For Spotify tracks
                  const trackId = uri.split(":").pop();
                  if (!trackId) continue;

                  const response: SpotifyTrackResponse =
                    await Spicetify.CosmosAsync.get(
                      `https://api.spotify.com/v1/tracks/${trackId}`
                    );

                  if (response) {
                    updatedTrack = {
                      uri,
                      name: response.name,
                      artists: response.artists.map(
                        (artist: SpotifyArtist) => ({
                          name: artist.name,
                        })
                      ),
                      album: { name: response.album?.name || "Unknown Album" },
                      duration_ms: response.duration_ms,
                    };
                  } else {
                    continue;
                  }
                }

                const trackIndex = currentTracks.findIndex(
                  (track) => track.uri === uri
                );
                if (trackIndex !== -1) {
                  currentTracks[trackIndex] = updatedTrack;

                  setMultiTagTracks([...currentTracks]);
                }
              } catch (error) {
                console.error(`Tagify: Error fetching track ${uri}:`, error);
                const errorTrack: SpotifyTrack = {
                  uri,
                  name: "Failed to load",
                  artists: [{ name: "Error" }],
                  album: { name: "Error" },
                  duration_ms: 0,
                };
                const trackIndex = currentTracks.findIndex(
                  (track) => track.uri === uri
                );
                if (trackIndex !== -1) {
                  currentTracks[trackIndex] = errorTrack;
                  setMultiTagTracks([...currentTracks]);
                }
              }
            }
          };

          // Start the async fetching (don't await - let it run in background)
          fetchTrackData().catch((error) => {
            console.error("Tagify: Error in async track data fetching:", error);
            Spicetify.showNotification("Error loading some tracks", true);
          });
        } catch (error) {
          console.error("Tagify: Error processing track URIs:", error);
          Spicetify.showNotification("Error loading tracks for tagging", true);
        }
      }
    };

    // Run the check immediately when component mounts
    checkForTrackUris();

    // Set up better history listener
    let unlisten: (() => void) | null = null;

    // Before setting up the listener, check if there's a proper listen method available
    if (
      Spicetify.Platform &&
      Spicetify.Platform.History &&
      typeof Spicetify.Platform.History.listen === "function"
    ) {
      try {
        //
        /**
         * Try to set up the listener and get the unlisten function
         * Spicetify's listen() returns an unlisten cleanup function - behaves like React Router's history.listen()
         * listen(callback) - registers the callback -> to be triggered when ROUTE/PATH changes
         */
        const unlistenFunc = Spicetify.Platform.History.listen(() => {
          checkForTrackUris();
        });

        // Check if the returned value is a function (as it should be)
        if (typeof unlistenFunc === "function") {
          unlisten = unlistenFunc;
        } else {
          console.warn(
            "Tagify: History.listen did not return a cleanup function"
          );
          unlisten = () => {
            console.log("Tagify: Using fallback cleanup for history listener");
          };
        }
      } catch (error) {
        console.error("Tagify: Error setting up history listener:", error);
      }
    }

    // Cleanup listener on unmount
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);
}
