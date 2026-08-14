import { useEffect, useState } from "react";
import { spotifyService } from "@/services/SpotifyService";
import { SpotifyTrack } from "@/types/SpotifyTypes";
import {
  createLocalSpotifyTrack,
  createSpotifyTrackFromPlayerItem,
  createSpotifyTrackFromTrackInfo,
} from "@/features/track-session/utils/trackSession.mappers";
import {
  loadPersistedTrackLockState,
  persistTrackLockState,
} from "@/features/track-session/utils/trackSession.storage";

export function useTrackState() {
  const [currentlyPlayingTrack, setCurrentlyPlayingTrack] =
    useState<SpotifyTrack | null>(null);
  const [lockedTrack, setLockedTrack] = useState<SpotifyTrack | null>(null);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const activeTrack =
    isLocked && lockedTrack ? lockedTrack : currentlyPlayingTrack;

  useEffect(() => {
    const persistedState = loadPersistedTrackLockState();

    if (persistedState.isLocked && persistedState.lockedTrack) {
      setIsLocked(true);
      setLockedTrack(persistedState.lockedTrack);
    }

    setIsStorageLoaded(true);
  }, []);

  useEffect(() => {
    persistTrackLockState(isLocked, lockedTrack);
  }, [isLocked, lockedTrack]);

  useEffect(() => {
    if (!isStorageLoaded) {
      return;
    }

    const updateCurrentTrack = () => {
      if (!Spicetify?.Player?.data) {
        return;
      }

      try {
        const playerItem = Spicetify.Player.data.item;
        const newTrack = createSpotifyTrackFromPlayerItem(playerItem);

        if (!newTrack) {
          console.warn("Could not find track data in Spicetify.Player.data");
          return;
        }

        setCurrentlyPlayingTrack(newTrack);

        if (!isLocked) {
          setLockedTrack(newTrack);
        }
      } catch (error) {
        console.error("Error updating current track:", error);
      }
    };

    Spicetify.Player.addEventListener("songchange", updateCurrentTrack);
    updateCurrentTrack();

    return () => {
      Spicetify.Player.removeEventListener("songchange", updateCurrentTrack);
    };
  }, [isLocked, isStorageLoaded]);

  const toggleLock = () => {
    if (isLocked) {
      setLockedTrack(currentlyPlayingTrack);
      setIsLocked(false);
      Spicetify.Platform.History.push("/tagify");
      return;
    }

    setIsLocked(true);
  };

  const handleSelectTrackForTagging = async (uri: string) => {
    try {
      if (uri.startsWith("spotify:local:")) {
        setLockedTrack(createLocalSpotifyTrack(uri));
        setIsLocked(true);
        return;
      }

      const trackData = await spotifyService.getTrack(uri);

      if (!trackData) {
        throw new Error("Failed to fetch track data");
      }

      setLockedTrack(createSpotifyTrackFromTrackInfo(uri, trackData));
      setIsLocked(true);
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
