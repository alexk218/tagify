import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { spotifyService } from "@/services/SpotifyService";
import { storageService } from "@/services/storage/StorageService";
import { trackArtistIdentitiesStore } from "@/services/trackArtistIdentities";
import { ARTIST_CREDIT_FEATURE, ARTIST_CREDIT_HOURLY_READS, type ArtistCreditSources } from "./CommunityArtistCredits";

const READ_INTERVAL_MS = 1_000;
const background = { priority: "background", feature: "artist-identities" } as const;

/** Spotify's desktop app as the artist source: GraphQL reads only, paced, never the Web API. */
export function communityArtistCreditSources(): ArtistCreditSources {
  return {
    knownTrackArtists: (uri) => trackArtistIdentitiesStore.getSnapshot()[uri]?.artists ?? null,
    async trackAlbums(uris) {
      const tracks = await storageService.getTracks(uris);
      return new Map([...tracks].flatMap(([uri, track]) => track.albumUri ? [[uri, track.albumUri] as const] : []));
    },
    async albumTrackArtists(albumUri) {
      const tracks = await spotifyApiService.getAlbumTracks(albumUri, background);
      if (!tracks) return null;
      const listing = new Map(tracks.map((track) => [track.uri, track.artistsData ?? []] as const));
      trackArtistIdentitiesStore.rememberMany(listing);
      return listing;
    },
    trackArtists: (uri) => spotifyService.getTrackArtists(uri, "background"),
    albumArtists: (albumUri) => spotifyApiService.getAlbumArtists(albumUri, background),
    reserve: (identity) => spotifyBackgroundPolicy.reserve(ARTIST_CREDIT_FEATURE, identity, ARTIST_CREDIT_HOURLY_READS),
    pace: () => new Promise((resolve) => setTimeout(resolve, READ_INTERVAL_MS)),
  };
}
