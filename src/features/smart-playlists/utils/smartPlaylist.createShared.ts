import type { SmartPlaylistCriteria } from "../model/smartPlaylist.types";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { storageService } from "@/services/storage/StorageService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { clearExplicitSmartPlaylistClear, updateSmartPlaylistsInStorage } from "./smartPlaylist.storage";

const inFlight = new Map<string, Promise<SmartPlaylistCriteria>>();
const unsavedConnections = new Map<string, string>();

/** Save the new connection before sync; a failed save can retry the same playlist. */
export function createSharedSmartPlaylist(setupId: string): Promise<SmartPlaylistCriteria> {
  const databaseName = getTagifyDatabaseName();
  const key = `tagify:shared-playlist-creation:${databaseName}:${setupId}`;
  const checkAccount = () => { if (getTagifyDatabaseName() !== databaseName) throw new Error("Your Spotify account changed. Return to the account where you started creating this playlist, then try again."); };
  const existing = inFlight.get(key);
  if (existing) return existing;
  const operation = (async () => {
    await flushLocalPersistence();
    const data = await storageService.loadAllStrict();
    checkAccount();
    const setup = data.smartPlaylists?.find((playlist) => playlist.id === setupId);
    if (!setup) throw new Error("This setup is no longer saved. Open Smart Playlists and choose it again.");
    if (setup.playlistId) return setup;
    let recovered: string | null = null;
    try { recovered = localStorage.getItem(key); } catch { /* The in-memory copy still protects retries in this session. */ }
    const playlistId = unsavedConnections.get(key) ?? recovered ?? await spotifyApiService.createPrivatePlaylist(setup.playlistName, setup.description);
    unsavedConnections.set(key, playlistId);
    try { localStorage.setItem(key, playlistId); } catch { /* Do not discard an already created Spotify playlist. */ }
    checkAccount();
    let bound: SmartPlaylistCriteria | undefined;
    try {
      await updateSmartPlaylistsInStorage((current) => { checkAccount(); return current.map((playlist) => {
        if (playlist.id !== setupId) return playlist;
        if (playlist.playlistId) { bound = playlist; return playlist; }
        bound = { ...playlist, playlistId, isActive: true, lastSyncAt: 0, smartPlaylistTrackUris: [], pendingTagChoices: [], updatedAt: Date.now() };
        return bound;
      }); });
      if (!bound) throw new Error("Setup removed while creating its playlist");
    } catch {
      throw new Error("Your new Spotify playlist was created, but Tagify couldn’t save its connection. Try again to finish saving the same playlist. Your existing playlists are unchanged.");
    }
    unsavedConnections.delete(key);
    try { localStorage.removeItem(key); } catch { /* The saved connection is now authoritative. */ }
    clearExplicitSmartPlaylistClear();
    // Existing Spotify members are a baseline, so retries never apply annotations to historical songs.
    let summary;
    try { summary = await smartPlaylistSyncService.reconcilePlaylist(bound.playlistId); }
    catch (cause) {
      console.error("Could not fill a newly created shared playlist", cause);
      window.dispatchEvent(new CustomEvent("tagify:smartPlaylistsUpdated"));
      Spicetify.showNotification("Your new playlist is saved. Songs couldn’t be added yet; use Sync Now when Spotify is available.", true);
      return bound;
    }
    window.dispatchEvent(new CustomEvent("tagify:smartPlaylistsUpdated"));
    if (summary.failedPlaylistNames.length) {
      Spicetify.showNotification("Your new playlist is saved. Some songs couldn’t be added yet; use Sync Now when Spotify is available.", true);
    } else {
      Spicetify.showNotification(`Created “${bound.playlistName}”. It will stay up to date with your filters.`);
    }
    return bound;
  })();
  inFlight.set(key, operation);
  void operation.finally(() => { if (inFlight.get(key) === operation) inFlight.delete(key); }).catch(() => undefined);
  return operation;
}
