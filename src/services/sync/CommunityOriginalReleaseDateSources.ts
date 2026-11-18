import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import type { TrackData } from "@/types/tagData";
import { withOriginalReleaseDate, type OriginalReleaseDateSources } from "./CommunityOriginalReleaseDates";
import { getTagifyDatabaseName } from "./SyncLocalState";

/**
 * Saves original release dates onto this library's songs. Each song is changed from its current
 * saved record in one transaction, so edits made meanwhile are kept, and only originalReleaseDate
 * changes: dateModified (Last Updated) and every annotation stay exactly as they were. Writes stop
 * if the Spotify account changes during the run.
 */
export function communityOriginalReleaseDateSources(databaseName = getTagifyDatabaseName()): OriginalReleaseDateSources {
  return {
    async save(dates) {
      const changes: Record<string, (current: TrackData | null) => TrackData | undefined> = {};
      for (const [uri, date] of dates) changes[uri] = (current) => (current ? withOriginalReleaseDate(current, date) : undefined);
      return Object.keys(await indexedDBStorage.patchTracks(changes, { expectedDatabaseName: databaseName })).length;
    },
  };
}
