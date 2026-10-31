import {
  MAX_NOW_PLAYING_LOOKUP_ANSWERS, NOW_PLAYING_LOOKUPS_PROTOCOL_VERSION, parseNowPlayingLookups, type NowPlayingLookupV1,
} from "@tagify/sync-contracts";
import type { SpotifyTrackSearchResult } from "@/services/SpotifyTrackSearch";
import {
  LookupScheduler, newLookupMemory, runLookupLane, withinDailySearchCap,
  type LookupAllowance, type LookupLane, type LookupMemory, type LookupRun, type LookupSchedulerOptions, type LookupStop,
} from "./CommunityLookupLane";
import { lookupSearchTerm, pickSameSong } from "./NowPlayingLookupMatching";
import type { SendSession } from "./SpotifyLibrarySender";

// Now playing always finds the song (Community docs/NOW_PLAYING_ALWAYS_HANDOFF_2026-10-28.md,
// Slice 3, "desktop search lane"). When Community's Now playing card can't find what a member is
// playing, it asks a catalog filler desktop (Alex's; Community migration 9002) to search Spotify for
// it. While Spotify (and Tagify in it) is open, a filler asks Community every 15 seconds for open
// lookups (names only, never who is playing), searches Spotify's in-app song search for each
// (GraphQL `searchTracks` through the shared wrapper, never the Web API), and answers with the song
// that has the same title, version and artist, or null when Spotify has none. Its searches have an
// allowance of their own, apart from (and ahead of) the catalog filler's reads, and stop at
// Spotify's first refusal or while Spotify asks Tagify to wait. The loop, stops and backoff are
// shared with the other lookup lanes (CommunityLookupLane.ts).

export { LOOKUP_POLL_MS as NOW_PLAYING_LOOKUP_POLL_MS, NOT_A_FILLER_RECHECK_MS } from "./CommunityLookupLane";
export const NOW_PLAYING_LOOKUP_FEATURE = "community-now-playing-lookups";
/** Song searches for Now playing lookups in an hour (the shared background reservations). */
export const NOW_PLAYING_LOOKUP_HOURLY_SEARCHES = 60;
/** Song searches for Now playing lookups in a UTC day on this computer. */
export const NOW_PLAYING_LOOKUP_DAILY_SEARCHES = 400;
/** The least time between two searches. */
export const NOW_PLAYING_LOOKUP_SEARCH_INTERVAL_MS = 2_000;
const DAY_KEY = "tagify:community-now-playing-lookups:day:v1";

export interface NowPlayingLookupSources extends LookupAllowance {
  /** Spotify's song search, in Spotify's order; null when this Spotify has none. Throws when Spotify refuses. */
  search(term: string): Promise<SpotifyTrackSearchResult[] | null>;
}

export type NowPlayingLookupStop = LookupStop;
export type NowPlayingLookupRun = LookupRun;
export type NowPlayingLookupMemory = LookupMemory<string | null>;

export const newNowPlayingLookupMemory = (): NowPlayingLookupMemory => newLookupMemory<string | null>();

function nowPlayingLane(sources: NowPlayingLookupSources): LookupLane<NowPlayingLookupV1, string | null> {
  return {
    route: "/api/v2/sync/now-playing-lookups",
    protocolVersion: NOW_PLAYING_LOOKUPS_PROTOCOL_VERSION,
    answersPerPost: MAX_NOW_PLAYING_LOOKUP_ANSWERS,
    parse: (value) => { const parsed = parseNowPlayingLookups(value); return { filler: parsed.filler, requests: parsed.lookups }; },
    identity: (lookup) => `now-playing-lookup:${lookup.requestId}`,
    search: async (lookup) => {
      const results = await sources.search(lookupSearchTerm(lookup));
      return results ? { answer: pickSameSong(lookup, results) } : null;
    },
    answer: (requestId, spotifyTrackId) => ({ requestId, spotifyTrackId }),
  };
}

/**
 * Asks Community for open lookups, searches Spotify for each and answers. Answers found before a
 * stop are still sent. Never throws.
 */
export function runNowPlayingLookups(
  session: SendSession, sources: NowPlayingLookupSources,
  options: { request?: typeof fetch; memory?: NowPlayingLookupMemory; now?: () => number } = {},
): Promise<NowPlayingLookupRun> {
  return runLookupLane(nowPlayingLane(sources), session, sources, options);
}

/**
 * Wraps the hourly reservation in the day's cap for lookups on this computer, kept across
 * restarts. A search the hour refuses doesn't count against the day.
 */
export function withinLookupDailyCap(
  reserve: (identity: string) => boolean,
  options: { storage?: Pick<Storage, "getItem" | "setItem"> | null; now?: () => number; dailySearches?: number } = {},
): (identity: string) => boolean {
  return withinDailySearchCap(reserve, { ...options, key: DAY_KEY, dailySearches: options.dailySearches ?? NOW_PLAYING_LOOKUP_DAILY_SEARCHES });
}

export type NowPlayingLookupSchedulerOptions = LookupSchedulerOptions<NowPlayingLookupMemory>;

/** Runs the Now playing lookups lane (see LookupScheduler). */
export class NowPlayingLookupScheduler extends LookupScheduler<NowPlayingLookupMemory> {
  constructor(options: NowPlayingLookupSchedulerOptions) { super(options, newNowPlayingLookupMemory()); }
}
