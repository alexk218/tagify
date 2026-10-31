// Choosing which Spotify lists Tagify brings to Community (Community's spotify_list_choice migration). A Tagify
// desktop that reports the `spotifyListChoice` device feature takes part:
//   * the member opens the picker on Community; the website broadcasts `spotify_library_catalog_request`
//     on the library's private channel (`tagify-library:<libraryId>`, payload { libraryId, requestedAt })
//     and sets the pull side document `spotifyLibraryCatalogRequestedAt` for a desktop that isn't open;
//   * Tagify reads Spotify's library tree once and answers
//     PUT /api/v2/sync/spotify-library/catalog { deviceId, requestedAt, catalog: SpotifyListCatalogV1 }:
//     every playlist with its folders, whether the member made it, and its song count. No songs.
//     When it can't list them it answers the same route with { deviceId, requestedAt, failure }
//     instead, so the picker says so rather than waiting (an older Community refuses that body);
//   * the member ticks lists and asks for a send with a SpotifyListSelectionV1; POST
//     /api/v2/sync/spotify-library/send answers `started` with `selection`, and Tagify reads and
//     sends only those lists. Lists already on Community that weren't chosen stay there.
// A send without `selection` (an older Community) is a send of everything, as before.
export const SPOTIFY_LIST_CHOICE_PROTOCOL_VERSION = 1 as const;
export const SPOTIFY_LIST_CHOICE_FEATURE = "spotifyListChoice" as const;
export const SPOTIFY_LIST_CATALOG_PATH = "/api/v2/sync/spotify-library/catalog" as const;
export const SPOTIFY_LIST_CATALOG_REQUEST_EVENT = "spotify_library_catalog_request" as const;
export const MAX_CATALOG_PLAYLISTS = 2_000;
export const MAX_CATALOG_FOLDERS = 2_000;
export const MAX_CATALOG_FOLDER_DEPTH = 8;

export interface SpotifyListCatalogFolderV1 { id: string; name: string }

/** One playlist in the member's Spotify library, in Spotify's order (`position` from 1). */
export interface SpotifyListCatalogPlaylistV1 {
  id: string;
  name: string;
  position: number;
  /** Folders it sits in, outermost first; empty at the top level. */
  folders: SpotifyListCatalogFolderV1[];
  /** The member made it, or can edit it as a collaborator. False when Spotify didn't say. */
  owned: boolean;
  /** The owner's display name for a playlist the member didn't make, when Spotify gave one. */
  ownerName: string | null;
  /** Songs and episodes Spotify counts in it, when Spotify gave a count. */
  songCount: number | null;
}

export interface SpotifyListCatalogV1 {
  /** Liked Songs' size, when Spotify gave it. */
  likedCount: number | null;
  playlists: SpotifyListCatalogPlaylistV1[];
}

export interface SpotifyListCatalogReportV1 { deviceId: string; requestedAt: string; catalog: SpotifyListCatalogV1 }

/**
 * Why Tagify couldn't list the playlists: `spotify` (Spotify didn't give its library), `invalid`
 * (Tagify couldn't make a list Community takes), `rejected` (Community refused the list Tagify
 * sent), `unknown` (anything else).
 */
export const SPOTIFY_LIST_CATALOG_FAILURES = ["spotify", "invalid", "rejected", "unknown"] as const;
export type SpotifyListCatalogFailureV1 = (typeof SPOTIFY_LIST_CATALOG_FAILURES)[number];
export interface SpotifyListCatalogFailureReportV1 { deviceId: string; requestedAt: string; failure: SpotifyListCatalogFailureV1 }

/** What the member chose: Liked Songs or not, and which playlists by Spotify ID. */
export interface SpotifyListSelectionV1 {
  liked: boolean;
  playlistIds: string[];
  /** The member turned on "Include playlists made by others" (chosen ones are in `playlistIds`). */
  includeFollowed: boolean;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const FOLDER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const count = (value: unknown) => value === null || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000);

export function assertSpotifyListCatalog(value: unknown): asserts value is SpotifyListCatalogV1 {
  if (!record(value) || !count(value.likedCount) || !Array.isArray(value.playlists) || value.playlists.length > MAX_CATALOG_PLAYLISTS) throw new Error("Invalid Spotify list catalog");
  const seen = new Set<string>(), folders = new Set<string>();
  for (const item of value.playlists) {
    if (!record(item) || typeof item.id !== "string" || !SPOTIFY_ID.test(item.id) || seen.has(item.id) || !text(item.name, 200)
      || !Number.isSafeInteger(item.position) || Number(item.position) < 1 || typeof item.owned !== "boolean"
      || !(item.ownerName === null || text(item.ownerName, 200)) || !count(item.songCount)
      || !Array.isArray(item.folders) || item.folders.length > MAX_CATALOG_FOLDER_DEPTH) throw new Error("Invalid Spotify list catalog");
    seen.add(item.id);
    for (const folder of item.folders) {
      if (!record(folder) || typeof folder.id !== "string" || !FOLDER_ID.test(folder.id) || !text(folder.name, 200)) throw new Error("Invalid Spotify list catalog");
      folders.add(folder.id);
    }
  }
  if (folders.size > MAX_CATALOG_FOLDERS) throw new Error("Invalid Spotify list catalog");
}

const answer = (value: unknown): value is Record<string, unknown> => record(value) && typeof value.deviceId === "string" && UUID.test(value.deviceId)
  && typeof value.requestedAt === "string" && Number.isFinite(Date.parse(value.requestedAt));

export function assertSpotifyListCatalogReport(value: unknown): asserts value is SpotifyListCatalogReportV1 {
  if (!answer(value)) throw new Error("Invalid Spotify list catalog");
  assertSpotifyListCatalog(value.catalog);
}

export function assertSpotifyListCatalogFailureReport(value: unknown): asserts value is SpotifyListCatalogFailureReportV1 {
  if (!answer(value) || "catalog" in value || !(SPOTIFY_LIST_CATALOG_FAILURES as readonly unknown[]).includes(value.failure)) throw new Error("Invalid Spotify list catalog");
}

export function assertSpotifyListSelection(value: unknown): asserts value is SpotifyListSelectionV1 {
  if (!record(value) || typeof value.liked !== "boolean" || typeof value.includeFollowed !== "boolean"
    || !Array.isArray(value.playlistIds) || value.playlistIds.length > MAX_CATALOG_PLAYLISTS
    || new Set(value.playlistIds).size !== value.playlistIds.length
    || !value.playlistIds.every((id) => typeof id === "string" && SPOTIFY_ID.test(id))
    || (!value.liked && value.playlistIds.length === 0)) throw new Error("Invalid Spotify list choice");
}
