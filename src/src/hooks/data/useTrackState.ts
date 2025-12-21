import { useState, useEffect } from "react";
import { SpotifyArtist, SpotifyTrack, SpotifyTrackResponse } from "@/types/SpotifyTypes";
import { parseLocalFileUri } from "@/utils/LocalFileParser";

const LOCK_STATE_KEY = "tagify:lockState";
const LOCKED_TRACK_KEY = "tagify:lockedTrack";

/**
 * SINGLE TRACK STATE MANAGEMENT HOOK
 * 
 * Manages the currently active track for **single-track** tagging operations.
 * Handles **track locking** functionality and **Spicetify Player integration**.
 * 
 * @responsibilities
 * - **Track Spotify Player state** (currently playing track)
 * - Manage track locking (freeze on specific track vs follow player)
 * - Persist lock state across browser sessions via localStorage
 * - Handle manual track selection from TrackList (for tagging)
 * - Provide computed activeTrack (locked track OR currently playing)
 * 
 * @state_behavior
 * - currentlyPlayingTrack: Always reflects Spicetify.Player.data.item
 * - lockedTrack: User-frozen track for extended tagging sessions
 * - activeTrack: Computed property - **locked track takes precedence**
 * - isLocked: Toggle between following player vs staying on locked track
 * 
 * @persistence
 * - Lock state persisted to localStorage on change
 * - Restored automatically on app reload
 * - Cleaned up when unlocked
 */
export function useTrackState() {
  const [currentlyPlayingTrack, setCurrentlyPlayingTrack] = useState<SpotifyTrack | null>(null);
  const [lockedTrack, setLockedTrack] = useState<SpotifyTrack | null>(null);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // Derived state - the active track is either locked track or current track
  const activeTrack = isLocked && lockedTrack ? lockedTrack : currentlyPlayingTrack;

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

  // LISTEN FOR TRACK CHANGES
  useEffect(() => {
    // only set up the listener if storage has been loaded
    if (!isStorageLoaded) {
      return;
    }

    const updateCurrentTrack = () => {
      // Check if we have a valid player data
      if (!Spicetify?.Player?.data) return;

      try {
        let trackData = null;
        if (Spicetify.Player.data.item) {
          trackData = Spicetify.Player.data.item;
        }

        if (!trackData) {
          console.warn("Could not find track data in Spicetify.Player.data");
          return;
        }

        const newTrack: SpotifyTrack = {
          uri: trackData.uri,
          name: trackData.name || "Unknown Track",
          artists: trackData.artists || [{ name: "Unknown Artist" }],
          album: trackData.album || { name: "Unknown Album" },
          duration_ms: typeof trackData.duration === "number" ? trackData.duration : 0,
        };

        // ALWAYS update currentlyPlayingTrack to reflect what's playing in Spotify
        // so that when you unlock - it snaps to the currently playing track
        setCurrentlyPlayingTrack(newTrack);

        // ONLY update lockedTrack if we're NOT locked
        if (!isLocked) {
          setLockedTrack(newTrack);
        }
      } catch (error) {
        console.error("Error updating current track:", error);
      }
    };

    // call updateCurrentTrack when song changes!
    Spicetify.Player.addEventListener("songchange", updateCurrentTrack);

    // initial track check
    updateCurrentTrack();

    return () => {
      Spicetify.Player.removeEventListener("songchange", updateCurrentTrack);
    };
  }, [isLocked, isStorageLoaded]);

  // Function to handle locking/unlocking the track
  const toggleLock = () => {
    if (isLocked) {
      // When unlocking, update the locked track to the current track
      setLockedTrack(currentlyPlayingTrack);
      setIsLocked(false);
      // Clear URL parameters to prevent history hook from re-locking
      Spicetify.Platform.History.push("/tagify");
    } else {
      // When locking, use current locked track (which should be current track)
      setIsLocked(true);
    }
  };

  // Function to handle a track selected from TrackList for tagging
  const handleSelectTrackForTagging = async (uri: string) => {
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
      ) as SpotifyTrackResponse;

      if (response) {
        // Format the track info to our needed structure
        const trackInfo: SpotifyTrack = {
          uri: uri,
          name: response.name,
          artists: response.artists.map((artist: SpotifyArtist) => ({
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
    currentlyPlayingTrack,
    setCurrentlyPlayingTrack,
    activeTrack,
    lockedTrack,
    setLockedTrack,
    isLocked,
    setIsLocked,
    toggleLock,
    handleSelectTrackForTagging,
  };
}
