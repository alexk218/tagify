import { useSmartPlaylistActions } from "@/features/smart-playlists/hooks/useSmartPlaylistActions";
import { useSmartPlaylistState } from "@/features/smart-playlists/hooks/useSmartPlaylistState";
import { useSmartPlaylistSyncQueue } from "@/features/smart-playlists/hooks/useSmartPlaylistSyncQueue";
import { UseSmartPlaylistProps } from "@/features/smart-playlists/model/useSmartPlaylists.types";

export function useSmartPlaylists({ tagDataRef }: UseSmartPlaylistProps) {
  const {
    smartPlaylists,
    smartPlaylistsRef,
    setSmartPlaylists,
    updateSmartPlaylistsImmediate,
    replaceSmartPlaylists,
    resetSmartPlaylists,
  } = useSmartPlaylistState();

  const { enqueueSyncOperation } = useSmartPlaylistSyncQueue();

  const {
    syncSmartPlaylistFull,
    syncMultipleTracksWithSmartPlaylists,
    syncTrackWithSmartPlaylists,
    createSmartPlaylist,
    cleanupDeletedSmartPlaylists,
    exportSmartPlaylists,
    importSmartPlaylists,
  } = useSmartPlaylistActions({
    tagDataRef,
    smartPlaylists,
    smartPlaylistsRef,
    updateSmartPlaylistsImmediate,
    replaceSmartPlaylists,
    enqueueSyncOperation,
  });

  return {
    syncSmartPlaylistFull,
    syncMultipleTracksWithSmartPlaylists,
    syncTrackWithSmartPlaylists,
    createSmartPlaylist,
    cleanupDeletedSmartPlaylists,
    smartPlaylists,
    setSmartPlaylists,
    exportSmartPlaylists,
    importSmartPlaylists,
    resetSmartPlaylists,
  };
}
