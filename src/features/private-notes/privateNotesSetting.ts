import { useSyncExternalStore } from "react";

/**
 * The Settings switch for private notes. Off hides the note box and the note previews in lists;
 * the notes themselves stay saved (and keep syncing) and come back when it's turned on again.
 * Stored on this computer only.
 */
export const PRIVATE_NOTES_SHOWN_KEY = "tagify:private-notes:shown";
const CHANGED_EVENT = "tagify:privateNotesShownChanged";

export function readPrivateNotesShown(): boolean {
  try {
    return window.localStorage.getItem(PRIVATE_NOTES_SHOWN_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setPrivateNotesShown(shown: boolean): void {
  try {
    window.localStorage.setItem(PRIVATE_NOTES_SHOWN_KEY, String(shown));
  } catch { /* Applies until Spotify restarts when storage is unavailable. */ }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PRIVATE_NOTES_SHOWN_KEY) onChange();
  };
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("tagify:durableStateRestored", onChange);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("tagify:durableStateRestored", onChange);
  };
};

export function usePrivateNotesShown(): boolean {
  return useSyncExternalStore(subscribe, readPrivateNotesShown, readPrivateNotesShown);
}
