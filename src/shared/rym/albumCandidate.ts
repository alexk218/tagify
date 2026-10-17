/** A Spotify album offered as a match for an RYM release, whichever Spotify service found it. */
export interface SpotifyAlbumCandidate {
  uri: string;
  title: string;
  artists: string[];
  year: number | null;
  releaseType: string | null;
  playable: boolean;
  imageUrl: string | null;
}

/** "unsupported": album search is not available here. "unavailable": this search returned no usable response. */
export type SpotifyAlbumSearchResult =
  | { status: "unsupported" }
  | { status: "unavailable" }
  | { status: "available"; albums: SpotifyAlbumCandidate[]; hasMore: boolean; omittedResults: boolean };

export function validRymCandidate(value: unknown): value is SpotifyAlbumCandidate {
  if (!value || typeof value !== "object") return false;
  const album = value as SpotifyAlbumCandidate;
  return typeof album.uri === "string" && /^spotify:album:[A-Za-z0-9]{22}$/.test(album.uri) &&
    typeof album.title === "string" && album.title.trim().length > 0 && album.title.length <= 2000 &&
    Array.isArray(album.artists) && album.artists.length > 0 && album.artists.length <= 100 &&
    album.artists.every((name) => typeof name === "string" && name.trim().length > 0 && name.length <= 2000) &&
    (album.year === null || Number.isInteger(album.year) && album.year >= 1000 && album.year <= 9999) &&
    (album.releaseType === null || typeof album.releaseType === "string") && typeof album.playable === "boolean" &&
    (album.imageUrl === null || typeof album.imageUrl === "string" && /^https:\/\//.test(album.imageUrl));
}
