import { useState, useEffect } from "react";
import { SpotifyTrack } from "../types/SpotifyTypes";
import { parseLocalFileUri } from "../utils/LocalFileParser";

const LOCK_STATE_KEY = "tagify:lockState";
const LOCKED_TRACK_KEY = "tagify:lockedTrack";

interface UseTrackStateProps {
  setIsMultiTagging: (isMultiTagging: boolean) => void;
  setMultiTagTracks: (tracks: SpotifyTrack[]) => void;
  setLockedMultiTrackUri: (uri: string | null) => void;
}

export function useTrackState({
  setIsMultiTagging,
  setMultiTagTracks,
  setLockedMultiTrackUri,
}: UseTrackStateProps) {
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null);
  const [lockedTrack, setLockedTrack] = useState<SpotifyTrack | null>(null);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // Derived state - the active track is either locked track or current track
  const activeTrack = isLocked && lockedTrack ? lockedTrack : currentTrack;

  // Load saved lock state and locked track on initial render
  useEffect(() => {
    try {
      const savedLockState = localStorage.getItem(LOCK_STATE_KEY);
      const savedLockedTrack = localStorage.getItem(LOCKED_TRACK_KEY);

      if (savedLockState === "true" && savedLockedTrack) {
        setIsLocked(true);
        const parsedTrack = JSON.parse(savedLockedTrack);
        setLockedTrack(parsedTrack);
      }
    } catch (error) {
      console.error("Tagify: Error loading saved lock state:", error);
    } finally {
      setIsStorageLoaded(true);
    }
  }, []);

  // Save lock state and locked track whenever they change
  useEffect(() => {
    if (isLocked && lockedTrack) {
      localStorage.setItem(LOCK_STATE_KEY, "true");
      localStorage.setItem(LOCKED_TRACK_KEY, JSON.stringify(lockedTrack));
    } else {
      localStorage.removeItem(LOCK_STATE_KEY);
      localStorage.removeItem(LOCKED_TRACK_KEY);
    }
  }, [isLocked, lockedTrack]);

  // Listen for track changes
  useEffect(() => {
    // only set up the listener if storage has been loaded
    if (!isStorageLoaded) {
      return;
    }
    // Function to update current track based on Spicetify API
    const updateCurrentTrack = () => {
      // Check if we have a valid player data
      if (!Spicetify?.Player?.data) return;

      try {
        // Try to get the track data
        let trackData = null;

        // First try 'track' property which is the most common
        if (Spicetify.Player.data.track) {
          trackData = Spicetify.Player.data.track;
        }
        // Then try 'item' property which might be present in some versions
        else if ((Spicetify.Player.data as any).item) {
          trackData = (Spicetify.Player.data as any).item;
        }

        if (!trackData) {
          console.warn("Could not find track data in Spicetify.Player.data");
          return;
        }

        // Map the data to our expected format
        const newTrack: SpotifyTrack = {
          uri: trackData.uri,
          name: trackData.name || "Unknown Track",
          artists: trackData.artists || [{ name: "Unknown Artist" }],
          album: trackData.album || { name: "Unknown Album" },
          duration_ms: typeof trackData.duration === "number" ? trackData.duration : 0,
        };

        // ALWAYS update currentTrack to reflect what's playing in Spotify
        setCurrentTrack(newTrack);

        // ONLY update lockedTrack if we're NOT locked
        if (!isLocked) {
          // Create a safe track object with defaults for missing values
          const safeTrack = {
            ...newTrack,
            artists: newTrack.artists || [{ name: "Unknown Artist" }],
            album: newTrack.album || { name: "Unknown Album" },
            duration_ms: typeof newTrack.duration_ms === "number" ? newTrack.duration_ms : 0,
          };

          setLockedTrack(safeTrack);
        }
      } catch (error) {
        console.error("Error updating current track:", error);
      }
    };

    // Set up event listener
    Spicetify.Player.addEventListener("songchange", updateCurrentTrack);

    // Initial track check
    updateCurrentTrack();

    // Clean up on unmount
    return () => {
      Spicetify.Player.removeEventListener("songchange", updateCurrentTrack);
    };
  }, [isLocked, isStorageLoaded]);

  // Cancel multi-tagging mode
  const cancelMultiTagging = () => {
    // Clear the multi-tagging states
    setMultiTagTracks([]);
    setIsMultiTagging(false);
    setLockedMultiTrackUri(null);

    // If there's no active track to show but we have a current track,
    // set it as the locked track
    if (!activeTrack && currentTrack) {
      setLockedTrack(currentTrack);
      setIsLocked(true);
    }

    // Clear any URL parameters to avoid getting back into multi-tagging mode
    Spicetify.Platform.History.push("/tagify");
  };

  // Function to handle locking/unlocking the track
  const toggleLock = () => {
    if (isLocked) {
      // When unlocking, update the locked track to the current track
      setLockedTrack(currentTrack);
      setIsLocked(false);
      // Clear URL parameters to prevent history hook from re-locking
      Spicetify.Platform.History.push("/tagify");
    } else {
      // When locking, use current locked track (which should be current track)
      setIsLocked(true);
    }
  };

  // Function to handle a track selected from TrackList for tagging
  const handleTagTrack = async (uri: string) => {
    try {
      // Check if this is a local file
      if (uri.startsWith("spotify:local:")) {
        // Use our dedicated parser to get better metadata
        const parsedFile = parseLocalFileUri(uri);

        // Create a track object for local files
        const trackInfo: SpotifyTrack = {
          uri: uri,
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

      // For Spotify tracks, extract the ID from the URI
      const trackId = uri.split(":").pop();

      if (!trackId) {
        throw new Error("Invalid track URI");
      }

      // Fetch track info from Spotify API
      const response = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/tracks/${trackId}`
      );

      if (response) {
        // Format the track info to our needed structure
        const trackInfo: SpotifyTrack = {
          uri: uri,
          name: response.name,
          artists: response.artists.map((artist: any) => ({
            name: artist.name,
          })),
          album: { name: response.album?.name || "Unknown Album" },
          duration_ms: response.duration_ms,
        };

        // Lock to this track
        setLockedTrack(trackInfo);
        setIsLocked(true);
      }
    } catch (error) {
      console.error("Error loading track for tagging:", error);
      Spicetify.showNotification("Error loading track for tagging", true);
    }
  };

  return {
    currentTrack,
    setCurrentTrack,
    lockedTrack,
    setLockedTrack,
    isLocked,
    setIsLocked,
    activeTrack,
    toggleLock,
    handleTagTrack,
    cancelMultiTagging,
  };
}
