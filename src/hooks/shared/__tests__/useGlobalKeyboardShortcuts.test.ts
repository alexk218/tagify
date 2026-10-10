import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TrackData } from "@/types/tagData";
import { useGlobalKeyboardShortcuts } from "../useGlobalKeyboardShortcuts";

const trackUri = `spotify:track:${"h".repeat(22)}`;
const saved: TrackData = { rating: 4, energy: 0, bpm: null, tagIds: ["rock"], dateModified: 2_000 };
const send = (type: string, detail: Record<string, unknown>) =>
  window.dispatchEvent(new CustomEvent(type, { detail }));

it("shows saved records and removals, but never treats a missing record as a removal", () => {
  const onShortcutTrackUpdate = vi.fn();
  const onShortcutPlaylistUpdate = vi.fn();
  const onShortcutArtistUpdate = vi.fn();
  const { unmount } = renderHook(() => useGlobalKeyboardShortcuts({
    onShortcutTrackUpdate, onShortcutPlaylistUpdate, onShortcutArtistUpdate,
  }));

  send("tagify:trackChanged", { trackUri, trackData: saved });
  send("tagify:trackChanged", { trackUri, trackData: null });
  send("tagify:trackChanged", { trackUri });
  send("tagify:playlistChanged", { playlistUri: "spotify:playlist:p" });
  send("tagify:artistChanged", { artistUri: "spotify:artist:a", artistData: null });
  unmount();

  expect(onShortcutTrackUpdate.mock.calls).toEqual([[trackUri, saved], [trackUri, null]]);
  expect(onShortcutPlaylistUpdate).not.toHaveBeenCalled();
  expect(onShortcutArtistUpdate).toHaveBeenCalledWith("spotify:artist:a", null);
});
