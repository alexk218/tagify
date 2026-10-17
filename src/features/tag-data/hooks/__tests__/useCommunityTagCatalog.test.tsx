import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommunityTagCatalog } from "../useCommunityTagCatalog";
import type { CommunityCatalogPage, CommunityCatalogQuery } from "@/features/tag-data/utils/communityTagCatalog";

const tag = (name: string) => ({ key: name.toLowerCase(), name, songCount: 1 });

function deferredLoader() {
  const calls: Array<{ query: CommunityCatalogQuery; resolve: (page: CommunityCatalogPage) => void; reject: (error: unknown) => void }> = [];
  const load = vi.fn((query: CommunityCatalogQuery) => new Promise<CommunityCatalogPage>((resolve, reject) => calls.push({ query, resolve, reject })));
  return { calls, load };
}

describe("useCommunityTagCatalog", () => {
  it("waits until it's enabled, then loads the first page", async () => {
    const { calls, load } = deferredLoader();
    const { result, rerender } = renderHook((props: { enabled: boolean }) =>
      useCommunityTagCatalog({ enabled: props.enabled, query: "", sort: "contributors", minTrackCount: 1 }, load), { initialProps: { enabled: false } });
    expect(load).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(result.current.status).toBe("loading");
    act(() => calls[0].resolve({ tags: [tag("Night")], nextCursor: "two", tagCount: 2 }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ remaining: 1, hasMore: true });
  });

  it("appends further pages without duplicates and never shows a negative remainder", async () => {
    const { calls, load } = deferredLoader();
    const { result } = renderHook(() => useCommunityTagCatalog({ enabled: true, query: "", sort: "popular", minTrackCount: 1 }, load));
    act(() => calls[0].resolve({ tags: [tag("A"), tag("B")], nextCursor: "two", tagCount: 3 }));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    expect(result.current.loadingMore).toBe(true);
    expect(calls[1].query).toMatchObject({ cursor: "two", sort: "popular" });
    act(() => calls[1].resolve({ tags: [tag("B"), tag("C")], nextCursor: null, tagCount: 2 }));
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(result.current.tags.map((item) => item.name)).toEqual(["A", "B", "C"]);
    expect(result.current).toMatchObject({ hasMore: false, remaining: 0 });
  });

  it("starts over when the filters change and ignores answers for the old ones", async () => {
    const { calls, load } = deferredLoader();
    const { result, rerender } = renderHook((props: { sort: "popular" | "niche" }) =>
      useCommunityTagCatalog({ enabled: true, query: "", sort: props.sort, minTrackCount: 1 }, load), { initialProps: { sort: "popular" as "popular" | "niche" } });
    rerender({ sort: "niche" });
    act(() => calls[1].resolve({ tags: [tag("Rare")], nextCursor: null, tagCount: 1 }));
    act(() => calls[0].resolve({ tags: [tag("Popular")], nextCursor: "x", tagCount: 9 }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.tags.map((item) => item.name)).toEqual(["Rare"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("debounces typing", async () => {
    vi.useFakeTimers();
    try {
      const { load } = deferredLoader();
      const { rerender } = renderHook((props: { query: string }) =>
        useCommunityTagCatalog({ enabled: true, query: props.query, sort: "contributors", minTrackCount: 1 }, load), { initialProps: { query: "" } });
      rerender({ query: "n" });
      rerender({ query: "ni" });
      rerender({ query: "night" });
      expect(load).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(load).toHaveBeenCalledTimes(2);
      expect(load.mock.calls[1][0]).toMatchObject({ query: "night" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports failures and retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls, load } = deferredLoader();
    const { result } = renderHook(() => useCommunityTagCatalog({ enabled: true, query: "", sort: "contributors", minTrackCount: 1 }, load));
    act(() => calls[0].reject(new Error("offline")));
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    act(() => calls[1].resolve({ tags: [tag("Night")], nextCursor: "two", tagCount: 2 }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.loadMore());
    act(() => calls[2].reject(new Error("offline")));
    await waitFor(() => expect(result.current.loadMoreFailed).toBe(true));
    expect(result.current.tags).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);
  });
});
