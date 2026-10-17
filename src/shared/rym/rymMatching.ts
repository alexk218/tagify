import type { SpotifyAlbumCandidate, SpotifyAlbumSearchResult } from "./albumCandidate";
import type { RymRelease } from "./rymExport.mjs";

/** Candidates kept per release in the saved review; the rest stay reachable through a pasted album link. */
export const RYM_STORED_CANDIDATES = 8;

const EDITION = /\b(deluxe|remaster(?:ed)?|expanded|anniversary|edition|bonus|mono|stereo|reissue)\b/i;
const VERSION_SUFFIX = /\b(deluxe|remaster(?:ed)?|expanded|anniversary|edition|bonus|mono|stereo|reissue|live|version|ep|single|\d{4})\b/i;

export const normalizeRymIdentity = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase("en").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

/**
 * Compares names the way people read them: accents, punctuation, spacing and "&"/"and" are ignored,
 * so "Hardwired...to Self-Destruct" equals "Hardwired…To Self-Destruct" and "Voïvod" equals "Voivod".
 */
export const looseRymKey = (value: string): string =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en")
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, "");

/** RYM shows localized names as "Native [Latin]"; either form may be the one Spotify uses. */
function aliases(value: string): string[] {
  const bracketed = value.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  const names = bracketed ? [value, bracketed[1], bracketed[2]] : [value];
  return [...new Set(names.map(looseRymKey).filter(Boolean))];
}

/** Title without trailing edition, live, format or year qualifiers, for spotting other versions of one release. */
function baseTitle(title: string): string {
  let base = title;
  for (;;) {
    const next = base
      .replace(/\s*[([][^()[\]]*[)\]]\s*$/, "")
      .replace(/\s+-\s+([^-]+)$/, (suffix, segment: string) => (VERSION_SUFFIX.test(segment) ? "" : suffix))
      .replace(/\s+(?:EP|E\.P\.)$/i, "")
      .trim();
    if (next === base || !next) return looseRymKey(base);
    base = next;
  }
}

const titleKeys = (title: string): string[] => [...new Set([...aliases(title), baseTitle(title)])];

function artistsMatch(release: string[], candidate: string[]): "same" | "overlap" | "none" {
  const spotify = candidate.map(looseRymKey);
  const found = release.filter((name) => aliases(name).some((alias) => spotify.includes(alias)));
  if (found.length === release.length && release.length === candidate.length) return "same";
  return found.length ? "overlap" : "none";
}

function typeMatches(release: RymRelease, candidate: SpotifyAlbumCandidate): boolean {
  const type = candidate.releaseType?.toLowerCase();
  return type === release.releaseType || (release.releaseType === "ep" && type === "single");
}

/** Character-pair similarity from 0 to 1; tolerant of small spelling or censoring differences. */
function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index++) {
    const pair = left.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let index = 0; index < right.length - 1; index++) {
    const pair = right.slice(index, index + 2);
    const count = pairs.get(pair) ?? 0;
    if (count) { shared++; pairs.set(pair, count - 1); }
  }
  return (2 * shared) / (left.length + right.length - 2);
}

const numbers = (key: string): string => key.match(/\d+/g)?.join(" ") ?? "";

/** Best similarity between any forms of the two titles; numbers must agree ("Woodstock 94" is not "Woodstock '99"). */
function titleSimilarity(release: string, candidate: string): number {
  const candidateKeys = titleKeys(candidate);
  return Math.max(0, ...titleKeys(release).flatMap((key) => candidateKeys.map((other) => numbers(key) === numbers(other) ? similarity(key, other) : 0)));
}

const sameTitle = (release: string, candidate: string): boolean => {
  const candidateKeys = new Set(aliases(candidate));
  if (/\s(?:-\s)?(?:EP|Single)$/i.test(candidate)) candidateKeys.add(looseRymKey(candidate.replace(/\s+(?:-\s+)?(?:EP|Single)$/i, "")));
  return aliases(release).some((key) => candidateKeys.has(key));
};

const sameBaseTitle = (release: string, candidate: string): boolean =>
  titleKeys(release).includes(baseTitle(candidate));

