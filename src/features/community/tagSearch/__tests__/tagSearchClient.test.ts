import { describe, expect, it, vi } from "vitest";
import { TagSearchError, searchCommunityTags, tagSearchPageOf, tagSearchUrl } from "../tagSearchClient";

const ID = "4uLU6hMCjMI75M1A2tKUQC";
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("Community tag search request", () => {
  it("asks for every tag, the match and the cursor", () => {
    const url = new URL(tagSearchUrl("https://community.tagify.fm", ["Deep House", "Techno"], "all", "abc"));
    expect(url.pathname).toBe("/api/v2/desktop/tag-search");
    expect(url.searchParams.getAll("tag")).toEqual(["Deep House", "Techno"]);
    expect(url.searchParams.get("match")).toBe("all");
    expect(url.searchParams.get("cursor")).toBe("abc");
  });

  it("sends the device's session when connected and none otherwise", async () => {
    const request = answer({ items: [], totalCount: 0, locked: null });
    await searchCommunityTags(["Rock"], { request, session: () => ({ apiBaseUrl: "https://api.example", accessToken: "token" }) });
    const [connectedUrl, connected] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(connectedUrl.startsWith("https://api.example/api/v2/desktop/tag-search")).toBe(true);
    expect((connected.headers as Record<string, string>).authorization).toBe("Bearer token");

    await searchCommunityTags(["Rock"], { request, session: () => null });
    const [publicUrl, signedOut] = request.mock.calls[1] as unknown as [string, RequestInit];
    expect(publicUrl.startsWith("https://community.tagify.fm/api/v2/desktop/tag-search")).toBe(true);
    expect((signedOut.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("reads songs, the count and the lock, leaving out songs it can't read", async () => {
    const page = await searchCommunityTags(["Rock"], {
      session: () => null,
      request: answer({
        totalCount: 312, totalCountCapped: true, locked: "connect", nextCursor: "ignored-while-locked",
        items: [
          { spotifyTrackId: ID, title: " Song ", artists: ["A", 3], imageUrl: "http://insecure", people: 4, tags: [{ label: "Rock", people: 3 }, { label: "" }, 3] },
          { spotifyTrackId: "1uLU6hMCjMI75M1A2tKUQC", title: "", artists: [], thumbnailUrl: "https://i.scdn.co/image/x", people: 2, tags: ["Rock"] },
          { spotifyTrackId: "not-an-id", title: "Bad" },
          { spotifyTrackId: ID, title: "Repeat" },
        ],
      }),
    });
    expect(page).toEqual({
      total: 312, capped: true, locked: "connect", nextCursor: null,
      songs: [
        { uri: `spotify:track:${ID}`, title: "Song", artists: ["A"], imageUrl: null, people: 4, tags: ["Rock"] },
        { uri: "spotify:track:1uLU6hMCjMI75M1A2tKUQC", title: null, artists: [], imageUrl: "https://i.scdn.co/image/x", people: 2, tags: ["Rock"] },
      ],
    });
  });

  it("keeps the cursor for members who share", () => {
    expect(tagSearchPageOf({ items: [], totalCount: 100, locked: null, nextCursor: "next" })).toMatchObject({ locked: null, nextCursor: "next" });
    expect(tagSearchPageOf({ nothing: true })).toBeNull();
  });

  it.each([[404, "not-available"], [503, "paused"], [429, "busy"], [500, "unreachable"]])("maps %i to %s", async (status, reason) => {
    await expect(searchCommunityTags(["Rock"], { session: () => null, request: answer({}, status) })).rejects.toEqual(new TagSearchError(reason as never));
  });

  it("asks again without the session when Community no longer accepts it", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], totalCount: 0, locked: "connect" })));
    const page = await searchCommunityTags(["Rock"], { request, session: () => ({ apiBaseUrl: "https://api.example", accessToken: "old" }) });
    expect(page.locked).toBe("connect");
    expect(((request.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("is unreachable when the request fails", async () => {
    const request = vi.fn(async () => { throw new TypeError("offline"); });
    await expect(searchCommunityTags(["Rock"], { session: () => null, request })).rejects.toMatchObject({ reason: "unreachable" });
  });
});
