import { useSmartPlaylistActions } from "@/features/smart-playlists/hooks/useSmartPlaylistActions";
import { useSmartPlaylistState } from "@/features/smart-playlists/hooks/useSmartPlaylistState";

export function useSmartPlaylists() {
  const {
    smartPlaylists,
    setSmartPlaylists,
    updateSmartPlaylistsImmediate,
    replaceSmartPlaylists,
    refreshSmartPlaylists,
    resetSmartPlaylists,
  } = useSmartPlaylistState();

  const {
    syncSmartPlaylistFull,
    syncMultipleTracksWithSmartPlaylists,
    syncTrackWithSmartPlaylists,
    createSmartPlaylist,
    exportSmartPlaylists,
    importSmartPlaylists,
  } = useSmartPlaylistActions({
    smartPlaylists,
    updateSmartPlaylistsImmediate,
    replaceSmartPlaylists,
    refreshSmartPlaylists,
  });

  return {
    syncSmartPlaylistFull,
    syncMultipleTracksWithSmartPlaylists,
    syncTrackWithSmartPlaylists,
    createSmartPlaylist,
    smartPlaylists,
    setSmartPlaylists,
    exportSmartPlaylists,
    importSmartPlaylists,
    resetSmartPlaylists,
  };
}
