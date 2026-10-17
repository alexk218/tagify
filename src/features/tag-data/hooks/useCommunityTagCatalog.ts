import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadCommunityCatalogPage,
  type CommunityCatalogPage,
  type CommunityCatalogQuery,
  type CommunityCatalogSort,
  type CommunityCatalogTag,
} from "@/features/tag-data/utils/communityTagCatalog";

const SEARCH_DEBOUNCE_MS = 300;

export type CommunityCatalogStatus = "idle" | "loading" | "ready" | "error";

export interface CommunityTagCatalogState {
  tags: CommunityCatalogTag[];
  /** Matching tags not loaded yet; for the "Show more" label only. */
  remaining: number;
  hasMore: boolean;
  status: CommunityCatalogStatus;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
}

type PageLoader = (query: CommunityCatalogQuery, signal?: AbortSignal) => Promise<CommunityCatalogPage>;

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * The Community tag catalog, a page at a time. Search, order and the track minimum run on the
 * server, so every matching tag is reachable; changing them starts again from the first page.
 */
export function useCommunityTagCatalog(
  { enabled, query, sort, minTrackCount }: { enabled: boolean; query: string; sort: CommunityCatalogSort; minTrackCount: number },
  loadPage: PageLoader = loadCommunityCatalogPage,
): CommunityTagCatalogState {
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [tags, setTags] = useState<CommunityCatalogTag[]>([]);
  const [tagCount, setTagCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<CommunityCatalogStatus>("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Each first-page load gets a generation; pages from an older one are ignored.
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const filters = useRef<CommunityCatalogQuery>({ query, sort, minTrackCount });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!enabled) return undefined;
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    filters.current = { query: debouncedQuery, sort, minTrackCount };
    setStatus("loading");
    setLoadingMore(false);
    setLoadMoreFailed(false);
    loadPage(filters.current, abort.signal).then(
      (page) => {
        if (generation.current !== current) return;
        setTags(page.tags);
        setTagCount(page.tagCount);
        setNextCursor(page.nextCursor);
        setStatus("ready");
      },
      (error) => {
        if (generation.current !== current || isAbort(error)) return;
        console.error("Failed to load community tags", error);
        setTags([]);
        setNextCursor(null);
        setStatus("error");
      },
    );
    return () => abort.abort();
  }, [enabled, debouncedQuery, sort, minTrackCount, attempt, loadPage]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const current = generation.current;
    const signal = controller.current?.signal;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    loadPage({ ...filters.current, cursor: nextCursor }, signal).then(
      (page) => {
        if (generation.current !== current) return;
        // Counts can shift between pages, so a tag may appear twice; keep the first.
        setTags((loaded) => {
          const seen = new Set(loaded.map((tag) => tag.key));
          return [...loaded, ...page.tags.filter((tag) => !seen.has(tag.key))];
        });
        setTagCount(page.tagCount);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
      (error) => {
        if (generation.current !== current || isAbort(error)) return;
        console.error("Failed to load more community tags", error);
        setLoadingMore(false);
        setLoadMoreFailed(true);
      },
    );
  }, [loadPage, loadingMore, nextCursor]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    tags,
    remaining: Math.max(0, tagCount - tags.length),
    hasMore: nextCursor !== null,
    status,
    loadingMore,
    loadMoreFailed,
    loadMore,
    retry,
  };
}
