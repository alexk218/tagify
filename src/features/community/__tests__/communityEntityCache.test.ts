import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCommunityEntityCache,
  COMMUNITY_ENTITY_CACHE_MS,
  COMMUNITY_ENTITY_FAILURE_CACHE_MS,
  lookupCommunityEntity,
} from "../communityEntityCache";

const id = "1eyzqe2QqGZUmfcPZtrIyt";
const publicUrl = `https://community.tagify.fm/api/v2/public-entities/track/${id}`;
const originalUrl = `https://community.tagify.fm/api/v2/entities/track/${id}`;
const found = () => Response.json({ entity: { contributors: [{ handle: "mira" }] } });
const notFound = () => Response.json({ error: "Entity not found" }, { status: 404 });
const missingRoute = () => new Response("<!DOCTYPE html><title>404</title>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });

afterEach(() => clearCommunityEntityCache());

describe("Community entity lookups", () => {
  it("shares one anonymous request between simultaneous views", async () => {
    const request = vi.fn(async (_url: RequestInfo | URL) => found());

    const [first, second] = await Promise.all([
      lookupCommunityEntity("track", id, request),
      lookupCommunityEntity("track", id, request),
    ]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(publicUrl);
    expect(first).toEqual({ found: true, entity: { contributors: [{ handle: "mira" }] } });
    expect(second).toBe(first);
  });

  it("reuses found and missing pages for ten minutes", async () => {
    let now = 1_000;
    const request = vi.fn(async (url: RequestInfo | URL) => (String(url).endsWith("/album/2234567890123456789012") ? notFound() : found()));

    await lookupCommunityEntity("track", id, request, () => now);
    expect(await lookupCommunityEntity("album", "2234567890123456789012", request, () => now)).toEqual({ found: false, entity: null });
    now += COMMUNITY_ENTITY_CACHE_MS - 1;
    await lookupCommunityEntity("track", id, request, () => now);
    await lookupCommunityEntity("album", "2234567890123456789012", request, () => now);
    expect(request).toHaveBeenCalledTimes(2);

    now += 1;
    await lookupCommunityEntity("track", id, request, () => now);
    await lookupCommunityEntity("album", "2234567890123456789012", request, () => now);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("retries failed lookups after a minute", async () => {
    let now = 1_000;
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(found());

    expect(await lookupCommunityEntity("track", id, request, () => now)).toEqual({ found: false, entity: null });
    now += COMMUNITY_ENTITY_FAILURE_CACHE_MS - 1;
    await lookupCommunityEntity("track", id, request, () => now);
    expect(request).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await lookupCommunityEntity("track", id, request, () => now)).toEqual({ found: false, entity: null });
    now += COMMUNITY_ENTITY_FAILURE_CACHE_MS;
    expect((await lookupCommunityEntity("track", id, request, () => now)).found).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("uses the original route for the rest of the session when the public route is not deployed", async () => {
    const request = vi.fn(async (url: RequestInfo | URL) => (String(url).includes("/public-entities/") ? missingRoute() : found()));

    expect((await lookupCommunityEntity("track", id, request)).found).toBe(true);
    expect(request.mock.calls.map(([url]) => url)).toEqual([publicUrl, originalUrl]);

    await lookupCommunityEntity("artist", "63MQldklfxkjYDoUE4Tppz", request);
    expect(request).toHaveBeenLastCalledWith("https://community.tagify.fm/api/v2/entities/artist/63MQldklfxkjYDoUE4Tppz");
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it("treats the public route's JSON 404 as a missing page, not a missing route", async () => {
    const request = vi.fn(async (_url: RequestInfo | URL) => notFound());

    expect(await lookupCommunityEntity("track", id, request)).toEqual({ found: false, entity: null });
    await lookupCommunityEntity("artist", "63MQldklfxkjYDoUE4Tppz", request);

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      publicUrl,
      "https://community.tagify.fm/api/v2/public-entities/artist/63MQldklfxkjYDoUE4Tppz",
    ]);
  });
});
