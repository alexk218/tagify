import {
  MAX_SPOTIFY_SEARCH_LOOKUP_ANSWERS, MAX_SPOTIFY_SEARCH_LOOKUP_ITEMS, SPOTIFY_SEARCH_LOOKUPS_PROTOCOL_VERSION, parseSpotifySearchLookups,
  type SpotifySearchLookupItemV1, type SpotifySearchLookupKind, type SpotifySearchLookupV1,
} from "@tagify/sync-contracts";
import {
  LookupScheduler, newLookupMemory, runLookupLane, withinDailySearchCap,
  type LookupAllowance, type LookupLane, type LookupMemory, type LookupRun, type LookupSchedulerOptions,
} from "./CommunityLookupLane";
import type { SendSession } from "./SpotifyLibrarySender";

// Desktop Spotify search (Community handoff DESKTOP_SPOTIFY_SEARCH_HANDOFF_2026-10-28, slice 1).
// When a member's Search Spotify on Community can't reach Spotify's Web API (the shared quota is
// paused or the site's searches for the day are used up), Community asks a catalog filler desktop
// (Alex's; `catalog_fill_desktops`) to run the same search in Spotify's desktop app. While Spotify
// (and Tagify in it) is open, a filler asks Community every 15 seconds for open searches (the text
// and kind only, never who searched), runs each through Spotify's in-app search (GraphQL, through
// the shared wrapper, never the Web API) and sends one page (at most 10) of what it found, or an
// empty list when Spotify found nothing. Kinds this Tagify can't search yet (slice 1 searches songs;
// albums and artists come later) are left for Community to expire, never guessed at. Its searches
// have an allowance of their own, apart from the catalog filler's and Now playing's, and stop at
// Spotify's first refusal or while Spotify asks Tagify to wait (CommunityLookupLane.ts).

export const SPOTIFY_SEARCH_LOOKUP_FEATURE = "community-spotify-search-lookups";
/** Searches for members' Search Spotify in an hour (the shared background reservations). */
export const SPOTIFY_SEARCH_LOOKUP_HOURLY_SEARCHES = 60;
/** Searches for members' Search Spotify in a UTC day on this computer. */
export const SPOTIFY_SEARCH_LOOKUP_DAILY_SEARCHES = 300;
/** The least time between two searches. */
export const SPOTIFY_SEARCH_LOOKUP_SEARCH_INTERVAL_MS = 2_000;
const DAY_KEY = "tagify:community-spotify-search-lookups:day:v1";

/** One kind's search: a page of items in Spotify's order; null when this Spotify has no such search. Throws when Spotify refuses. */
export type SpotifySearchLookupSearch = (query: string) => Promise<SpotifySearchLookupItemV1[] | null>;

export interface SpotifySearchLookupSources extends LookupAllowance {
  /** The searches this Tagify can run, by kind. A kind without one is skipped. */
  searches: Partial<Record<SpotifySearchLookupKind, SpotifySearchLookupSearch>>;
}

export type SpotifySearchLookupRun = LookupRun;
export type SpotifySearchLookupMemory = LookupMemory<SpotifySearchLookupItemV1[]>;
export const newSpotifySearchLookupMemory = (): SpotifySearchLookupMemory => newLookupMemory<SpotifySearchLookupItemV1[]>();

function spotifySearchLane(sources: SpotifySearchLookupSources): LookupLane<SpotifySearchLookupV1, SpotifySearchLookupItemV1[]> {
  return {
    route: "/api/v2/sync/spotify-search-lookups",
    protocolVersion: SPOTIFY_SEARCH_LOOKUPS_PROTOCOL_VERSION,
    answersPerPost: MAX_SPOTIFY_SEARCH_LOOKUP_ANSWERS,
    parse: (value) => { const parsed = parseSpotifySearchLookups(value); return { filler: parsed.filler, requests: parsed.searches }; },
    identity: (search) => `spotify-search-lookup:${search.requestId}`,
    canSearch: (search) => !!sources.searches[search.kind],
    search: async (search) => {
      const items = await sources.searches[search.kind]!(search.query);
      return items ? { answer: items.slice(0, MAX_SPOTIFY_SEARCH_LOOKUP_ITEMS) } : null;
    },
    answer: (requestId, items) => ({ requestId, items }),
  };
}

/**
 * Asks Community for open searches, runs each in Spotify's in-app search and answers. Answers found
 * before a stop are still sent. Never throws.
 */
export function runSpotifySearchLookups(
  session: SendSession, sources: SpotifySearchLookupSources,
  options: { request?: typeof fetch; memory?: SpotifySearchLookupMemory; now?: () => number } = {},
): Promise<SpotifySearchLookupRun> {
  return runLookupLane(spotifySearchLane(sources), session, sources, options);
}

/** Wraps the hourly reservation in the lane's day cap on this computer, kept across restarts. */
export function withinSpotifySearchDailyCap(
  reserve: (identity: string) => boolean,
  options: { storage?: Pick<Storage, "getItem" | "setItem"> | null; now?: () => number; dailySearches?: number } = {},
): (identity: string) => boolean {
  return withinDailySearchCap(reserve, { ...options, key: DAY_KEY, dailySearches: options.dailySearches ?? SPOTIFY_SEARCH_LOOKUP_DAILY_SEARCHES });
}

/** Runs the Spotify search lookups lane (see LookupScheduler). */
export class SpotifySearchLookupScheduler extends LookupScheduler<SpotifySearchLookupMemory> {
  constructor(options: LookupSchedulerOptions<SpotifySearchLookupMemory>) { super(options, newSpotifySearchLookupMemory()); }
}
