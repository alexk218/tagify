import { useEffect } from "react";
import { SpicetifyHistoryLocation, SpotifyTrack } from "../types/SpotifyTypes";
import { parseLocalFileUri } from "../utils/LocalFileParser";

interface UseSpicetifyHistoryProps {
  isMultiTagging: boolean;
  setSelectedTracks: (tracks: SpotifyTrack[]) => void;
  setIsMultiTagging: (isMultiTagging: boolean) => void;
  setLockedTrack: (track: SpotifyTrack | null) => void;
  setIsLocked: (isLocked: boolean) => void;
  setLockedMultiTrackUri: (uri: string | null) => void;
  currentTrack: SpotifyTrack | null;
}

export function useSpicetifyHistory({
  isMultiTagging,
  setSelectedTracks,
  setIsMultiTagging,
  setLockedTrack,
  setIsLocked,
  setLockedMultiTrackUri,
  currentTrack,
}: UseSpicetifyHistoryProps) {
  useEffect(() => {
    // Define the track URI checker function
    const checkForTrackUris = async () => {
      // Try multiple ways to get the URI parameter (for single track)
      let trackUri = null;

      // Try from window.location.search
      const windowParams = new URLSearchParams(window.location.search);
      if (windowParams.has("uri")) {
        trackUri = windowParams.get("uri");
      }

      // Try from Spicetify.Platform.History.location if available
      if (!trackUri && Spicetify.Platform.History.location) {
        // Cast the location to our interface type
        const location = Spicetify.Platform.History.location as SpicetifyHistoryLocation;

        // Now TypeScript knows that location has search and state properties
        const historyParams = new URLSearchParams(location.search || "");
        if (historyParams.has("uri")) {
          trackUri = historyParams.get("uri");
        }

        // Also check state
        if (!trackUri && location.state?.trackUri) {
          trackUri = location.state.trackUri;
        }
      }

      // For multiple tracks - check for 'uris' parameter
      let trackUrisParam = null;

      // Try from window.location.search
      if (windowParams.has("uris")) {
        trackUrisParam = windowParams.get("uris");
      }

      // Try from Spicetify.Platform.History.location if available
      if (!trackUrisParam && Spicetify.Platform.History.location) {
        // Cast the location to our interface type
        const location = Spicetify.Platform.History.location as SpicetifyHistoryLocation;

        const historyParams = new URLSearchParams(location.search || "");
        if (historyParams.has("uris")) {
          trackUrisParam = historyParams.get("uris");
        }

        // Also check state
        if (!trackUrisParam && location.state?.trackUris) {
          trackUrisParam = JSON.stringify(location.state.trackUris);
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
          const response = await Spicetify.CosmosAsync.get(
            `https://api.spotify.com/v1/tracks/${trackId}`
          );

          if (response) {
            // Format the track info
            const trackInfo: SpotifyTrack = {
              uri: trackUri,
              name: response.name,
              artists: response.artists.map((artist: any) => ({
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
              setSelectedTracks([]);
              setIsMultiTagging(false);
            }
          }
        } catch (error) {
          console.error("Tagify: Error loading track from URI parameter:", error);
          Spicetify.showNotification("Error loading track for tagging", true);
        }
      }
      // MULTI-TRACK HANDLING
      else if (trackUrisParam) {
        try {
          // Parse the JSON array of URIs
          const trackUris = JSON.parse(decodeURIComponent(trackUrisParam));
          console.log("Tagify: Processing track URIs:", trackUris);

          if (!Array.isArray(trackUris) || trackUris.length === 0) {
            throw new Error("Invalid track URIs format");
          }

          // If there's only one track, handle it as a single track
          if (trackUris.length === 1) {
            // Use the format that works with your Spicetify version
            Spicetify.Platform.History.push(`/tagify?uri=${encodeURIComponent(trackUris[0])}`);
            return;
          }

          // Multiple tracks case
          const fetchedTracks: SpotifyTrack[] = [];

          // Process tracks in batches
          for (const uri of trackUris) {
            // Handle local files
            if (uri.startsWith("spotify:local:")) {
              const parsedFile = parseLocalFileUri(uri);
              fetchedTracks.push({
                uri,
                name: parsedFile.title,
                artists: [{ name: parsedFile.artist }],
                album: { name: parsedFile.album },
                duration_ms: 0,
              });
              continue;
            }

            // For Spotify tracks
            try {
              const trackId = uri.split(":").pop();
              if (!trackId) continue;

              const response = await Spicetify.CosmosAsync.get(
                `https://api.spotify.com/v1/tracks/${trackId}`
              );

              if (response) {
                fetchedTracks.push({
                  uri,
                  name: response.name,
                  artists: response.artists.map((artist: any) => ({
                    name: artist.name,
                  })),
                  album: { name: response.album?.name || "Unknown Album" },
                  duration_ms: response.duration_ms,
                });
              }
            } catch (error) {
              console.error(`Tagify: Error fetching track ${uri}:`, error);
            }
          }

          if (fetchedTracks.length > 0) {
            setSelectedTracks(fetchedTracks);
            setIsMultiTagging(true);

            // Unlock when mass tagging
            setIsLocked(false);
            setLockedMultiTrackUri(null);
          }
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
        // Try to set up the listener and get the unlisten function
        const unlistenFunc = Spicetify.Platform.History.listen(() => {
          checkForTrackUris();
        });

        // Check if the returned value is a function (as it should be)
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

    // Cleanup listener on unmount
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    isMultiTagging,
    setSelectedTracks,
    setIsMultiTagging,
    setLockedTrack,
    setIsLocked,
    setLockedMultiTrackUri,
    currentTrack,
  ]);
}
