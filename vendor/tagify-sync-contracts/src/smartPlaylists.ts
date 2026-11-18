// One list of smart playlists for Tagify desktop and Community (Community migration 9002, pending
// number; packages/tagify-community/docs/SMART_PLAYLIST_SYNC_HANDOFF_2026-11-16.md). Alex,
// 2026-11-16: "Do smart playlists created on desktop propagate to the community library? they
// should. and vice versa." Community's playlists (`community_playlists`) are the only list. Tagify
// reads and writes it here when the capabilities document carries `smartPlaylists`; against older
// servers (or while this answers 503 smart_playlists_paused) it keeps its local list and the
// `smart-playlists` app-state document exactly as before.
//
//   GET    PATH?deviceId=…                                   → SmartPlaylistListV1
//   POST   PATH { deviceId, playlist }                       → { playlist } (a new playlist from your
//          tags; a desktopId already on Community updates that playlist instead, so a retry never
//          makes two)
//   PUT    PATH { deviceId, id, playlist, expectedUpdatedAt? } → { playlist }
//   DELETE PATH { deviceId, id }                             → { deleted } (the Spotify playlist stays)
//   POST   MOVE_PATH { deviceId }                            → SmartPlaylistMoveResultV1: copies the
//          library's `smart-playlists` app-state document into the list once (push app state
//          first). Each playlist keeps its desktop id and the Spotify playlist it fills; one whose
//          desktop id is already on Community is left alone. Later calls change nothing
//          (`alreadyMoved: true`).
//
// Tagify sends its own SmartPlaylistFilterCriteria (`criteria`) and gets it back in the same shape;
// Community works out its rules (`rules`) from it in the database. Nothing a member set is lost:
//   * a desktop setting Community can't read (an unknown key, a legacy Camelot range, a value out of
//     Community's bounds) is stored as sent and returned in `criteria` unchanged;
//   * rules Tagify can't edit (release year, length; everyone's or one person's tags) stay as they are:
//     an update leaves `length`/`released` alone, and playlists that aren't from your tags answer
//     409 edit_on_community to an update (`desktopEditable: false`; show "Edit on Community").
// Other errors: 409 smart_playlist_changed (expectedUpdatedAt is stale: read again), 404
// smart_playlist_gone, 409 smart_playlist_limit, 422 invalid_smart_playlist.
export const SMART_PLAYLISTS_PROTOCOL_VERSION = 1 as const;
export const SMART_PLAYLISTS_PATH = "/api/v2/sync/smart-playlists" as const;
export const SMART_PLAYLISTS_MOVE_PATH = "/api/v2/sync/smart-playlists/move" as const;
export const SMART_PLAYLIST_NAME_MAX = 100;
export const SMART_PLAYLIST_DESCRIPTION_MAX = 2000;
/** Bytes of `criteria` plus `extras` as JSON. */
export const SMART_PLAYLIST_SETTINGS_MAX_BYTES = 16_000;

export type SmartPlaylistOperatorV1 = "AND" | "OR";
export interface SmartPlaylistClauseV1 { tagIds: string[]; excludedTagIds: string[]; operator: SmartPlaylistOperatorV1 }

/** Tagify desktop's SmartPlaylistFilterCriteria. Unknown keys travel untouched. */
export interface DesktopSmartPlaylistCriteriaV1 {
  includeTagClauses: SmartPlaylistClauseV1[];
  clauseConnectors: SmartPlaylistOperatorV1[];
  ratingFilters: number[];
  energyMinFilter: number | null;
  energyMaxFilter: number | null;
  bpmMinFilter: number | null;
  bpmMaxFilter: number | null;
  camelotKeyFilters?: string[];
  [key: string]: unknown;
}

export interface SmartPlaylistV1 {
  id: string;
  /** Tagify's own id (`smart-playlist:<uuid>`); null for playlists made on Community. */
  desktopId: string | null;
  name: string;
  description: string;
  /** `library`: your tags. `community`: everyone's tags. `member`: one person's tag. */
  source: "library" | "community" | "member";
  origin: "community" | "desktop";
  /** Your-tags playlists as Tagify's criteria (null for the other sources). */
  criteria: DesktopSmartPlaylistCriteriaV1 | null;
  /** SmartPlaylistCriteria fields Community doesn't use (recipe `source`, pendingTagChoices…), as sent. */
  extras: Record<string, unknown>;
  /** Community's rules, read-only for Tagify. */
  rules: Record<string, unknown>;
  /** Tagify can edit every rule; otherwise show "Edit on Community". */
  desktopEditable: boolean;
  /** Desktop's "keep updating". */
  active: boolean;
  /** The Spotify playlist Tagify fills. */
  spotifyPlaylistId: string | null;
  songLimit: number;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SmartPlaylistListV1 { moved: boolean; playlists: SmartPlaylistV1[] }
export interface SmartPlaylistMoveResultV1 { moved: number; alreadyMoved: boolean; playlists: SmartPlaylistV1[] }

export interface SmartPlaylistInputV1 {
  desktopId?: string | null;
  name: string;
  description?: string;
  criteria: DesktopSmartPlaylistCriteriaV1;
  extras?: Record<string, unknown>;
  active?: boolean;
  spotifyPlaylistId?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DESKTOP_ID = /^[A-Za-z0-9:_.-]{1,128}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Checks the shape of a playlist Tagify sends; the database checks the rules themselves. */
export function assertSmartPlaylistInput(value: unknown): asserts value is SmartPlaylistInputV1 {
  const fail = () => { throw new Error("Invalid smart playlist"); };
  if (!record(value) || typeof value.name !== "string") return fail();
  const name = value.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > SMART_PLAYLIST_NAME_MAX) fail();
  if (value.desktopId !== undefined && value.desktopId !== null && (typeof value.desktopId !== "string" || !DESKTOP_ID.test(value.desktopId))) fail();
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > SMART_PLAYLIST_DESCRIPTION_MAX)) fail();
  if (value.active !== undefined && typeof value.active !== "boolean") fail();
  if (value.spotifyPlaylistId !== undefined && value.spotifyPlaylistId !== null && (typeof value.spotifyPlaylistId !== "string" || !SPOTIFY_ID.test(value.spotifyPlaylistId))) fail();
  if (!record(value.criteria) || (value.extras !== undefined && !record(value.extras))) fail();
  if (new TextEncoder().encode(JSON.stringify([value.criteria, value.extras ?? {}])).byteLength > SMART_PLAYLIST_SETTINGS_MAX_BYTES) fail();
}

export function assertSmartPlaylistId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid smart playlist");
}
