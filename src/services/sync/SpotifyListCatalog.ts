import {
  MAX_CATALOG_PLAYLISTS, SPOTIFY_LIST_CATALOG_PATH, assertSpotifyListCatalog,
  type SpotifyListCatalogFailureV1, type SpotifyListCatalogV1,
} from "@tagify/sync-contracts";
import type { RootlistCatalogPlaylist } from "@/services/SpotifyApiService";
import { syncClientHeaders } from "./SyncClientHeaders";
import { clean, communityFolders, type SendSession } from "./SpotifyLibrarySender";

// Community's playlist picker (the spotify_list_choice migration): when the member opens it, Community asks this Tagify
// for the playlists in their Spotify library. Tagify answers with each playlist's name, folders,
// whether the member made it, and its size, read in one go from Spotify's library tree. No songs.

export interface CatalogReader {
  readSpotifyListCatalog(signal?: AbortSignal): Promise<{ likedCount: number | null; playlists: RootlistCatalogPlaylist[] }>;
}

const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
/** Names Community takes are at most 200 JavaScript characters, where an emoji counts as two. */
const NAME_MAX = 200;

/** Shortens a cleaned name to what Community takes, without cutting an emoji in half. */
function fitName(name: string): string {
  let fitted = "";
  for (const character of name) {
    if (fitted.length + character.length > NAME_MAX) break;
    fitted += character;
  }
  return fitted.trim();
}

/** The catalog as Community keeps it: Spotify's order, at most 2,000 playlists, folders as in sends. */
export function spotifyListCatalog(read: { likedCount: number | null; playlists: RootlistCatalogPlaylist[] }): SpotifyListCatalogV1 {
  const folderIds = new Set<string>();
  const playlists = read.playlists
    .map((playlist, index) => ({ playlist, position: index + 1 }))
    .filter(({ playlist }) => SPOTIFY_ID.test(playlist.playlistId))
    .slice(0, MAX_CATALOG_PLAYLISTS)
    .map(({ playlist, position }) => ({
      id: playlist.playlistId,
      name: fitName(clean(playlist.playlistName, NAME_MAX) ?? "Untitled playlist"),
      position,
      folders: communityFolders(playlist.folders, folderIds).map((folder) => ({ ...folder, name: fitName(folder.name) })),
      owned: playlist.owned,
      ownerName: playlist.owned ? null : (() => { const owner = clean(playlist.ownerName, NAME_MAX); return owner ? fitName(owner) : null; })(),
      songCount: playlist.songCount,
    }));
  const catalog = { likedCount: read.likedCount, playlists };
  assertSpotifyListCatalog(catalog);
  return catalog;
}

const handledKey = (libraryId: string) => `tagify:spotify-list-catalog-request:${libraryId}`;

/** Whether Community's catalog request is newer than the last one this computer answered. */
export function isNewCatalogRequest(libraryId: string, requestedAt: string | null | undefined): boolean {
  const requested = requestedAt ? Date.parse(requestedAt) : NaN;
  if (!Number.isFinite(requested)) return false;
  let handled = 0;
  try { handled = Number(localStorage.getItem(handledKey(libraryId)) || 0); } catch { /* storage unavailable: answer once more */ }
  return requested > handled;
}

export function markCatalogRequestHandled(libraryId: string, requestedAt: string): void {
  try { localStorage.setItem(handledKey(libraryId), String(Date.parse(requestedAt))); } catch { /* the next request is answered again */ }
}

/**
 * Reads the catalog and sends it to Community. `sent` when Community has it, `unsupported` when
 * this Community has no picker, `failed` otherwise: Tagify then tells Community it couldn't list
 * the playlists, so the picker offers to try again instead of waiting.
 */
export async function sendSpotifyListCatalog(session: SendSession, reader: CatalogReader, requestedAt: string, request: typeof fetch = fetch): Promise<"sent" | "unsupported" | "failed"> {
  let failure: SpotifyListCatalogFailureV1 = "unknown";
  try {
    failure = "spotify";
    const read = await reader.readSpotifyListCatalog();
    failure = "invalid";
    const catalog = spotifyListCatalog(read);
    failure = "unknown";
    const response = await put(session, request, { requestedAt, catalog });
    if (response.status === 404) return "unsupported";
    if (response.ok) return "sent";
    console.warn("Tagify sync: Community didn't take your playlist list", response.status);
    failure = "rejected";
  } catch (error) {
    console.warn("Tagify sync: your playlists couldn't be listed for Community", error instanceof Error ? error.message : error);
  }
  await reportCatalogFailure(session, request, requestedAt, failure);
  return "failed";
}

async function put(session: SendSession, request: typeof fetch, answer: { requestedAt: string } & ({ catalog: SpotifyListCatalogV1 } | { failure: SpotifyListCatalogFailureV1 })) {
  const current = await session();
  return request(`${current.apiBaseUrl}${SPOTIFY_LIST_CATALOG_PATH}`, {
    method: "PUT",
    headers: { ...syncClientHeaders(current.accessToken), "content-type": "application/json" },
    body: JSON.stringify({ deviceId: current.deviceId, ...answer }),
  });
}

/** Tells Community why the playlists couldn't be listed. A Community without failure reports refuses it; nothing else happens then. */
async function reportCatalogFailure(session: SendSession, request: typeof fetch, requestedAt: string, failure: SpotifyListCatalogFailureV1): Promise<void> {
  try {
    const response = await put(session, request, { requestedAt, failure });
    if (!response.ok && response.status !== 400 && response.status !== 404) console.warn("Tagify sync: Community didn't hear that your playlists couldn't be listed", response.status);
  } catch (error) {
    console.warn("Tagify sync: Community didn't hear that your playlists couldn't be listed", error instanceof Error ? error.message : error);
  }
}
