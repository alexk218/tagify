import { useEffect } from "react";
import { ArtistData, PlaylistData, TrackData } from "@/types/tagData";

const TRACK_CHANGED_EVENT = "tagify:trackChanged";
const PLAYLIST_CHANGED_EVENT = "tagify:playlistChanged";
const ARTIST_CHANGED_EVENT = "tagify:artistChanged";

interface UseGlobalKeyboardShortcutsProps {
  onShortcutTrackUpdate?: (
    trackUri: string,
    trackData: TrackData | null,
  ) => void;
  onShortcutPlaylistUpdate?: (
    playlistUri: string,
    playlistData: PlaylistData | null,
  ) => void;
  onShortcutArtistUpdate?: (
    artistUri: string,
    artistData: ArtistData | null,
  ) => void;
}

/**
 * Hook that LISTENS for changes saved outside the Tagify page: keyboard
 * shortcuts (KeyboardShortcutService) and the controls in Spotify's views
 * (extension.js). Translates those global events into React state updates.
 *
 * The keyboard service is initialized in extension.js at Spotify startup,
 * NOT here. This hook only listens for the custom events dispatched after a
 * change is saved, allowing React to re-render.
 *
 * Note: The service imported in extension.js (KeyboardShortcutService.ts)
 * and this hook imported in app.tsx are DIFFERENT instances (separate bundles).
 * They communicate via:
 * 1. IndexedDB (the saved library)
 * 2. window custom events carrying each saved record (null when removed).
 *    An event without a record says nothing about the saved record, so it is
 *    ignored rather than shown as a removal.
 */
export function useGlobalKeyboardShortcuts({
  onShortcutTrackUpdate,
  onShortcutPlaylistUpdate,
  onShortcutArtistUpdate,
}: UseGlobalKeyboardShortcutsProps = {}) {
  // Listen for track-level updates emitted by keyboard shortcuts service
  useEffect(() => {
    if (!onShortcutTrackUpdate) return;

    const handleTrackChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{
        trackUri?: string;
        trackData?: TrackData | null;
      }>;
      const detail = customEvent.detail;

      if (
        typeof detail?.trackUri === "string" &&
        detail.trackUri.length > 0 &&
        detail.trackData !== undefined
      ) {
        onShortcutTrackUpdate(detail.trackUri, detail.trackData);
      }
    };

    window.addEventListener(TRACK_CHANGED_EVENT, handleTrackChanged);
    return () => {
      window.removeEventListener(TRACK_CHANGED_EVENT, handleTrackChanged);
    };
  }, [onShortcutTrackUpdate]);

  useEffect(() => {
    if (!onShortcutPlaylistUpdate) return;

    const handlePlaylistChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{
        playlistUri?: string;
        playlistData?: PlaylistData | null;
      }>;
      const detail = customEvent.detail;

      if (
        typeof detail?.playlistUri === "string" &&
        detail.playlistUri.length > 0 &&
        detail.playlistData !== undefined
      ) {
        onShortcutPlaylistUpdate(detail.playlistUri, detail.playlistData);
      }
    };

    window.addEventListener(PLAYLIST_CHANGED_EVENT, handlePlaylistChanged);
    return () => {
      window.removeEventListener(PLAYLIST_CHANGED_EVENT, handlePlaylistChanged);
    };
  }, [onShortcutPlaylistUpdate]);

  useEffect(() => {
    if (!onShortcutArtistUpdate) return;

    const handleArtistChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{
        artistUri?: string;
        artistData?: ArtistData | null;
      }>;
      const detail = customEvent.detail;

      if (
        typeof detail?.artistUri === "string" &&
        detail.artistUri.length > 0 &&
        detail.artistData !== undefined
      ) {
        onShortcutArtistUpdate(detail.artistUri, detail.artistData);
      }
    };

    window.addEventListener(ARTIST_CHANGED_EVENT, handleArtistChanged);
    return () => {
      window.removeEventListener(ARTIST_CHANGED_EVENT, handleArtistChanged);
    };
  }, [onShortcutArtistUpdate]);
}
