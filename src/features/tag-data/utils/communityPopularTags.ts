import { parseTagNamesResponse, TAG_NAMES_PATH, type PopularTagName } from "@tagify/community-contracts";
import { COMMUNITY_ORIGIN } from "@/features/community/communityLinks";
import { getQuickTagNameError } from "./quickTag";

/**
 * The tag names other Community members use, downloaded at most once a day and shared by the
 * extension and the app. Suggestions are worked out on this computer from that list, so nothing a
 * member types is ever sent anywhere.
 */
export const COMMUNITY_POPULAR_TAGS_URL = `${COMMUNITY_ORIGIN}${TAG_NAMES_PATH}`;
export const COMMUNITY_POPULAR_TAGS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const COMMUNITY_POPULAR_TAGS_STORAGE_KEY = "tagify:community-popular-tags:v1";
export const COMMUNITY_POPULAR_TAGS_UPDATED_EVENT = "tagify:communityPopularTagsUpdated";
const MAX_STORED_NAMES = 5000;
const REQUEST_TIMEOUT_MS = 10_000;

interface PopularTagsList {
  checkedAt: number;
  /** null while Community doesn't list names yet, or couldn't be reached and nothing was known before. */
  tags: PopularTagName[] | null;
}

interface PopularTagsState {
  list: PopularTagsList | null;
  inFlight: Promise<void> | null;
}

declare global {
  interface Window {
    __tagifyCommunityPopularTags?: PopularTagsState;
  }
}

const NO_NAMES: readonly PopularTagName[] = Object.freeze([]);

function isStoredName(value: unknown): value is PopularTagName {
  const tag = value as PopularTagName | null;
  return typeof tag?.name === "string" && typeof tag.slug === "string" && Number.isSafeInteger(tag.people) && tag.people > 0;
}

function readStoredList(): PopularTagsList | null {
  try {
    const stored = JSON.parse(localStorage.getItem(COMMUNITY_POPULAR_TAGS_STORAGE_KEY) || "null") as PopularTagsList | null;
    if (!stored || !Number.isFinite(stored.checkedAt)) return null;
    if (stored.tags === null) return { checkedAt: stored.checkedAt, tags: null };
    return Array.isArray(stored.tags) && stored.tags.every(isStoredName) ? stored : null;
  } catch {
    return null;
  }
}

function shared(): PopularTagsState {
  return (window.__tagifyCommunityPopularTags ??= { list: readStoredList(), inFlight: null });
}

function isStale(list: PopularTagsList | null, now: number): boolean {
  return !list || now < list.checkedAt || now - list.checkedAt >= COMMUNITY_POPULAR_TAGS_MAX_AGE_MS;
}

/** Only names this app can save as a tag, most used first. */
function usableNames(tags: PopularTagName[]): PopularTagName[] {
  return tags
    .map((tag) => ({ ...tag, name: tag.name.trim() }))
    .filter((tag) => getQuickTagNameError(tag.name) === null)
    .sort((a, b) => b.people - a.people)
    .slice(0, MAX_STORED_NAMES);
}

function remember(state: PopularTagsState, list: PopularTagsList): void {
  state.list = list;
  try {
    localStorage.setItem(COMMUNITY_POPULAR_TAGS_STORAGE_KEY, JSON.stringify(list));
  } catch { /* Keep the list for this session when storage is full or unavailable. */ }
  window.dispatchEvent(new CustomEvent(COMMUNITY_POPULAR_TAGS_UPDATED_EVENT));
}

async function download(request: typeof fetch, previous: PopularTagName[] | null, now: number): Promise<PopularTagsList> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Anonymous on purpose: no cookies or account details, and no query, so the edge cache serves everyone.
    const response = await request(COMMUNITY_POPULAR_TAGS_URL, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    // Community releases before the list existed answer 404; show no suggestions until it's there.
    if (response.status === 404 || response.status === 410) return { checkedAt: now, tags: null };
    if (!response.ok) throw new Error(`Community tag names answered ${response.status}`);
    const parsed = parseTagNamesResponse(await response.json());
    return { checkedAt: now, tags: parsed ? usableNames(parsed.tags) : null };
  } catch {
    // Offline or briefly unavailable: keep yesterday's names, and ask again tomorrow.
    return { checkedAt: now, tags: previous };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Downloads the list when it's missing or a day old, sharing one request between every caller.
 * Called when Tagify starts, because the quick tag menu reads the list without waiting.
 */
export function preloadCommunityPopularTags(
  request: typeof fetch = (...args) => fetch(...args),
  now: () => number = Date.now,
): Promise<void> {
  const state = shared();
  if (state.inFlight) return state.inFlight;
  if (!isStale(state.list, now())) return Promise.resolve();
  const pending = download(request, state.list?.tags ?? null, now())
    .then((list) => remember(state, list))
    .finally(() => { state.inFlight = null; });
  state.inFlight = pending;
  return pending;
}

/**
 * The names other members use, as last downloaded; empty until then, or while Community doesn't
 * list them. Asks for a fresh list in the background once the saved one is a day old.
 */
export function getCommunityPopularTags(now: () => number = Date.now): readonly PopularTagName[] {
  const state = shared();
  if (!state.inFlight && isStale(state.list, now())) void preloadCommunityPopularTags(undefined, now);
  return state.list?.tags ?? NO_NAMES;
}

/** Forgets the downloaded list in this session (used by tests). */
export function resetCommunityPopularTags(): void {
  delete window.__tagifyCommunityPopularTags;
}
