import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMUNITY_POPULAR_TAGS_MAX_AGE_MS,
  COMMUNITY_POPULAR_TAGS_STORAGE_KEY,
  COMMUNITY_POPULAR_TAGS_UPDATED_EVENT,
  COMMUNITY_POPULAR_TAGS_URL,
  getCommunityPopularTags,
  preloadCommunityPopularTags,
  resetCommunityPopularTags,
} from "../communityPopularTags";

const DAY = COMMUNITY_POPULAR_TAGS_MAX_AGE_MS;

function respond(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const list = {
  version: 1,
  tags: [
    { name: "lo-fi", slug: "lo-fi", people: 4 },
    { name: " male vocalist ", slug: "male-vocalist", people: 12 },
    { name: "a name far longer than thirty characters", slug: "a-name-far-longer-than-thirty-characters", people: 30 },
    { name: "<b>bold</b>", slug: "b-bold-b", people: 9 },
  ],
};

beforeEach(() => resetCommunityPopularTags());
afterEach(() => {
  resetCommunityPopularTags();
  vi.unstubAllGlobals();
});

describe("community popular tags", () => {
  it("downloads anonymously, without anything the member typed, and keeps names Tagify can save", async () => {
    const request = respond(200, list);
    const updated = vi.fn();
    window.addEventListener(COMMUNITY_POPULAR_TAGS_UPDATED_EVENT, updated);
    await preloadCommunityPopularTags(request, () => 1_000);
    window.removeEventListener(COMMUNITY_POPULAR_TAGS_UPDATED_EVENT, updated);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "https://community.tagify.fm/api/v1/tag-names",
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(COMMUNITY_POPULAR_TAGS_URL).not.toContain("?");
    expect(getCommunityPopularTags(() => 1_000)).toEqual([
      { name: "male vocalist", slug: "male-vocalist", people: 12 },
      { name: "lo-fi", slug: "lo-fi", people: 4 },
    ]);
    expect(updated).toHaveBeenCalledTimes(1);
  });

  it("shares one download between the extension and the app, and keeps it for a day", async () => {
    const request = respond(200, list);
    await Promise.all([preloadCommunityPopularTags(request, () => 0), preloadCommunityPopularTags(request, () => 0)]);
    await preloadCommunityPopularTags(request, () => DAY - 1);
    expect(request).toHaveBeenCalledTimes(1);

    // A new Spotify session reads the saved list without asking again.
    resetCommunityPopularTags();
    await preloadCommunityPopularTags(request, () => DAY - 1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(getCommunityPopularTags(() => DAY - 1)).toHaveLength(2);

    await preloadCommunityPopularTags(request, () => DAY);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("refreshes in the background once the list is a day old, showing the saved names meanwhile", async () => {
    const request = respond(200, list);
    vi.stubGlobal("fetch", request);
    await preloadCommunityPopularTags(request, () => 0);
    expect(getCommunityPopularTags(() => DAY + 1)).toHaveLength(2);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("shows nothing, and waits a day, while Community doesn't list names yet", async () => {
    const missing = respond(404, { error: "Not found" });
    await preloadCommunityPopularTags(missing, () => 0);
    expect(getCommunityPopularTags(() => 0)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(COMMUNITY_POPULAR_TAGS_STORAGE_KEY)!)).toEqual({ checkedAt: 0, tags: null });

    resetCommunityPopularTags();
    await preloadCommunityPopularTags(missing, () => DAY - 1);
    expect(missing).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when offline and nothing was saved before, without asking again for a day", async () => {
    const offline = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await preloadCommunityPopularTags(offline, () => 0);
    await preloadCommunityPopularTags(offline, () => 60_000);
    expect(offline).toHaveBeenCalledTimes(1);
    expect(getCommunityPopularTags(() => 60_000)).toEqual([]);
  });

  it("keeps the earlier names when Community can't be reached", async () => {
    await preloadCommunityPopularTags(respond(200, list), () => 0);
    await preloadCommunityPopularTags(respond(503), () => DAY);
    expect(getCommunityPopularTags(() => DAY)).toHaveLength(2);
  });

  it("shows nothing for a list it can't read, such as a newer version", async () => {
    await preloadCommunityPopularTags(respond(200, { version: 2, tags: [] }), () => 0);
    expect(getCommunityPopularTags(() => 0)).toEqual([]);
  });

  it("ignores a damaged saved list", async () => {
    localStorage.setItem(COMMUNITY_POPULAR_TAGS_STORAGE_KEY, JSON.stringify({ checkedAt: 0, tags: [{ name: 3 }] }));
    const request = respond(200, list);
    await preloadCommunityPopularTags(request, () => 1);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
