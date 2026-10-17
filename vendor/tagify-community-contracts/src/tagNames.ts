import { isRecord } from "./validation";

/**
 * A tag's page lives at /tags/<slug>. Spellings that differ only in case, accents, spacing or
 * punctuation (Lo-Fi, lo fi, LO_FI) share one page. The database computes the same slug in
 * public.public_tag_slug; fixtures/tag-slug.fixtures.json holds the cases both must agree on.
 *
 * Steps: compatibility decomposition (NFKD), drop combining marks, fold letters that don't
 * decompose (ø æ œ ß ł đ ð þ ı), lowercase A–Z, "&" becomes "and", drop apostrophes, every other
 * run of characters becomes "-", then trim and cut to 80 characters. Labels with nothing left,
 * such as emoji or non-Latin scripts, have no page.
 */
export const TAG_SLUG_MAX_LENGTH = 80;

// The same explicit ranges as the SQL function, rather than \p{M}, so both always agree.
const COMBINING_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const LETTER_FOLDS: Record<string, string> = {
  ø: "o", Ø: "o", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe", ß: "ss", ẞ: "ss",
  ł: "l", Ł: "l", đ: "d", Đ: "d", ð: "d", Ð: "d", þ: "th", Þ: "th", ı: "i",
};
const FOLDED_LETTERS = new RegExp(`[${Object.keys(LETTER_FOLDS).join("")}]`, "g");
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function tagSlug(label: string): string {
  return label
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(FOLDED_LETTERS, (letter) => LETTER_FOLDS[letter])
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/['’‘ʼ`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAG_SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/** Whether a path segment is already a tag page's one address. */
export function isCanonicalTagSlug(value: string): boolean {
  return value.length <= TAG_SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

/**
 * Suggesting the names other members already use, so the same idea doesn't end up spelled five
 * ways ("male vocals", "male vocalist"). The website editor and the desktop app share these rules.
 */

/** Community's anonymous, edge-cached list of the tag names members share. */
export const TAG_NAMES_PATH = "/api/v1/tag-names";
export const TAG_NAMES_VERSION = 1 as const;

/** A name members share, with the number of members who use it across all its spellings. */
export interface PopularTagName {
  name: string;
  /** The tag page's slug; empty when the name has none. */
  slug: string;
  people: number;
}

export interface TagNamesResponseV1 {
  version: typeof TAG_NAMES_VERSION;
  tags: PopularTagName[];
}

/**
 * Reads a tag-names response. Any entry that breaks the contract makes the whole response unusable
 * (null), so a broken or newer list never turns into wrong suggestions.
 */
export function parseTagNamesResponse(value: unknown): TagNamesResponseV1 | null {
  if (!isRecord(value) || value.version !== TAG_NAMES_VERSION || !Array.isArray(value.tags)) return null;
  const tags: PopularTagName[] = [];
  for (const entry of value.tags) {
    if (!isRecord(entry)) return null;
    const { name, slug, people } = entry;
    if (typeof name !== "string" || !name.trim()) return null;
    if (typeof slug !== "string" || (slug !== "" && !isCanonicalTagSlug(slug))) return null;
    if (typeof people !== "number" || !Number.isSafeInteger(people) || people < 1) return null;
    tags.push({ name, slug, people });
  }
  return { version: TAG_NAMES_VERSION, tags };
}

/**
 * The key two names share when they're the same tag: the tag page's slug. Names with no slug
 * (emoji, non-Latin scripts) keep their own lowercased text, so they never match each other just
 * because both slugs are empty. A blank name has no key.
 */
export function tagMatchKey(name: string): string {
  const slug = tagSlug(name);
  if (slug) return slug;
  const text = name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return text ? `~${text}` : "";
}

/** Also ignores where words are split, so lofi, lo-fi and lo fi are one tag. */
function compactKey(key: string): string {
  const compact = key.replace(/[\s-]+/g, "");
  return compact === "~" ? "" : compact;
}

/** Whether two names are the same tag: equal keys, also once spaces and hyphens are removed. */
export function isSameTagName(a: string, b: string): boolean {
  const key = compactKey(tagMatchKey(a));
  return key !== "" && key === compactKey(tagMatchKey(b));
}

const STEM_ENDINGS = ["ists", "ist", "es", "s"] as const;
const MIN_STEM_LENGTH = 4;
const MIN_TYPO_LENGTH = 5;
const LETTERS_ONLY = /^[a-z]+$/;

/** The word itself, and the word without one ending, keeping only stems long enough to mean something. */
function stems(word: string): string[] {
  const options = [word, ...STEM_ENDINGS.filter((ending) => word.endsWith(ending)).map((ending) => word.slice(0, -ending.length))];
  return options.filter((stem) => stem.length >= MIN_STEM_LENGTH);
}

/** One letter replaced, or two neighbouring letters swapped, in words of the same length. */
function isOneTypoApart(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < MIN_TYPO_LENGTH) return false;
  const differences: number[] = [];
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index] && differences.push(index) > 2) return false;
  }
  if (differences.length === 1) return true;
  const [first, second] = differences;
  return differences.length === 2 && second === first + 1 && a[first] === b[second] && a[second] === b[first];
}

