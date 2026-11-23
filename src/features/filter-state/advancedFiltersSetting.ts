import { useSyncExternalStore } from "react";

/**
 * The Settings switch for advanced filters. On shows the tag group formula editor and the
 * Camelot key filter in Filters; off keeps Filters to one Match Any/All tag group.
 * Stored on this computer, and carried in file backups with the other preferences.
 */
export const ADVANCED_FILTERS_KEY = "tagify:advancedFilters";
// What Filters saved before this setting existed: the Basic/Complex switch and the Advanced button.
const LEGACY_EDITOR_MODE_KEY = "tagify:tagFilterEditorMode";
const LEGACY_SHOW_ADVANCED_KEY = "tagify:showAdvancedFilters";
const CHANGED_EVENT = "tagify:advancedFiltersChanged";

/** Someone who already used Complex or had the Camelot keys open keeps seeing them. */
function inferFromLegacy(): boolean {
  return (
    window.localStorage.getItem(LEGACY_EDITOR_MODE_KEY) === "complex" ||
    window.localStorage.getItem(LEGACY_SHOW_ADVANCED_KEY) === "true"
  );
}

export function readAdvancedFilters(): boolean {
  try {
    const stored = window.localStorage.getItem(ADVANCED_FILTERS_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return inferFromLegacy();
  } catch {
    return false;
  }
}

export function setAdvancedFilters(enabled: boolean): void {
  try {
    window.localStorage.setItem(ADVANCED_FILTERS_KEY, String(enabled));
  } catch { /* Applies until Spotify restarts when storage is unavailable. */ }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ADVANCED_FILTERS_KEY) onChange();
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

export function useAdvancedFilters(): boolean {
  return useSyncExternalStore(subscribe, readAdvancedFilters, readAdvancedFilters);
}
