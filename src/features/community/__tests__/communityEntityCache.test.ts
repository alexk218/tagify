// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCommunityEntityCache,
  COMMUNITY_ENTITY_REVALIDATE_MS,
  lookupCommunityEntity,
  peekCommunityEntity,
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

  it("keeps answers for the whole session without asking again", async () => {
    let now = 1_000;
    const request = vi.fn(async (url: RequestInfo | URL) => (String(url).endsWith("/album/2234567890123456789012") ? notFound() : found()));
    expect(peekCommunityEntity("track", id)).toBeUndefined();

    await lookupCommunityEntity("track", id, request, () => now);
    await lookupCommunityEntity("album", "2234567890123456789012", request, () => now);
    now += 12 * 60 * 60_000;

    expect(peekCommunityEntity("track", id)).toEqual({ found: true, entity: { contributors: [{ handle: "mira" }] } });
    expect(peekCommunityEntity("album", "2234567890123456789012")).toEqual({ found: false, entity: null });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("checks again when asked, at most once a minute", async () => {
    let now = 1_000;
    const request = vi.fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(found());

    expect((await lookupCommunityEntity("track", id, request, () => now)).found).toBe(false);
    now += COMMUNITY_ENTITY_REVALIDATE_MS - 1;
    expect((await lookupCommunityEntity("track", id, request, () => now)).found).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    now += 1;
    // Another member tagged it since.
    expect((await lookupCommunityEntity("track", id, request, () => now)).found).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps the earlier answer when a check fails, and says when there is none", async () => {
    let now = 1_000;
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(found())
      .mockResolvedValueOnce(new Response("busy", { status: 503 }));

    expect(await lookupCommunityEntity("track", id, request, () => now)).toEqual({ found: false, entity: null, unavailable: true });
    expect(peekCommunityEntity("track", id)).toBeUndefined();
    // A failure is not remembered: asking again tries again straight away.
    expect((await lookupCommunityEntity("track", id, request, () => now)).found).toBe(true);
    now += COMMUNITY_ENTITY_REVALIDATE_MS;
    expect(await lookupCommunityEntity("track", id, request, () => now)).toEqual({ found: true, entity: { contributors: [{ handle: "mira" }] } });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("forgets the least recently used items beyond 500", async () => {
    const request = vi.fn(async () => found());
    for (let index = 0; index < 501; index++) {
      await lookupCommunityEntity("track", `${index}`.padStart(22, "0"), request);
    }
    expect(peekCommunityEntity("track", "0".repeat(22))).toBeUndefined();
    expect(peekCommunityEntity("track", "1".padStart(22, "0"))).toBeDefined();
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
