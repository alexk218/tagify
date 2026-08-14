import { SpotifyTrack } from "@/types/SpotifyTypes";

export const LOCK_STATE_KEY = "tagify:lockState";
export const LOCKED_TRACK_KEY = "tagify:lockedTrack";

export interface PersistedTrackLockState {
  isLocked: boolean;
  lockedTrack: SpotifyTrack | null;
}

export function loadPersistedTrackLockState(): PersistedTrackLockState {
  try {
    const savedLockState = localStorage.getItem(LOCK_STATE_KEY);
    const savedLockedTrack = localStorage.getItem(LOCKED_TRACK_KEY);

    if (savedLockState === "true" && savedLockedTrack) {
      const parsedTrack = JSON.parse(savedLockedTrack) as SpotifyTrack;
      return {
        isLocked: true,
        lockedTrack: parsedTrack,
      };
    }
  } catch (error) {
    console.error("Tagify: Error loading saved lock state:", error);
  }

  return {
    isLocked: false,
    lockedTrack: null,
  };
}

export function persistTrackLockState(
  isLocked: boolean,
  lockedTrack: SpotifyTrack | null,
): void {
  if (isLocked && lockedTrack) {
    localStorage.setItem(LOCK_STATE_KEY, "true");
    localStorage.setItem(LOCKED_TRACK_KEY, JSON.stringify(lockedTrack));
    return;
  }

  localStorage.removeItem(LOCK_STATE_KEY);
  localStorage.removeItem(LOCKED_TRACK_KEY);
}