function isExactIdentity(release: RymRelease, album: SpotifyAlbumCandidate): boolean {
  return album.playable && release.year !== null && album.year === release.year && typeMatches(release, album) &&
    !EDITION.test(album.title) && sameTitle(release.title, album.title) && artistsMatch(release.artists, album.artists) === "same";
}

/**
 * Preselects only a single complete identity: same title, artists, year and compatible type, with no
 * other edition of that release in the results. Spotify ranks exact matches first, so a long result
 * list alone does not prevent preselection; unreadable results still do.
 */
export function preselectRymAlbum(release: RymRelease, result: SpotifyAlbumSearchResult): SpotifyAlbumCandidate | null {
  if (result.status !== "available" || result.omittedResults || release.year === null ||
      !["album", "ep", "single"].includes(release.releaseType) || EDITION.test(release.title)) return null;
  const exact = result.albums.filter((album) => isExactIdentity(release, album));
  if (exact.length !== 1) return null;
  const versions = result.albums.filter((album) => album.playable && artistsMatch(release.artists, album.artists) !== "none" &&
    sameBaseTitle(release.title, album.title));
  return versions.length === 1 ? exact[0] : null;
}

function score(release: RymRelease, album: SpotifyAlbumCandidate): number {
  const artists = artistsMatch(release.artists, album.artists);
  // Full titles break ties between editions, so "(Remastered)" ranks above "(Remastered Deluxe Box Set)".
  let total = (artists === "same" ? 2 : artists === "overlap" ? 1 : 0) + 2 * titleSimilarity(release.title, album.title) +
    0.25 * similarity(looseRymKey(release.title), looseRymKey(album.title));
  if (release.year !== null && album.year !== null) total += album.year === release.year ? 0.5 : Math.abs(album.year - release.year) === 1 ? 0.25 : 0;
  if (typeMatches(release, album)) total += 0.25;
  if (EDITION.test(album.title) && !EDITION.test(release.title)) total -= 0.1;
  return album.playable ? total : total - 10;
}

/** Most plausible albums first, keeping Spotify's own order between equally good candidates. */
export function rankRymCandidates(release: RymRelease, albums: SpotifyAlbumCandidate[]): SpotifyAlbumCandidate[] {
  return albums.map((album, index) => ({ album, index, score: score(release, album) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ album }) => album);
}

/** A likely album for the person to confirm: shared artist, a closely matching title and a year at most one apart. */
export function suggestRymAlbum(release: RymRelease, ranked: SpotifyAlbumCandidate[]): SpotifyAlbumCandidate | null {
  const best = ranked[0];
  if (!best?.playable || artistsMatch(release.artists, best.artists) === "none") return null;
  if (release.year !== null && best.year !== null && Math.abs(best.year - release.year) > 1) return null;
  return titleSimilarity(release.title, best.title) >= 0.75 ? best : null;
}

const TYPE_NAMES: Record<string, string> = { album: "an album", ep: "an EP", single: "a single", compilation: "a compilation" };

/** Plain-language differences between an RYM release and a Spotify album, for review. */
export function describeRymMatch(release: RymRelease, album: SpotifyAlbumCandidate, others: SpotifyAlbumCandidate[] = []): string[] {
  const notes: string[] = [];
  if (EDITION.test(album.title) && !EDITION.test(release.title)) notes.push("Different edition");
  else if (!sameTitle(release.title, album.title)) notes.push("Title differs");
  if (artistsMatch(release.artists, album.artists) !== "same") notes.push("Artists differ");
  if (release.year !== null && album.year !== null && album.year !== release.year) notes.push(`Spotify lists ${album.year}`);
  if (album.year === null) notes.push("Year unknown on Spotify");
  const type = album.releaseType?.toLowerCase();
  if (type && !typeMatches(release, album)) notes.push(`Spotify lists ${TYPE_NAMES[type] ?? `a ${type}`}`);
  const versions = others.filter((other) => other.uri !== album.uri && other.playable &&
    artistsMatch(release.artists, other.artists) !== "none" && sameBaseTitle(release.title, other.title)).length;
  if (versions) notes.push(`${versions} other ${versions === 1 ? "version" : "versions"} on Spotify`);
  return notes;
}
