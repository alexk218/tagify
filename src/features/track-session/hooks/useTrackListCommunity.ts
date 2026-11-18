import { useEffect, useMemo, useState } from "react";
import {
  currentLookupSession,
  LOOKUP_CONCURRENCY,
  LOOKUP_MAX_SONGS,
  lookupTaggedByOthers,
  savedLookupLimit,
  TaggedByOthersLookupError,
  type CommunityStop,
  type TaggedByOthersItem,
} from "@/features/community/taggedByOthers/taggedByOthersScan";

/** Answers are kept for this long in this Spotify session before the list asks Community again. */
export const TRACK_LIST_COMMUNITY_FRESH_MS = 60 * 60_000;

export type TrackListCommunityStatus = "off" | "checking" | "done" | CommunityStop;

export interface TrackListCommunity {
  /** Other members' tags for a song in the list, by Spotify URI; a song missing here has none. */
  others: ReadonlyMap<string, TaggedByOthersItem>;
  /** How many other members tagged each song, by Spotify URI, for sorting. */
  people: ReadonlyMap<string, number>;
  /** Whether this computer can ask Community at all (connected). */
  available: boolean;
  status: TrackListCommunityStatus;
}

type Lookup = (songs: string[], signal?: AbortSignal) => Promise<TaggedByOthersItem[]>;

interface CacheEntry { checkedAt: number; item: TaggedByOthersItem | null }

/** Shared by every track list in this Spotify session, keyed by Community account. */
const cache = new Map<string, Map<string, CacheEntry>>();

export function forgetTrackListCommunity(): void {
  cache.clear();
}

const TRACK_PREFIX = "spotify:track:";
const SPOTIFY_ID = /^[A-Za-z0-9]{10,64}$/;

export function spotifyIdOf(uri: string): string | null {
  if (!uri.startsWith(TRACK_PREFIX)) return null;
  const id = uri.slice(TRACK_PREFIX.length);
  return SPOTIFY_ID.test(id) ? id : null;
}

/**
 * Asks Community, in batches, which of these songs other members tagged. Songs answered within the
 * last hour are not asked again. Stops at the first batch Community can't answer and keeps what it
 * has; nothing is retried.
 */
export async function lookupTrackListCommunity(ids: string[], {
  account,
  lookup,
  batchSize = LOOKUP_MAX_SONGS,
  now = Date.now,
  signal,
  onBatch,
}: {
  account: string;
  lookup: Lookup;
  batchSize?: number;
  now?: () => number;
  signal?: AbortSignal;
  onBatch?: () => void;
}): Promise<CommunityStop | null> {
  let known = cache.get(account);
  if (!known) { known = new Map(); cache.set(account, known); }
  const entries = known;
  const due = [...new Set(ids)].filter((id) => {
    const entry = entries.get(id);
    return !entry || now() - entry.checkedAt > TRACK_LIST_COMMUNITY_FRESH_MS;
  });
  const batches: string[][] = [];
  for (let start = 0; start < due.length; start += batchSize) batches.push(due.slice(start, start + batchSize));

  let stop: CommunityStop | null = null;
  let next = 0;
  const worker = async () => {
    while (!stop && !signal?.aborted && next < batches.length) {
      const batch = batches[next++];
      try {
        const items = await lookup(batch, signal);
        const checkedAt = now();
        const found = new Map(items.map((item) => [item.providerId, item]));
        for (const id of batch) entries.set(id, { checkedAt, item: found.get(id) ?? null });
        onBatch?.();
      } catch (error) {
        if (signal?.aborted) return;
        stop = error instanceof TaggedByOthersLookupError ? error.reason : "unreachable";
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, batches.length) }, worker));
  return stop;
}

function readCached(account: string, uris: string[]): Map<string, TaggedByOthersItem> {
  const known = cache.get(account);
  const others = new Map<string, TaggedByOthersItem>();
  if (!known) return others;
  for (const uri of uris) {
    const id = spotifyIdOf(uri);
    const item = id ? known.get(id)?.item : null;
    if (item) others.set(uri, item);
  }
  return others;
}

/**
 * Other members' tags for the songs in the track list. Only a computer connected to Community asks;
 * otherwise nothing is looked up and the list shows no Community data.
 */
export function useTrackListCommunity(uris: string[], { session = currentLookupSession, request }: {
  session?: typeof currentLookupSession;
  request?: typeof fetch;
} = {}): TrackListCommunity {
  const current = session();
  const account = current ? `${current.apiBaseUrl}|${current.deviceId}` : null;
  const offered = current ? savedLookupLimit(current.apiBaseUrl) !== null : false;
  const available = !!account && offered;
  const idsKey = useMemo(() => uris.map(spotifyIdOf).filter((id): id is string => !!id).sort().join(","), [uris]);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<TrackListCommunityStatus>("off");

  useEffect(() => {
    if (!available || !account || !idsKey) { setStatus("off"); return; }
    const controller = new AbortController();
    const limit = current ? savedLookupLimit(current.apiBaseUrl) : undefined;
    setStatus("checking");
    lookupTrackListCommunity(idsKey.split(","), {
      account,
      batchSize: typeof limit === "number" ? limit : LOOKUP_MAX_SONGS,
      lookup: (songs, signal) => lookupTaggedByOthers(songs, { session, signal, ...(request ? { request } : {}) }),
      signal: controller.signal,
      onBatch: () => setVersion((value) => value + 1),
    }).then((stop) => {
      if (!controller.signal.aborted) setStatus(stop ?? "done");
    });
    return () => controller.abort();
    // `current` is read fresh each render; the lookup only restarts for another account or song set.
  }, [available, account, idsKey]);

  return useMemo(() => {
    const others = available && account ? readCached(account, uris) : new Map<string, TaggedByOthersItem>();
    const people = new Map<string, number>();
    for (const [uri, item] of others) people.set(uri, item.people);
    return { others, people, available, status: available ? status : "off" };
    // `version` changes when a batch arrives.
  }, [available, account, uris, status, version]);
}
