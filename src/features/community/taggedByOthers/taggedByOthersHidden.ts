// Songs the member hid from "Tagged by others", per Community account, on this computer only. Like
// the saved check, this is a convenience outside the library database: it never syncs or enters a
// backup, and losing it only brings the songs back.
const PREFIX = "tagify:tagged-by-others:hidden:v1:";
/** Enough for any library; the oldest hides go first past it. */
const MAX_HIDDEN = 5_000;

export interface HiddenSongsStore {
  load(account: string): string[];
  save(account: string, uris: readonly string[]): void;
  clear(account: string | null): void;
}

export const hiddenSongsStore: HiddenSongsStore = {
  load(account) {
    try {
      const value = JSON.parse(localStorage.getItem(PREFIX + account) || "[]");
      return Array.isArray(value) ? value.filter((uri): uri is string => typeof uri === "string") : [];
    } catch { return []; }
  },
  save(account, uris) {
    try { localStorage.setItem(PREFIX + account, JSON.stringify(uris.slice(-MAX_HIDDEN))); } catch { /* Shown again next time. */ }
  },
  clear(account) {
    try {
      if (account) { localStorage.removeItem(PREFIX + account); return; }
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
      }
    } catch { /* Nothing was kept. */ }
  },
};
