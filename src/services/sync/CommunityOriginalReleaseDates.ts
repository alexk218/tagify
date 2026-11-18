import { assertOriginalReleaseDatesPage, isOriginalReleaseDate } from "@tagify/sync-contracts";
import type { TrackData } from "@/types/tagData";
import type { SendSession } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// The release date Tagify keeps for a song (TrackData releaseDate) is its album's, so a 2011
// remaster of a 1977 song reads as 2011. Community knows each recording's earliest release
// (@tagify/sync-contracts originalReleaseDates.ts) and its own Released filters use it. A linked
// Tagify reads those dates, a page at a time, and saves them as originalReleaseDate on songs already
// in this library, so the Released filter and Smart Playlists match Community's. Song details keep
// showing the album's date. Read-only on Community, no Spotify request, and only this one field is
// written: tags, ratings and dateModified stay as they are, so Last Updated ordering never changes.

/** At most this many pages a run: Community's offsets end at 100,000, 500 songs a page. */
export const MAX_ORIGINAL_RELEASE_DATE_PAGES = 200;

/** Where Tagify saves the dates it read. */
export interface OriginalReleaseDateSources {
  /**
   * Saves each song's original release date onto the songs in this library, keyed by track URI.
   * Songs that aren't in the library are skipped, never created. Resolves with how many changed.
   */
  save(dates: Map<string, string>): Promise<number>;
}

export interface OriginalReleaseDateRun {
  pages: number;
  /** Songs whose saved date changed. */
  saved: number;
  stopped?: "unsupported" | "paused" | "signed_out" | "network" | "invalid" | "save_failed";
}

class Stop extends Error {
  constructor(readonly reason: NonNullable<OriginalReleaseDateRun["stopped"]>) { super(`Original release dates stopped: ${reason}`); }
}

const stopFor = (status: number): NonNullable<OriginalReleaseDateRun["stopped"]> =>
  status === 404 ? "unsupported" : status === 503 ? "paused" : status === 401 || status === 403 ? "signed_out" : "network";

/** The track with Community's original release date; undefined when it already has that date or the date isn't valid. */
export function withOriginalReleaseDate(track: TrackData, date: unknown): TrackData | undefined {
  if (!isOriginalReleaseDate(date) || track.originalReleaseDate === date) return undefined;
  return { ...track, originalReleaseDate: date };
}

/**
 * Reads every page of original release dates Community has for this library and saves them, until
 * the last page or Community asks Tagify to stop. Never throws.
 */
export async function runOriginalReleaseDates(
  session: SendSession, sources: OriginalReleaseDateSources, options: { request?: typeof fetch; maxPages?: number } = {},
): Promise<OriginalReleaseDateRun> {
  const request = options.request ?? fetch;
  const run: OriginalReleaseDateRun = { pages: 0, saved: 0 };
  let offset = 0;
  try {
    for (let page = 0; page < (options.maxPages ?? MAX_ORIGINAL_RELEASE_DATE_PAGES); page++) {
      const current = await session();
      let response: Response;
      try {
        response = await request(`${current.apiBaseUrl}/api/v2/sync/original-release-dates?deviceId=${encodeURIComponent(current.deviceId)}&offset=${offset}`, {
          headers: syncClientHeaders(current.accessToken),
        });
      } catch {
        throw new Stop("network");
      }
      if (!response.ok) throw new Stop(stopFor(response.status));
      const body = await response.json().catch(() => null) as unknown;
      // Community's switch is off: keep what was saved and ask again on a later run.
      if ((body as { paused?: unknown } | null)?.paused === true) throw new Stop("paused");
      try { assertOriginalReleaseDatesPage(body, offset); } catch { throw new Stop("invalid"); }
      run.pages += 1;
      if (body.items.length) {
        const dates = new Map(body.items.map((item) => [`spotify:track:${item.entity.providerId}`, item.releaseDate] as const));
        try { run.saved += await sources.save(dates); } catch { throw new Stop("save_failed"); }
      }
      // A page can hold fewer than 500 songs and still have more after it. The check above keeps
      // offsets moving forward and within Community's last page.
      if (body.nextOffset === null) break;
      offset = body.nextOffset;
    }
  } catch (error) {
    run.stopped = error instanceof Stop ? error.reason : "network";
  }
  return run;
}
