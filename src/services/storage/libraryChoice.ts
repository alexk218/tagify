const LIBRARY_CHOICE_PENDING_KEY = "tagify:libraryChoicePending";

/**
 * Set while Tagify asks whether to restore an older copy into an empty
 * library. Edits from Spotify's views wait for the answer, so they can't
 * land in the empty library first and block the restore.
 */
export function setLibraryChoicePending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(LIBRARY_CHOICE_PENDING_KEY, "1");
    else localStorage.removeItem(LIBRARY_CHOICE_PENDING_KEY);
  } catch {
    // Storage can be unavailable; the restore check below still protects data.
  }
}

export function isLibraryChoicePending(): boolean {
  try {
    return localStorage.getItem(LIBRARY_CHOICE_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}
