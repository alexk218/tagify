import { getDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncClientHeaders } from "@/services/sync/SyncClientHeaders";
import { COMMUNITY_ORIGIN } from "../communityLinks";

/**
 * Songs other members tagged with some tags, from Community, for the track list's "On Community"
 * block (switch `communityTagSearch`). Community decides how many songs to return: a few for people
 * who aren't connected or don't share their tags (`locked` says which), full pages for members who do.
 */
export const TAG_SEARCH_PATH = "/api/v2/desktop/tag-search";
/** Tags Community takes in one search. */
export const TAG_SEARCH_MAX_TAGS = 10;

export type TagSearchLock = "connect" | "share";
export type TagSearchMatch = "any" | "all";

export interface TagSearchSong {
  /** spotify:track:… */
  uri: string;
  /** Missing when Community has no name for it (it sends ""); the row then asks Spotify. */
  title: string | null;
  artists: string[];
  imageUrl: string | null;
  /** Members who tagged the song. */
  people: number;
  /** The song's tag names that match the search, as members wrote them. */
  tags: string[];
}

export interface TagSearchPage {
  songs: TagSearchSong[];
  /** Every song Community found, which can be more than it returned. */
  total: number;
  /** Community stopped counting: there are at least `total`. */
  capped: boolean;
  /** Why the rest is held back; null for a member who shares their tags. */
  locked: TagSearchLock | null;
  nextCursor: string | null;
}

export type TagSearchFailure = "not-available" | "paused" | "busy" | "unreachable";

export class TagSearchError extends Error {
  constructor(readonly reason: TagSearchFailure) {
    super(reason);
    this.name = "TagSearchError";
  }
}

const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;

type Session = Pick<DesktopSyncConfiguration, "apiBaseUrl" | "accessToken"> | null;

/** Reads Community's answer; songs it can't read are left out, an answer it can't read is an error. */
export function tagSearchPageOf(payload: unknown): TagSearchPage | null {
  const value = payload as { totalCount?: unknown; totalCountCapped?: unknown; locked?: unknown; nextCursor?: unknown; items?: unknown } | null;
  if (!value || !Array.isArray(value.items)) return null;
  const songs: TagSearchSong[] = [];
  const seen = new Set<string>();
  for (const item of value.items as Record<string, unknown>[]) {
    const id = typeof item?.spotifyTrackId === "string" ? item.spotifyTrackId : "";
    if (!SPOTIFY_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : null;
    const artists = Array.isArray(item.artists) ? item.artists.filter((name): name is string => typeof name === "string" && !!name.trim()) : [];
    // The route sends `imageUrl`; `thumbnailUrl` was an earlier draft of the same field.
    const image = item.imageUrl ?? item.thumbnailUrl;
    const imageUrl = typeof image === "string" && /^https:\/\//.test(image) ? image : null;
    const people = Number.isInteger(item.people) && (item.people as number) > 0 ? item.people as number : 1;
    const tags = Array.isArray(item.tags)
      ? (item.tags as unknown[])
        // `{label, people}` from the route; plain names from an earlier draft.
        .map((tag) => (typeof tag === "string" ? tag : typeof (tag as { label?: unknown } | null)?.label === "string" ? (tag as { label: string }).label : ""))
        .map((tag) => tag.trim())
        .filter(Boolean)
      : [];
    songs.push({ uri: `spotify:track:${id}`, title, artists, imageUrl, people, tags });
  }
  const locked = value.locked === "connect" || value.locked === "share" ? value.locked : null;
  const total = typeof value.totalCount === "number" && Number.isInteger(value.totalCount) && value.totalCount >= 0 ? value.totalCount : songs.length;
  const nextCursor = !locked && typeof value.nextCursor === "string" && value.nextCursor ? value.nextCursor : null;
  return { songs, total: Math.max(total, songs.length), capped: value.totalCountCapped === true, locked, nextCursor };
}

/** The search's address, tags in the order given (Community ignores repeats). */
export function tagSearchUrl(origin: string, tags: readonly string[], match: TagSearchMatch, cursor?: string | null): string {
  const query = new URLSearchParams();
  for (const tag of tags.slice(0, TAG_SEARCH_MAX_TAGS)) query.append("tag", tag);
  query.set("match", match);
  if (cursor) query.set("cursor", cursor);
  return `${origin}${TAG_SEARCH_PATH}?${query.toString()}`;
}

/**
 * One page of songs tagged with these tags. Connected devices send their session, so Community can
 * tell whether the member shares their tags; others ask the public Community address.
 */
export async function searchCommunityTags(tags: readonly string[], {
  match = "any", cursor = null, request = fetch, session = () => getDesktopSyncConfiguration(), signal,
}: {
  match?: TagSearchMatch;
  cursor?: string | null;
  request?: typeof fetch;
  session?: () => Session;
  signal?: AbortSignal;
} = {}): Promise<TagSearchPage> {
  const current = session();
  const origin = current?.apiBaseUrl || COMMUNITY_ORIGIN;
  const ask = async (token: string | undefined) => {
    try {
      return await request(tagSearchUrl(origin, tags, match, cursor), { method: "GET", headers: syncClientHeaders(token), signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TagSearchError("unreachable");
    }
  };
  let response = await ask(current?.accessToken || undefined);
  // A device session Community no longer accepts: ask as someone who isn't connected.
  if (response.status === 401 && current?.accessToken) response = await ask(undefined);
  // A Community from before the search answers 404; with it switched off, 503.
  if (response.status === 404 || response.status === 405) throw new TagSearchError("not-available");
  if (response.status === 503) throw new TagSearchError("paused");
  if (response.status === 429) throw new TagSearchError("busy");
  if (!response.ok) throw new TagSearchError("unreachable");
  const page = tagSearchPageOf(await response.json().catch(() => null));
  if (!page) throw new TagSearchError("unreachable");
  return page;
}
