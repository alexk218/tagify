import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { storageService } from "@/services/storage/StorageService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { dispatchTagDataUpdatedEvent } from "@/features/tag-data/utils/tagData.events";
import { flushLocalPersistence, getTagifyDatabaseName, isLocalPersistencePaused } from "./SyncLocalState";
import { watchedReserve } from "./CatalogFillLive";
import { communityCatalogFillAllowance } from "./CommunityCatalogFillSources";
import { SONG_RELEASE_FEATURE, SONG_RELEASE_HOURLY_READS, type SongReleaseSources } from "./CommunitySongReleases";

const READ_INTERVAL_MS = 1_000;

/**
 * Spotify's desktop app as the source of songs' ISRCs and releases: the desktop metadata read
 * (spclient) and GraphQL getAlbum only, paced in the background, never the Web API.
 */
export function communitySongReleaseSources(databaseName = getTagifyDatabaseName()): SongReleaseSources {
  return {
    async knownSongs(uris) {
      const tracks = await storageService.getTracks(uris);
      return new Map([...tracks].map(([uri, track]) => [uri, { isrc: track.recordingIdentity?.isrc ?? null, albumUri: track.albumUri ?? null }] as const));
    },
    trackRelease: (uri) => spotifyApiService.getTrackRelease(uri, { priority: "background", feature: "recording-matching" }),
    albumRelease: (albumUri) => spotifyApiService.getAlbumRelease(albumUri, { priority: "background", feature: "metadata-backfill" }),
    reserve: watchedReserve((identity) => spotifyBackgroundPolicy.reserve(SONG_RELEASE_FEATURE, identity, SONG_RELEASE_HOURLY_READS)),
    pace: () => new Promise((resolve) => setTimeout(resolve, READ_INTERVAL_MS)),
    outsideLibrary: communityCatalogFillAllowance(),
    // The ISRC reads above already return each song's recording identity. Saving it lets same-song
    // linking match saved songs whose titles differ (a Japanese and a romanized title, for example).
    // Only songs saved in this library without one gain it; annotations and dateModified stay.
    async rememberIdentities(identities) {
      if (databaseName !== getTagifyDatabaseName() || isLocalPersistencePaused()) return;
      await flushLocalPersistence();
      if (databaseName !== getTagifyDatabaseName() || isLocalPersistencePaused()) return;
      const saved = await indexedDBStorage.rememberRecordingIdentities(identities, databaseName);
      // The Tagify page reloads saved songs, and its library check links the new ISRC matches.
      if (Object.keys(saved).length) dispatchTagDataUpdatedEvent("songDetails");
    },
  };
}