function isNearDuplicateWords(a: readonly string[], b: readonly string[]): boolean {
  if (!a.length || a.length !== b.length) return false;
  let differing = -1;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    if (differing >= 0) return false;
    differing = index;
  }
  if (differing < 0) return false;
  const [left, right] = [a[differing], b[differing]];
  // Letters only, so decades and years (1980s, 1990s) never look like typos of each other.
  if (!LETTERS_ONLY.test(left) || !LETTERS_ONLY.test(right)) return false;
  const leftStems = stems(left);
  return stems(right).some((stem) => leftStems.includes(stem)) || isOneTypoApart(left, right);
}

function slugWords(name: string): string[] {
  const slug = tagSlug(name);
  return slug ? slug.split("-") : [];
}

/**
 * Whether two different tags are probably one idea spelled two ways: the same number of words with
 * exactly one word different, where that word shares a stem (vocals, vocalist) or is one typo away
 * (psychadelic, psychedelic). Chill and chilled, or jazz and jazzy, stay separate.
 */
export function isNearDuplicateTagName(a: string, b: string): boolean {
  return !isSameTagName(a, b) && isNearDuplicateWords(slugWords(a), slugWords(b));
}

export type PopularTagMatch = "same" | "near" | "prefix";

export type TagSuggestion<T> =
  /** One of your own tags that is the same tag as the typed name. */
  | { match: "mine"; name: string; tag: T }
  /** A name other members use; `yours` is your own tag with that name, if you have one. */
  | { match: PopularTagMatch; name: string; people: number; yours: T | null };

export type PopularTagSuggestion<T> = Extract<TagSuggestion<T>, { match: PopularTagMatch }>;

interface PreparedTagName {
  name: string;
  people: number;
  key: string;
  compact: string;
  words: string[];
}

const preparedLists = new WeakMap<readonly PopularTagName[], PreparedTagName[]>();

/** Keys for every popular name, most used first, worked out once per list. */
function prepare(popular: readonly PopularTagName[]): PreparedTagName[] {
  const cached = preparedLists.get(popular);
  if (cached) return cached;
  const prepared = popular
    .map(({ name, people }) => {
      const key = tagMatchKey(name);
      return { name: name.trim(), people, key, compact: compactKey(key), words: slugWords(name) };
    })
    .filter((entry) => entry.compact)
    .sort((a, b) => b.people - a.people || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  preparedLists.set(popular, prepared);
  return prepared;
}

/**
 * Suggestions while typing a tag name, best first:
 * 1. your own tags that are the same tag, so you reuse them rather than make a duplicate;
 * 2. names members use for the same tag, or a near-duplicate of it, most used first;
 * 3. names members use that start with what you typed, most used first.
 * Each tag appears once, under its most used spelling. A typed name that is itself a popular tag is
 * never treated as a near-duplicate of another one (blues and blue stay apart).
 */
export function findTagSuggestions<T extends { name: string }>(
  typed: string,
  popular: readonly PopularTagName[],
  { mine = [] }: { mine?: readonly T[] } = {},
): TagSuggestion<T>[] {
  const typedCompact = compactKey(tagMatchKey(typed));
  if (!typedCompact) return [];
  const yoursByKey = new Map<string, T>();
  const own: TagSuggestion<T>[] = [];
  for (const tag of mine) {
    const key = compactKey(tagMatchKey(tag.name));
    if (!key) continue;
    if (!yoursByKey.has(key)) yoursByKey.set(key, tag);
    if (key === typedCompact) own.push({ match: "mine", name: tag.name, tag });
  }

  const names = prepare(popular);
  const typedIsPopular = names.some((entry) => entry.compact === typedCompact);
  const typedWords = slugWords(typed);
  const close: TagSuggestion<T>[] = [];
  const startingWith: TagSuggestion<T>[] = [];
  const seen = new Set<string>();
  for (const entry of names) {
    if (seen.has(entry.compact)) continue;
    const match: PopularTagMatch | null =
      entry.compact === typedCompact ? "same"
        : !typedIsPopular && isNearDuplicateWords(typedWords, entry.words) ? "near"
          : entry.compact.startsWith(typedCompact) ? "prefix"
            : null;
    if (!match) continue;
    seen.add(entry.compact);
    const suggestion = { match, name: entry.name, people: entry.people, yours: yoursByKey.get(entry.compact) ?? null };
    (match === "prefix" ? startingWith : close).push(suggestion);
  }
  return [...own, ...close, ...startingWith];
}

function displayFold(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The name members usually use for what was typed, when that's spelled differently: worth pointing
 * out before someone creates their own spelling. Differences in letter case alone don't count.
 */
export function findUsualTagName<T>(typed: string, suggestions: readonly TagSuggestion<T>[]): PopularTagSuggestion<T> | null {
  const usual = suggestions.find((suggestion): suggestion is PopularTagSuggestion<T> =>
    suggestion.match === "same" || suggestion.match === "near");
  return usual && displayFold(usual.name) !== displayFold(typed) ? usual : null;
}
