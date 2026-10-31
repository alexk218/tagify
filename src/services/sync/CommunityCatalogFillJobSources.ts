import { spotifyApiService } from "@/services/SpotifyApiService";
import { saveCatalogFillPace } from "./CommunityCatalogFill";
import type { CatalogFillJobSources } from "./CommunityCatalogFillJobs";
import { communityCatalogFillAllowance } from "./CommunityCatalogFillSources";

/** Discography pages read for one artist (100 releases each). */
const DISCOGRAPHY_PAGES = 10;

/**
 * Spotify's desktop app as the source of track lists and discographies Community asks the filler
 * for: GraphQL getAlbum and queryArtistDiscographyAll only, background priority, never the Web API,
 * under the filler's allowance (the same one the song fills use).
 */
export function communityCatalogFillJobSources(): CatalogFillJobSources {
  return {
    albumTracks: (albumUri) => spotifyApiService.getAlbumTracks(albumUri, { priority: "background", feature: "metadata-backfill" }),
    artistReleases: (artistUri, beforePage) => spotifyApiService.getArtistDiscography(artistUri, {
      priority: "background", feature: "metadata-backfill", beforePage, maxPages: DISCOGRAPHY_PAGES,
    }),
    allowance: communityCatalogFillAllowance(),
    savePace: (pace) => saveCatalogFillPace(pace),
  };
}
