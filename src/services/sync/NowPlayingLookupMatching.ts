import type { NowPlayingLookupV1 } from "@tagify/sync-contracts";
import type { SpotifyTrackSearchResult } from "@/services/SpotifyTrackSearch";

// Which Spotify search result is the song a Now playing lookup names. Ported unchanged from
// Community's lib/now-playing/resolve.ts (normalizeName, title suffixes, versionOf, titleAgreement,
// sameArtist), so the desktop answers by the same rules Community checks the answer with: the same
// title, the same version and an artist in common. A remix, edit, live take or other recording is a
// song of its own ("Baby - Tony Romera Remix" is never "Baby"); remasters and featured artists name
// the same recording. Keep the two copies in step; never loosen one alone.

/** Lowercase, without accents, punctuation or "the", for comparing names across services. */
export function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\bthe\b/g, " ").replace(/\s+/g, " ").trim();
}

// "Song (Remastered 2011)", "Song - Radio Edit", "Song (feat. X)": services disagree on these.
const VERSION_SUFFIX = /\s*(?:[([][^)\]]*[)\]]|\s-\s.*)$/;

/** The title and its suffixes, outermost last ("Song (feat. X) - Radio Edit" is "Song", ["feat. X", "Radio Edit"]). */
function splitTitle(title: string): { bare: string; suffixes: string[] } {
  let bare = title;
  const suffixes: string[] = [];
  while (VERSION_SUFFIX.test(bare)) {
    const match = VERSION_SUFFIX.exec(bare)!;
    const next = bare.slice(0, match.index);
    if (!next.trim() || next === bare) break;
    suffixes.unshift(match[0].trim().replace(/^-\s*/, "").replace(/^[([]|[)\]]$/g, ""));
    bare = next;
  }
  return { bare: bare.trim(), suffixes };
}

/** The title without version suffixes ("Song - Remastered 2011" is "Song"). */
export function bareTitle(title: string): string {
  return splitTitle(title).bare;
}

const OTHER_VERSION = /\b(?:re-?mix(?:es|ed)?|mix|edit|live|acoustic|instrumental|demo|version|rework|re-?edit|dub|vip|bootleg|flip|reprise|extended|cover|karaoke|sped up|slowed|re-?recorded|unplugged|session|a cappella|acapella)\b/i;
const SAME_RECORDING = /^(?:original(?: mix| version)?|album version|(?:\d{4} )?remaster(?:ed)?(?: \d{4})?(?: version)?|(?:explicit|clean)(?: version)?|(?:mono|stereo)(?: version)?)$/i;

const isOtherVersion = (suffix: string) => {
  const words = normalizeName(suffix);
  return Boolean(words) && OTHER_VERSION.test(words) && !SAME_RECORDING.test(words) && !/^(?:feat|ft|featuring|with)\b/.test(words);
};

/** The suffixes that make this a different recording, normalized ("tony romera remix"); empty for the original. */
export function versionOf(title: string): string[] {
  return splitTitle(title).suffixes.filter(isOtherVersion).map(normalizeName);
}

/** The title as searched for: the version kept, remasters and featured artists left out. */
export function searchTitle(title: string): string {
  const { bare, suffixes } = splitTitle(title);
  return [bare, ...suffixes.filter(isOtherVersion)].join(" ").trim() || title;
}

/** How closely two titles agree: 2 written the same, 1 the same song and version, 0 different songs or versions. */
export function titleAgreement(a: string, b: string): 0 | 1 | 2 {
  if (normalizeName(a) && normalizeName(a) === normalizeName(b)) return 2;
  const left = normalizeName(bareTitle(a)) || normalizeName(a);
  const right = normalizeName(bareTitle(b)) || normalizeName(b);
  if (!left || left !== right) return 0;
  const [mine, theirs] = [versionOf(a), versionOf(b)];
  return mine.length === theirs.length && mine.every((version) => theirs.includes(version)) ? 1 : 0;
}

/** Whether one of the lookup's artists is among a song's artists; a lookup's "A & B" matches either name too. */
export function sameArtist(lookupArtists: readonly string[], songArtists: readonly string[]): boolean {
  const songNames = new Set(songArtists.map(normalizeName));
  return lookupArtists.some((artist) => {
    const parts = [artist, ...artist.split(/\s*(?:,|&|\bx\b|\band\b|\bfeat\.?|\bft\.?)\s*/i)].map(normalizeName).filter(Boolean);
    return parts.some((name) => songNames.has(name));
  });
}

/**
 * The lookup's title with its version, written the way Spotify writes versions. A title that
 * already carries the version is kept as it is ("Baby - Tony Romera Remix"); otherwise the version
 * is added in brackets ("Baby" and "Tony Romera Remix" read "Baby (Tony Romera Remix)").
 */
export function lookupTitle(lookup: Pick<NowPlayingLookupV1, "title" | "version">): string {
  const version = lookup.version ? normalizeName(lookup.version) : "";
  if (!version) return lookup.title;
  const title = normalizeName(lookup.title);
  if (versionOf(lookup.title).includes(version) || title === version || title.endsWith(` ${version}`)) return lookup.title;
  return `${lookup.title} (${lookup.version})`;
}

/** What to type into Spotify's search for a lookup: its title and version, and its first artist. */
export function lookupSearchTerm(lookup: Pick<NowPlayingLookupV1, "title" | "version" | "artists">): string {
  return `${searchTitle(lookupTitle(lookup))} ${lookup.artists[0] ?? ""}`.replace(/\s+/g, " ").trim();
}

/**
 * The Spotify song that is the lookup's song, or null when no result has the same title, version
 * and an artist in common. Among several (a single and its album, say), a title written exactly
 * the same comes first, then the lookup's album, then a song this account can play, then
 * Spotify's own order.
 */
export function pickSameSong(lookup: NowPlayingLookupV1, results: readonly SpotifyTrackSearchResult[]): string | null {
  const wanted = lookupTitle(lookup);
  const album = lookup.album ? normalizeName(lookup.album) : "";
  const same = results
    .map((result, order) => ({ result, order, agreement: titleAgreement(wanted, result.name) }))
    .filter(({ result, agreement }) => agreement > 0 && sameArtist(lookup.artists, result.artists));
  if (!same.length) return null;
  const score = ({ result, agreement }: (typeof same)[number]) =>
    (agreement === 2 ? 4 : 0) + (album && result.album && normalizeName(result.album) === album ? 2 : 0) + (result.playable ? 1 : 0);
  same.sort((a, b) => score(b) - score(a) || a.order - b.order);
  return same[0].result.id;
}
