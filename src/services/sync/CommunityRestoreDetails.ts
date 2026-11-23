import { MAX_RESTORE_DETAILS_PAGE, parseRestoreDetailsPage, type RestoreDetailV1 } from "@tagify/sync-contracts";
import type { TagDataStructure } from "@/types/tagData";
import { syncClientHeaders } from "./SyncClientHeaders";

// A library restored from Community comes back with tags, ratings, energy, BPM and key only: the
// sync snapshot carries no names. Without help every song shows "Unknown Track" until Tagify has
// asked Spotify for it again, about 50 songs each time Spotify starts. Community keeps the names,
// artists, albums and artwork of its members' music (Community migration desktop_restore_details),
// so Tagify reads them while it restores and saves them with the restored library. These are
// display details only: they never count as edits, never send anything back and never change a
// song's Last Updated date. Anything Community can't name is left for Tagify's usual Spotify fill.

/** Pages read at most: 20,000 songs, albums, artists and playlists. */
const MAX_PAGES = 40;
/** The whole read gives up after this long; the restore goes on without the rest. */
const TOTAL_TIMEOUT_MS = 20_000;

export interface RestoreDetailsSession { apiBaseUrl: string; accessToken: string; deviceId: string }

/**
 * Every detail Community has for this device's library, by Spotify URI. Never throws: an older
 * Community (no such route), a paused switch, a network error or a timeout ends the read with what
 * it has so far, and the restore goes on.
 */
export async function readRestoreDetails(
  session: RestoreDetailsSession,
  options: { request?: typeof fetch; timeoutMs?: number; maxPages?: number } = {},
): Promise<Map<string, RestoreDetailV1>> {
  const request = options.request ?? fetch;
  const details = new Map<string, RestoreDetailV1>();
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? TOTAL_TIMEOUT_MS) : null;
  try {
    let after: string | null = null;
    for (let page = 0; page < (options.maxPages ?? MAX_PAGES); page++) {
      const query = `deviceId=${encodeURIComponent(session.deviceId)}&limit=${MAX_RESTORE_DETAILS_PAGE}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const response = await request(`${session.apiBaseUrl}/api/v2/sync/restore-details?${query}`, {
        headers: syncClientHeaders(session.accessToken),
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) break;
      const body = parseRestoreDetailsPage(await response.json());
      for (const item of body.items) details.set(`spotify:${item.entity.kind}:${item.entity.providerId}`, item);
      if (body.paused || !body.nextCursor) break;
      after = body.nextCursor;
    }
  } catch (error) {
    console.warn("[Tagify] Song names from Community stopped early; Tagify will look up the rest itself", error);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return details;
}

/**
 * Restored songs, albums, artists and playlists with the names and artwork Community knows. Only
 * empty fields are filled; tags, ratings, BPM, key and dates are never touched.
 */
export function withRestoreDetails(data: TagDataStructure, details: Map<string, RestoreDetailV1>): TagDataStructure {
  if (!details.size) return data;
  const albumsFromSongs = new Map<string, { name: string; imageUrl: string | null }>();
  const tracks = Object.fromEntries(Object.entries(data.tracks).map(([uri, track]) => {
    const detail = details.get(uri);
    if (!detail) return [uri, track];
    if (detail.album) albumsFromSongs.set(`spotify:album:${detail.album.providerId}`, { name: detail.album.name, imageUrl: detail.album.imageUrl });
    return [uri, {
      ...track,
      ...(!track.name && detail.title ? { name: detail.title } : {}),
      ...(!track.artists && detail.artists ? { artists: detail.artists } : {}),
      ...(!track.albumUri && detail.album ? { albumUri: `spotify:album:${detail.album.providerId}` } : {}),
      ...(!track.albumName && detail.album ? { albumName: detail.album.name } : {}),
      ...(!track.albumImageUrl && (detail.album?.imageUrl || detail.imageUrl) ? { albumImageUrl: detail.album?.imageUrl || detail.imageUrl } : {}),
      ...(!track.releaseDate && detail.album?.releaseDate ? { releaseDate: detail.album.releaseDate } : {}),
    }];
  }));
  const playlists = Object.fromEntries(Object.entries(data.playlists).map(([uri, playlist]) => {
    const detail = details.get(uri);
    const fromSong = albumsFromSongs.get(uri);
    const name = detail?.title || fromSong?.name;
    const imageUrl = detail?.imageUrl || fromSong?.imageUrl;
    return [uri, {
      ...playlist,
      ...(!playlist.name && name ? { name } : {}),
      ...(!playlist.imageUrl && imageUrl ? { imageUrl } : {}),
    }];
  }));
  const artists = Object.fromEntries(Object.entries(data.artists).map(([uri, artist]) => {
    const detail = details.get(uri);
    if (!detail) return [uri, artist];
    return [uri, {
      ...artist,
      ...(!artist.name && detail.title ? { name: detail.title } : {}),
      ...(!artist.imageUrl && detail.imageUrl ? { imageUrl: detail.imageUrl } : {}),
    }];
  }));
  return { ...data, tracks, playlists, artists };
}
