// Playlists a member made on Community that their Tagify desktop keeps in Spotify (Community
// migration 0264_community_playlists). Tagify reports the `playlistWrites` device feature; then:
//   * the website broadcasts `playlist_write_request` on the library's private channel
//     (`tagify-library:<libraryId>`, payload { libraryId, requestedAt }) when a playlist needs writing;
//   * Tagify claims waiting playlists: POST /api/v2/sync/playlist-writes { deviceId } answers
//     { playlists: PlaylistWriteV1[] }, at most 5, each held for 2 minutes. It claims on start, on
//     the broadcast, and every 15 minutes while it is open (the claim also works out playlists of
//     everyone's tags again, so other people's tags reach Spotify);
//   * Tagify writes each one as a private Spotify playlist (creating it when `spotifyPlaylistId` is
//     null, else replacing that playlist's name and songs in order), then reports
//     PUT /api/v2/sync/playlist-writes { deviceId, results: PlaylistWriteResultV1[] }.
// Local files: for a playlist of the member's own library, Community may also send `uris`, every song
// in order with the member's local files as `spotify:local:` URIs. A Tagify that reads `uris` adds
// the local files its own Spotify lists, leaves listed local files that are already in the playlist
// (another computer added them), removes only `removedLocalUris`, and keeps local files the member
// added by hand. A Tagify that doesn't read `uris` writes `trackIds` as before.
export const PLAYLIST_WRITES_PROTOCOL_VERSION = 1 as const;
export const PLAYLIST_WRITES_FEATURE = "playlistWrites" as const;
export const PLAYLIST_WRITES_PATH = "/api/v2/sync/playlist-writes" as const;
export const PLAYLIST_WRITE_REQUEST_EVENT = "playlist_write_request" as const;
export const MAX_PLAYLIST_WRITES_PER_CLAIM = 5;
export const MAX_PLAYLIST_TRACKS = 500;
export const PLAYLIST_WRITE_CLAIM_SECONDS = 120;
export const PLAYLIST_WRITES_POLL_MINUTES = 15;

/** One playlist to write. `fingerprint` goes back unchanged in the result. */
export interface PlaylistWriteV1 {
  id: string;
  name: string;
  description: string;
  /** The Spotify playlist Tagify wrote before; null means create a new private one. */
  spotifyPlaylistId: string | null;
  /** Spotify track ids in order, at most 500. Empty means the playlist is emptied. */
  trackIds: string[];
  /**
   * Every song in order, at most 500: `spotify:track:<id>` for Spotify songs and `spotify:local:…`
   * for the member's local files. Sent only for playlists of the member's own library that match
   * local files; when present, Tagify writes these instead of `trackIds`.
   */
  uris?: string[];
  /** Local files Community asked for earlier that no longer match; Tagify removes them. */
  removedLocalUris?: string[];
  fingerprint: string;
}
export interface PlaylistWriteClaimV1 { playlists: PlaylistWriteV1[] }

/**
 * `written`: the Spotify playlist now holds exactly `trackIds` under `name`.
 * `failed`: `playlist_gone` when the Spotify playlist was deleted or isn't the member's any more
 * (Community waits for the member to ask again, then sends `spotifyPlaylistId: null`);
 * `spotify_busy` when Spotify refused for now (try again on a later claim after the member asks);
 * `spotify_unavailable` when Spotify's app couldn't be reached; `unknown` otherwise.
 */
export type PlaylistWriteFailureV1 = "spotify_unavailable" | "spotify_busy" | "playlist_gone" | "unknown";
export type PlaylistWriteResultV1 =
  | { id: string; result: "written"; spotifyPlaylistId: string; fingerprint: string }
  | { id: string; result: "failed"; failure: PlaylistWriteFailureV1 };
export interface PlaylistWriteReportV1 { deviceId: string; results: PlaylistWriteResultV1[] }

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const MAX_LOCAL_URI_LENGTH = 2048;
const isTrackUri = (value: unknown) => typeof value === "string" && value.startsWith("spotify:track:") && SPOTIFY_ID.test(value.slice(14));
/** A Spotify local-file URI as Spotify writes it: `spotify:local:artist:album:title:seconds`. */
export const isSpotifyLocalFileUri = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("spotify:local:") && value.length <= MAX_LOCAL_URI_LENGTH && value.split(":").length >= 6;
const optionalUris = (value: unknown, accept: (uri: unknown) => boolean) =>
  value === undefined || (Array.isArray(value) && value.length <= MAX_PLAYLIST_TRACKS && value.every(accept) && new Set(value).size === value.length);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT = /^[0-9a-f]{16}$/;
const FAILURES = new Set<PlaylistWriteFailureV1>(["spotify_unavailable", "spotify_busy", "playlist_gone", "unknown"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function assertPlaylistWriteClaim(value: unknown): asserts value is PlaylistWriteClaimV1 {
  if (!record(value) || !Array.isArray(value.playlists) || value.playlists.length > MAX_PLAYLIST_WRITES_PER_CLAIM) throw new Error("Invalid playlist writes");
  for (const item of value.playlists) {
    if (!record(item) || typeof item.id !== "string" || !UUID.test(item.id) || typeof item.name !== "string" || item.name.length < 1 || item.name.length > 100
      || typeof item.description !== "string" || !(item.spotifyPlaylistId === null || (typeof item.spotifyPlaylistId === "string" && SPOTIFY_ID.test(item.spotifyPlaylistId)))
      || !Array.isArray(item.trackIds) || item.trackIds.length > MAX_PLAYLIST_TRACKS
      || !item.trackIds.every((id) => typeof id === "string" && SPOTIFY_ID.test(id))
      || !optionalUris(item.uris, (uri) => isTrackUri(uri) || isSpotifyLocalFileUri(uri))
      || !optionalUris(item.removedLocalUris, isSpotifyLocalFileUri)
      || typeof item.fingerprint !== "string" || !FINGERPRINT.test(item.fingerprint)) throw new Error("Invalid playlist writes");
  }
}

export function assertPlaylistWriteReport(value: unknown): asserts value is PlaylistWriteReportV1 {
  if (!record(value) || typeof value.deviceId !== "string" || !UUID.test(value.deviceId) || !Array.isArray(value.results)
    || value.results.length < 1 || value.results.length > MAX_PLAYLIST_WRITES_PER_CLAIM) throw new Error("Invalid playlist write results");
  const seen = new Set<string>();
  for (const item of value.results) {
    if (!record(item) || typeof item.id !== "string" || !UUID.test(item.id) || seen.has(item.id)) throw new Error("Invalid playlist write results");
    seen.add(item.id);
    if (item.result === "written") {
      if (typeof item.spotifyPlaylistId !== "string" || !SPOTIFY_ID.test(item.spotifyPlaylistId) || typeof item.fingerprint !== "string" || !FINGERPRINT.test(item.fingerprint)
        || "failure" in item) throw new Error("Invalid playlist write results");
    } else if (item.result === "failed") {
      if (!FAILURES.has(item.failure as PlaylistWriteFailureV1) || "spotifyPlaylistId" in item) throw new Error("Invalid playlist write results");
    } else throw new Error("Invalid playlist write results");
  }
}
