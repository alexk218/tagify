import { COMMUNITY_ORIGIN } from "@/features/community/communityLinks";

export interface CommunityCatalogTag {
  key: string;
  name: string;
  songCount: number;
  contributorCount?: number;
  assignmentCount?: number;
}

/** Orders the Community catalog supports; each one pages in a single direction. */
export type CommunityCatalogSort = "contributors" | "popular" | "niche" | "alphabetical";

export interface CommunityCatalogQuery {
  query: string;
  sort: CommunityCatalogSort;
  minTrackCount: number;
  cursor?: string | null;
}

export interface CommunityCatalogPage {
  tags: CommunityCatalogTag[];
  nextCursor: string | null;
  /** Tags matching the current search and filters, across all pages. */
  tagCount: number;
}

export const COMMUNITY_CATALOG_PAGE_SIZE = 100;
export const COMMUNITY_TAG_SEARCH_MAX_LENGTH = 80;
const COMMUNITY_CATALOG_TIMEOUT_MS = 10000;

export function buildCommunityCatalogUrl({ query, sort, minTrackCount, cursor }: CommunityCatalogQuery): string {
  const parameters = new URLSearchParams({
    limit: String(COMMUNITY_CATALOG_PAGE_SIZE),
    sort,
    minTracks: String(minTrackCount),
  });
  const search = query.trim().slice(0, COMMUNITY_TAG_SEARCH_MAX_LENGTH);
  if (search) parameters.set("q", search);
  if (cursor) parameters.set("cursor", cursor);
  return `${COMMUNITY_ORIGIN}/api/v1/tags?${parameters.toString()}`;
}

function isCatalogTag(value: unknown): value is CommunityCatalogTag {
  if (!value || typeof value !== "object") return false;
  const tag = value as Record<string, unknown>;
  return typeof tag.key === "string" && typeof tag.name === "string" && Number.isFinite(tag.songCount);
}

export function parseCommunityCatalogPage(value: unknown): CommunityCatalogPage {
  const body = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const tags = Array.isArray(body.tags) ? body.tags.filter(isCatalogTag) : [];
  const tagCount = Number(body.tagCount);
  return {
    tags,
    nextCursor: typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null,
    tagCount: Number.isFinite(tagCount) && tagCount >= tags.length ? tagCount : tags.length,
  };
}

/** One page of the public Community tag catalog. Anonymous, like the website's tag pages. */
export function loadCommunityCatalogPage(query: CommunityCatalogQuery, signal?: AbortSignal): Promise<CommunityCatalogPage> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = () => signal?.removeEventListener("abort", abort);
    signal?.addEventListener("abort", abort, { once: true });
    request.open("GET", buildCommunityCatalogUrl(query), true);
    request.responseType = "json";
    request.timeout = COMMUNITY_CATALOG_TIMEOUT_MS;
    request.setRequestHeader("Accept", "application/json");
    request.onload = () => {
      finish();
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Community tags request failed with ${request.status}.`));
        return;
      }
      try {
        const body = typeof request.response === "object" && request.response !== null
          ? request.response
          : JSON.parse(String(request.responseText || "{}"));
        resolve(parseCommunityCatalogPage(body));
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => { finish(); reject(new Error("Community tags request failed.")); };
    request.ontimeout = () => { finish(); reject(new Error("Community tags request timed out.")); };
    request.onabort = () => { finish(); reject(new DOMException("Aborted", "AbortError")); };
    request.send();
  });
}

export function formatCommunityTagStats(tag: CommunityCatalogTag): string {
  const contributorCount = tag.contributorCount ?? 0;
  const userLabel = contributorCount === 1 ? "user" : "users";
  const trackLabel = tag.songCount === 1 ? "track" : "tracks";
  return `${tag.songCount} public ${trackLabel} · ${contributorCount} ${userLabel}`;
}

export function buildCommunityTagSearchUrl(tag: Pick<CommunityCatalogTag, "name">): string {
  return `${COMMUNITY_ORIGIN}/search?tag=${encodeURIComponent(`label:${encodeURIComponent(tag.name)}`)}`;
}
