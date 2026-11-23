import type { FirstRunTipProps } from "./components/FirstRunTip";
import type { HowToTipId } from "./firstRunTips";

/** When the tips first ran on this device; the how-to tips wait a minute after it. */
const STARTED_AT_KEY = "tagify:first-run-tips:started-at";
/** Someone made a playlist from their tags while the tips were on. */
const PLAYLIST_MADE_KEY = "tagify:first-run-tips:playlist-made";
export const HOW_TO_PLAYLIST_MADE = "tagify:first-run-tips-playlist-made";

export function tipsStartedAt(now = Date.now()): number {
  try {
    const saved = Number(localStorage.getItem(STARTED_AT_KEY));
    if (Number.isFinite(saved) && saved > 0) return saved;
    localStorage.setItem(STARTED_AT_KEY, String(now));
  } catch { /* storage unavailable: count from now */ }
  return now;
}

export function playlistMadeWithTips(): boolean {
  try {
    return localStorage.getItem(PLAYLIST_MADE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Called after a playlist is made from the filters; the Smart Playlists tip follows it. */
export function notePlaylistMade(): void {
  try {
    localStorage.setItem(PLAYLIST_MADE_KEY, "1");
  } catch { /* storage unavailable: the tip waits for the next playlist */ }
  window.dispatchEvent(new Event(HOW_TO_PLAYLIST_MADE));
}

/**
 * What each later tip says and which control it points at. The playlist tip points at Filters until a
 * tag filter is on, then at Create Playlist; while Tagged by others is open, it points back at the
 * Tagged Tracks tab.
 */
export function howToTipCopy(tip: HowToTipId, { tagFilterOn = false }: { tagFilterOn?: boolean } = {}): Pick<FirstRunTipProps, "anchor" | "title" | "body" | "fallback"> {
  switch (tip) {
    case "playlist": {
      const fallback = {
        anchor: "tagged-tab",
        title: "Make a playlist from your tags",
        body: "On Tagged Tracks, pick a couple of tags in Filters and you get exactly those songs.",
      };
      return tagFilterOn
        ? { anchor: "create-playlist", title: "Save them as a playlist", body: "These are exactly the songs with those tags.", fallback }
        : { anchor: "tag-filters", title: "Make a playlist from your tags", body: "Pick a couple of tags in Filters and you get exactly those songs.", fallback };
    }
    case "smart":
      return { anchor: "smart-playlists", title: "Keep it updated", body: "A smart playlist adds new songs you tag." };
  }
}
