import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { storageService } from "@/services/storage/StorageService";
import { watchedReserve } from "./CatalogFillLive";
import {
  CATALOG_FILL_FEATURE, catalogFillBackoff, catalogFillPace, withinDailyCap, type CatalogFillAllowance,
} from "./CommunityCatalogFill";

/**
 * The allowance for music outside this library, at the pace Community last advertised for this
 * desktop (the conservative constants otherwise): its own hourly reservations (which also hold
 * while Spotify asks Tagify to wait), the day's cap on this computer, and the wait before each
 * read, longer after each Spotify refusal.
 */
export function communityCatalogFillAllowance(): CatalogFillAllowance {
  const backoff = catalogFillBackoff(() => spotifyBackgroundPolicy.retryAt());
  return {
    async libraryTracks(uris) { return new Set((await storageService.getTracks(uris)).keys()); },
    reserve: watchedReserve(withinDailyCap((identity) => {
      backoff.note();
      return spotifyBackgroundPolicy.reserve(CATALOG_FILL_FEATURE, identity, catalogFillPace().hourlyReads);
    }, { dailyReads: () => catalogFillPace().dailyReads })),
    pace: () => new Promise<void>((resolve) => setTimeout(resolve, catalogFillPace().readIntervalMs * backoff.slowdown())),
  };
}
