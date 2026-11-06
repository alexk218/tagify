import { storageService } from "@/services/storage/StorageService";
import type { SongDetailSources } from "./CommunitySongDetails";

/** Tagify's own saved library as the source of song lengths and release dates: no Spotify request of any kind. */
export function communitySongDetailSources(): SongDetailSources {
  return {
    async savedSongs(uris) {
      const tracks = await storageService.getTracks(uris);
      return new Map([...tracks].map(([uri, track]) => [uri, { durationMs: track.durationMs, releaseDate: track.releaseDate }] as const));
    },
  };
}
