import type { SmartPlaylistCriteria } from "../model/smartPlaylist.types";
import type { SpotifyPlaylistReference } from "./smartPlaylist.import";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { markConfirmedMembershipBaselines, updateSmartPlaylistsInStorage } from "./smartPlaylist.storage";

const inFlight = new Map<string, Promise<SmartPlaylistCriteria>>();

/** Historical members are not mobile-tagging additions when a setup is connected. */
export function connectExistingSmartPlaylist(setupId: string, selected: SpotifyPlaylistReference): Promise<SmartPlaylistCriteria> {
  const account = getTagifyDatabaseName();
  const key = `${account}:${setupId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const checkAccount = () => {
    if (getTagifyDatabaseName() !== account) throw new Error("Your Spotify account changed. Return to the account where you started connecting this playlist.");
  };
  const operation = (async () => {
    await flushLocalPersistence();
    let references: SpotifyPlaylistReference[];
    let members: string[];
    try {
      references = await spotifyApiService.getAllUserPlaylistReferencesStrict();
      members = await spotifyApiService.getAllTrackUrisInPlaylistStrict(selected.playlistId);
    } catch (cause) {
      console.error("Could not verify an existing Spotify playlist", cause);
      throw new Error("Spotify couldn’t read this playlist. Check that you can open it in Spotify, then try again.");
    }
    const reference = references.find((playlist) => playlist.playlistId === selected.playlistId);
    if (!reference) throw new Error("This Spotify playlist couldn’t be found. Choose another playlist or try again.");

    checkAccount();
    let bound: SmartPlaylistCriteria | undefined;
    const saved = await updateSmartPlaylistsInStorage((current) => {
      checkAccount();
      const setup = current.find((playlist) => playlist.id === setupId);
      if (!setup) throw new Error("This setup is no longer saved. Open Smart Playlists and choose it again.");
      if (current.some((playlist) => playlist.id !== setupId && playlist.playlistId === reference.playlistId)) {
        throw new Error("Another Smart Playlist already uses this Spotify playlist. Choose a different playlist.");
      }
      bound = { ...setup, playlistId: reference.playlistId, playlistName: reference.playlistName,
        isActive: true, lastSyncAt: 0, smartPlaylistTrackUris: members, pendingTagChoices: [], updatedAt: Date.now() };
      return current.map((playlist) => playlist.id === setupId ? bound! : playlist);
    });
    markConfirmedMembershipBaselines(saved, new Set([reference.playlistId]));
    window.dispatchEvent(new CustomEvent("tagify:smartPlaylistsUpdated"));
    try {
      const summary = await smartPlaylistSyncService.reconcilePlaylist(reference.playlistId);
      checkAccount();
      if (summary.failedPlaylistNames.length) throw new Error("Spotify sync incomplete");
      Spicetify.showNotification(`Connected “${reference.playlistName}”. It will stay up to date with your filters.`);
    } catch (cause) {
      console.error("Could not sync a connected Spotify playlist", cause);
      Spicetify.showNotification("Your playlist connection is saved. Sync couldn’t finish yet; use Sync Now when Spotify is available.", true);
    }
    window.dispatchEvent(new CustomEvent("tagify:smartPlaylistsUpdated"));
    return bound!;
  })();
  inFlight.set(key, operation);
  void operation.finally(() => { if (inFlight.get(key) === operation) inFlight.delete(key); }).catch(() => undefined);
  return operation;
}
