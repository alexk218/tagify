import type { PublicEntityViewV1, TagAgreementV1 } from "@tagify/community-contracts";
import { lookupCommunityEntity, type CommunityEntityLookup } from "@/features/community/communityEntityCache";
import type { SpotifyTrack } from "@/types/SpotifyTypes";

/** The first run checks at most this many Liked Songs, newest first. */
export const MAX_CHECKED_SONGS = 500;
/** It stops early once this many songs carry a tag two or more members agree on. */
export const ENOUGH_STRONG_MATCHES = 3;
const STRONG_PEOPLE = 2;
/** The best-tagged songs shown. */
export const MAX_SHOWN_MATCHES = 10;
/** Asks Community a few songs at a time, so a new install never sends a burst. */
const LOOKUP_CONCURRENCY = 4;
const TAGS_PER_SONG = 3;

export interface CommunityMatchTag {
  label: string;
  /** Where people keep it, "Category / Folder / Tag", most people first, to file it the same way. */
  paths: string[];
  people: number;
}

export interface CommunityMatch {
  track: SpotifyTrack;
  tags: CommunityMatchTag[];
}

type Lookup = (providerId: string) => Promise<CommunityEntityLookup>;

const trackIdOf = (uri: string) => (uri.startsWith("spotify:track:") ? uri.slice("spotify:track:".length) : null);

/** Other members' public tags on one song: Community's agreed names first, each with its most common place. */
export function communityTagsOf(entity: PublicEntityViewV1 | null): CommunityMatchTag[] {
  const tags = new Map<string, { label: string; people: number; paths: Map<string, number> }>();
  for (const contributor of entity?.contributors ?? []) {
    if (contributor.isOwn) continue;
    const seen = new Set<string>();
    for (const { label, path } of contributor.tags ?? []) {
      const name = typeof label === "string" ? label.trim() : "";
      const key = name.toLocaleLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const tag = tags.get(key) ?? { label: name, people: 0, paths: new Map() };
      tag.people += 1;
      const place = typeof path === "string" && path.trim() ? path.trim() : name;
      tag.paths.set(place, (tag.paths.get(place) ?? 0) + 1);
      tags.set(key, tag);
    }
  }
  const placesOf = (key: string, label: string) => {
    const paths = tags.get(key)?.paths;
    return paths?.size ? [...paths].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([path]) => path) : [label];
  };

  // Community leaves out placeholders and names only one member uses, so personal organizing tags never lead.
  const agreement = (entity as { tagAgreement?: TagAgreementV1 } | null)?.tagAgreement;
  if (agreement) {
    return agreement.tags.slice(0, TAGS_PER_SONG).map((tag) => {
      const key = [tag.label, ...tag.spellings].map((name) => name.toLocaleLowerCase()).find((name) => tags.has(name)) ?? tag.label.toLocaleLowerCase();
      return { label: tag.label, people: tag.people, paths: placesOf(key, tag.label) };
    });
  }
  return [...tags]
    .sort(([, a], [, b]) => b.people - a.people || a.label.localeCompare(b.label))
    .slice(0, TAGS_PER_SONG)
    .map(([key, { label, people }]) => ({ label, people, paths: placesOf(key, label) }));
}

const peopleOf = (match: CommunityMatch) => Math.max(...match.tags.map((tag) => tag.people));
const isStrong = (match: CommunityMatch) => peopleOf(match) >= STRONG_PEOPLE;

/**
 * The Liked Songs other members tagged most, best first. Checks the songs already read, then reads
 * further pages until enough songs carry tags several members agree on, or MAX_CHECKED_SONGS were
 * checked. Asks Community anonymously (song IDs only) and stops asking once it can't be reached;
 * a page Spotify can't read ends the search with what was found.
 */
export async function findCommunityMatches(
  firstPage: readonly SpotifyTrack[],
  { lookup = (id) => lookupCommunityEntity("track", id), loadMore, signal }: {
    lookup?: Lookup;
    /** The next page of Liked Songs, or null when there are no more. */
    loadMore?: () => Promise<readonly SpotifyTrack[] | null>;
    signal?: AbortSignal;
  } = {},
): Promise<CommunityMatch[]> {
  const found: { match: CommunityMatch; position: number }[] = [];
  const seen = new Set<string>();
  let checked = 0;
  let stopped = false;
  const enough = () => found.filter(({ match }) => isStrong(match)).length >= ENOUGH_STRONG_MATCHES;

  let page: readonly SpotifyTrack[] | null = firstPage;
  while (page && !stopped && !signal?.aborted) {
    const songs = page.filter((track) => trackIdOf(track.uri) && !seen.has(track.uri)).slice(0, MAX_CHECKED_SONGS - checked);
    songs.forEach((track) => seen.add(track.uri));
    let next = 0;
    const worker = async () => {
      while (!stopped && !signal?.aborted && !enough() && next < songs.length) {
        const index = next++;
        const position = checked + index;
        const answer = await lookup(trackIdOf(songs[index].uri)!);
        if (answer.unavailable) { stopped = true; return; }
        const tags = answer.found ? communityTagsOf(answer.entity) : [];
        if (tags.length) found.push({ match: { track: songs[index], tags }, position });
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, songs.length) }, worker));
    checked += songs.length;
    if (enough() || checked >= MAX_CHECKED_SONGS || !loadMore) break;
    page = await loadMore().catch(() => null);
  }

  return found
    .sort((a, b) => peopleOf(b.match) - peopleOf(a.match) || a.position - b.position)
    .slice(0, MAX_SHOWN_MATCHES)
    .map(({ match }) => match);
}
