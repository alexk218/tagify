import { TrackData } from "@/types/tagData";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { evaluateTrackMatchesCriteria } from "@/features/smart-playlists/utils/smartPlaylist.criteria";
import {
  loadSmartPlaylistsFromStorage,
  saveSmartPlaylistsToStorage,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";

class SmartPlaylistSyncService {
  private getSmartPlaylists(): SmartPlaylistCriteria[] {
    return loadSmartPlaylistsFromStorage();
  }

  private saveSmartPlaylists(playlists: SmartPlaylistCriteria[]): void {
    saveSmartPlaylistsToStorage(playlists);
  }

  async syncTrack(
    trackUri: string,
    trackData: TrackData | null
  ): Promise<void> {
    const playlists = this.getSmartPlaylists();
    if (playlists.length === 0) return;

    for (const playlist of playlists) {
      if (!playlist?.playlistId || !playlist.isActive) continue;

      const isCurrentlyTracked = (
        playlist.smartPlaylistTrackUris || []
      ).includes(trackUri);

      if (!trackData) {
        // Track deleted - remove from playlist
        if (isCurrentlyTracked) {
          const success = await spotifyApiService.removeTrackFromPlaylist(
            trackUri,
            playlist.playlistId
          );
          if (success) {
            this.updatePlaylistTrackUris(
              playlist.playlistId,
              (playlist.smartPlaylistTrackUris || []).filter(
                (uri) => uri !== trackUri
              )
            );
          }
        }
      } else {
        const matches = evaluateTrackMatchesCriteria(trackData, playlist.criteria);

        if (matches && !isCurrentlyTracked) {
          // Add track
          const result = await spotifyApiService.addTrackToSpotifyPlaylist(
            trackUri,
            playlist.playlistId
          );
          if (result.success && result.wasAdded) {
            const newUris = [
              ...(playlist.smartPlaylistTrackUris || []),
              trackUri,
            ];
            this.updatePlaylistTrackUris(playlist.playlistId, newUris);
          }
        } else if (!matches && isCurrentlyTracked) {
          // Remove track
          const success = await spotifyApiService.removeTrackFromPlaylist(
            trackUri,
            playlist.playlistId
          );
          if (success) {
            this.updatePlaylistTrackUris(
              playlist.playlistId,
              (playlist.smartPlaylistTrackUris || []).filter(
                (uri) => uri !== trackUri
              )
            );
          }
        }
      }
    }
  }

  private updatePlaylistTrackUris(
    playlistId: string,
    newTrackUris: string[]
  ): void {
    const playlists = this.getSmartPlaylists();
    const updated = playlists.map((playlist) =>
      playlist.playlistId === playlistId
        ? {
            ...playlist,
            smartPlaylistTrackUris: newTrackUris,
            lastSyncAt: Date.now(),
          }
        : playlist
    );
    this.saveSmartPlaylists(updated);
  }
}

export const smartPlaylistSyncService = new SmartPlaylistSyncService();
