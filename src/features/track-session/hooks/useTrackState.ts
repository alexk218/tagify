import { useCallback, useEffect, useRef, useState } from "react";
import type { SetStateAction } from "react";
import { spotifyService } from "@/services/SpotifyService";
import { SpotifyTrack } from "@/types/SpotifyTypes";
import type { TrackData } from "@/types/tagData";
import {
  createLocalSpotifyTrack,
  createSpotifyTrackFromPlayerItem,
  createSpotifyTrackFromTrackInfo,
} from "@/features/track-session/utils/trackSession.mappers";
import {
  loadPersistedTrackLockState,
  persistTrackLockState,
} from "@/features/track-session/utils/trackSession.storage";

export function useTrackState(savedTracks: Record<string, TrackData> = {}) {
  const [currentlyPlayingTrack, setCurrentlyPlayingTrack] =
    useState<SpotifyTrack | null>(null);
  const [lockedTrack, setLockedTrackState] = useState<SpotifyTrack | null>(null);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const selectionRequest = useRef(0);
  const setLockedTrack = useCallback((track: SetStateAction<SpotifyTrack | null>) => {
    selectionRequest.current++;
    setLockedTrackState(track);
  }, []);

  const activeTrack =
    isLocked ? lockedTrack : currentlyPlayingTrack;

  useEffect(() => () => { selectionRequest.current++; }, []);

  useEffect(() => {
    const persistedState = loadPersistedTrackLockState();

    if (persistedState.isLocked && persistedState.lockedTrack) {
      setIsLocked(true);
      setLockedTrackState(persistedState.lockedTrack);
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
          setLockedTrackState(newTrack);
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
    selectionRequest.current++;
    if (isLocked) {
      setLockedTrackState(currentlyPlayingTrack);
      setIsLocked(false);
      Spicetify.Platform.History.push("/tagify");
      return;
    }

    setIsLocked(true);
  };

  const handleSelectTrackForTagging = async (uri: string) => {
    const request = ++selectionRequest.current;
    const saved = savedTracks[uri];
    // Switch the editor now; Spotify details may arrive much later.
    const knownTrack: SpotifyTrack | null = saved?.name && saved.artists ? {
      uri, name: saved.name, artists: [{ name: saved.artists }],
      album: { name: saved.albumName || "", uri: saved.albumUri || undefined, images: saved.albumImageUrl ? [{ url: saved.albumImageUrl }] : [] },
      duration_ms: 0,
    } : null;
    setLockedTrackState(uri.startsWith("spotify:local:") ? createLocalSpotifyTrack(uri) : knownTrack);
    setIsLocked(true);
    try {
      if (uri.startsWith("spotify:local:")) {
        return;
      }

      const trackData = await spotifyService.getTrack(uri);
      if (request !== selectionRequest.current) return;

      if (!trackData) {
        throw new Error("Failed to fetch track data");
      }

      setLockedTrackState(createSpotifyTrackFromTrackInfo(uri, trackData));
    } catch (error) {
      if (request !== selectionRequest.current) return;
      console.error("Error loading track for tagging:", error);
      Spicetify.showNotification(knownTrack ? "Some song details couldn't be loaded. You can keep tagging; open the song again to retry." : "Song details couldn't be loaded. Open the song again to retry.", true);
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
