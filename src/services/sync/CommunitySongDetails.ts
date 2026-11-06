import { normalizeReleaseDate, songDurationMs } from "@/utils/songDetails";
import {
  assertSongDetailsNeeded, MAX_SONG_DETAILS_NEEDED, MAX_SONG_DETAILS_REPORT_ITEMS, SONG_DETAILS_PROTOCOL_VERSION,
  type SongDetailsEntityV1, type SongDetailsReportItemV1,
} from "@tagify/sync-contracts";
import type { SendSession } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// Community's My library and Smart playlists filter by Length and Released. Tagify already keeps
// each song's length and release date (TrackData durationMs and releaseDate, filled from Spotify's
// desktop app by songDetailsFill since 3.3.5), so it sends them (Community pending migration 9001)
// and the filters cover the member's whole library. Community asks only for songs in this member's
// library it has no length or release date for from this desktop. Nothing here sends a Spotify
// request or writes track data: songs Tagify doesn't know yet are skipped and sent on a later run,
// once songDetailsFill has filled them.

/** Community answers offsets up to 100,000; one page of 500 at a time covers that. */
const MAX_OFFSET = 100_000;
const MAX_ROUNDS = MAX_OFFSET / MAX_SONG_DETAILS_NEEDED + 1;

/** A song's length and release date as Tagify saved them. */
export interface SavedSongDetails { durationMs?: unknown; releaseDate?: unknown }

/** Where Tagify finds song details. Reads only what Tagify saved on this computer. */
export interface SongDetailSources {
  savedSongs(trackUris: string[]): Promise<Map<string, SavedSongDetails>>;
}

export interface SongDetailRun {
  sent: number;
  stopped?: "unsupported" | "paused" | "signed_out" | "network";
}

class Stop extends Error {
  constructor(readonly reason: NonNullable<SongDetailRun["stopped"]>) { super(`Song details stopped: ${reason}`); }
}

const stopFor = (status: number): NonNullable<SongDetailRun["stopped"]> =>
  status === 404 ? "unsupported" : status === 503 ? "paused" : status === 401 || status === 403 ? "signed_out" : "network";

const uriOf = (entity: SongDetailsEntityV1) => `spotify:track:${entity.providerId}`;

/** A saved song's details as Community takes them, or null when Tagify knows neither yet. */
export function songDetailsItem(entity: SongDetailsEntityV1, saved: SavedSongDetails | null | undefined): SongDetailsReportItemV1 | null {
  const durationMs = songDurationMs(saved?.durationMs);
  const releaseDate = normalizeReleaseDate(saved?.releaseDate);
  return durationMs === null && releaseDate === null ? null : { entity, durationMs, releaseDate };
}

/**
 * Sends Community the song details it asked for, page by page, until nothing is left or Community
 * asks Tagify to stop. Never throws.
 */
export async function runSongDetailReports(
  session: SendSession, sources: SongDetailSources, options: { request?: typeof fetch; maxRounds?: number } = {},
): Promise<SongDetailRun> {
  const request = options.request ?? fetch;
  const run: SongDetailRun = { sent: 0 };
  const call = async (path: string, init: RequestInit = {}) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}/api/v2/sync/song-details${path.replace("{device}", encodeURIComponent(current.deviceId))}`, {
        ...init,
        headers: { ...syncClientHeaders(current.accessToken), ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch {
      throw new Stop("network");
    }
    if (!response.ok) throw new Stop(stopFor(response.status));
    const body = await response.json().catch(() => null) as unknown;
    // Community's song details switch is off: leave it alone until the next run.
    if ((body as { paused?: unknown } | null)?.paused === true) throw new Stop("paused");
    return body;
  };
  // Community keeps listing a song until it has both its length and release date. Songs this run
  // sent with both leave the list; the rest (unknown here, or sent with one) stay, so skip past them.
  const sent = new Set<string>();
  let offset = 0;
  try {
    for (let round = 0; round < (options.maxRounds ?? MAX_ROUNDS) && offset <= MAX_OFFSET; round++) {
      const body = await call(`?deviceId={device}&limit=${MAX_SONG_DETAILS_NEEDED}&offset=${offset}`);
      assertSongDetailsNeeded(body);
      if (!body.items.length) break;
      // A song sent earlier this run that's listed again kept its place: never send it twice.
      const fresh = body.items.filter((entity) => !sent.has(entity.providerId));
      const saved = fresh.length ? await sources.savedSongs(fresh.map(uriOf)) : new Map<string, SavedSongDetails>();
      const found = fresh
        .map((entity) => songDetailsItem(entity, saved.get(uriOf(entity))))
        .filter((item): item is SongDetailsReportItemV1 => item !== null);
      for (let start = 0; start < found.length; start += MAX_SONG_DETAILS_REPORT_ITEMS) {
        const items = found.slice(start, start + MAX_SONG_DETAILS_REPORT_ITEMS);
        const current = await session();
        await call("", { method: "POST", body: JSON.stringify({ protocolVersion: SONG_DETAILS_PROTOCOL_VERSION, deviceId: current.deviceId, items }) });
        for (const item of items) sent.add(item.entity.providerId);
        run.sent += items.length;
      }
      const left = found.filter((item) => item.durationMs !== null && item.releaseDate !== null).length;
      offset += body.items.length - left;
      if (!body.hasMore) break;
    }
  } catch (error) {
    run.stopped = error instanceof Stop ? error.reason : "network";
  }
  return run;
}
