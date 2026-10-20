// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCommunityCatalogUrl, buildCommunityTagSearchUrl, parseCommunityCatalogPage } from "../communityTagCatalog";

describe("Community tag catalog", () => {
  it("asks Community for one filtered page at a time", () => {
    const url = new URL(buildCommunityCatalogUrl({ query: "  night drive  ", sort: "niche", minTrackCount: 10, cursor: "next-page" }));
    expect(url.origin + url.pathname).toBe("https://community.tagify.fm/api/v1/tags");
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "100", sort: "niche", minTracks: "10", q: "night drive", cursor: "next-page" });
  });

  it("leaves out an empty search and cuts long ones to what Community accepts", () => {
    expect(new URL(buildCommunityCatalogUrl({ query: "   ", sort: "contributors", minTrackCount: 1 })).searchParams.has("q")).toBe(false);
    expect(new URL(buildCommunityCatalogUrl({ query: "x".repeat(120), sort: "popular", minTrackCount: 1 })).searchParams.get("q")).toHaveLength(80);
  });

  it("reads a page defensively", () => {
    expect(parseCommunityCatalogPage({
      tags: [{ key: "night", name: "Night", songCount: 3 }, { name: "No key" }, null],
      nextCursor: "abc",
      tagCount: 250,
    })).toEqual({ tags: [{ key: "night", name: "Night", songCount: 3 }], nextCursor: "abc", tagCount: 250 });
    expect(parseCommunityCatalogPage(null)).toEqual({ tags: [], nextCursor: null, tagCount: 0 });
    expect(parseCommunityCatalogPage({ tags: [{ key: "a", name: "A", songCount: 1 }], tagCount: "lots", nextCursor: "" }))
      .toEqual({ tags: [{ key: "a", name: "A", songCount: 1 }], nextCursor: null, tagCount: 1 });
  });

  it("links a tag to its songs on Community", () => {
    expect(buildCommunityTagSearchUrl({ name: "Night Drive" })).toBe("https://community.tagify.fm/search?tag=label%3ANight%2520Drive");
  });
});
