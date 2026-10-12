import { afterEach, expect, it, vi } from "vitest";
import { spotifyFetch, spotifyRead } from "../SpotifyRequests";
import { spotifyApiService } from "../SpotifyApiService";
import { graphqlRateLimiter } from "@/utils/RateLimiter";
import { spotifyRequestAccounting } from "@/utils/spotifyRequestAccounting";
import { classifySpotifyFailure, spotifyEndpointLabel } from "@/utils/spotifyRequestFailure";
import { getSpotifyRetryAfterMs } from "@/utils/spotifyRateLimit";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([
  ["GET", "tracks?ids=secret"], ["GET", "albums?ids=secret"], ["GET", "artists?ids=x"],
  ["GET", "audio-features/x"], ["GET", "audio-features?ids=x"], ["GET", "audio-analysis/x"],
  ["GET", "recommendations"], ["GET", "artists/x/related-artists"], ["GET", "artists/x/top-tracks"],
  ["GET", "browse/categories/x/playlists"], ["GET", "browse/featured-playlists"],
  ["GET", "playlists/x/tracks"], ["POST", "playlists/x/tracks"], ["PUT", "playlists/x/tracks"], ["DELETE", "playlists/x/tracks"],
  ["POST", "users/x/playlists"], ["GET", "users/x"], ["GET", "users/x/playlists"],
  ["PUT", "me/tracks"], ["DELETE", "me/albums"], ["GET", "me/tracks/contains"], ["PUT", "playlists/x/followers"],
])("blocks %s /%s before any HTTP dispatch", async (method, path) => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const error = await spotifyFetch(`https://api.spotify.com/v1/${path}`, { method }).catch(error => error);
  expect(error).toMatchObject({ spotifyRequestStopped: true, spotifyFailure: { kind: "unsupported-endpoint", dispatched: false } });
  expect(error.status).toBeUndefined();
  expect(getSpotifyRetryAfterMs(error)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("also prevents legacy Cosmos reads and skips removed batch album counts", async () => {
  const run = vi.fn();
  await expect(spotifyRead('desktop:get:["https://api.spotify.com/v1/playlists/private/tracks"]', run)).rejects.toMatchObject({ spotifyFailure: { kind: "unsupported-endpoint" } });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await spotifyApiService.getAlbumTrackTotals(Array.from({ length: 50000 }, (_, i) => `spotify:album:${i}`))).toBeNull();
  expect(run).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it.each(["me/tracks", "albums/id/tracks", "tracks/id", "albums/id", "artists/id", "me/playlists", "playlists/id/items", "me/library/contains"])("retains supported GET /%s with one request", async path => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetch);
  expect((await spotifyFetch(`https://api.spotify.com/v1/${path}`)).ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("distinguishes quota exhaustion from a persisted local pause with one shared request", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { reason: "QUOTA_EXCEEDED", message: "do not retain private payload" } }), { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  const errors = await Promise.all([1, 2].map(() => spotifyFetch("https://api.spotify.com/v1/tracks/private-id?token=secret").catch(error => error)));
  expect(errors[0]).toMatchObject({ status: 429, spotifyFailure: { kind: "quota-exceeded", dispatched: true, endpoint: "GET api.spotify.com/v1/tracks/{id}" } });
  expect(getSpotifyRetryAfterMs(errors[0])).toBe(3600000);
  graphqlRateLimiter.reset();
  const run = vi.fn();
  await expect(spotifyRead("desktop:another", run)).rejects.toMatchObject({ spotifyFailure: { kind: "local-pause", dispatched: false, cause: "quota-exceeded" } });
  expect(run).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
  const stats = spotifyRequestAccounting.snapshot();
  expect(stats.failures).toMatchObject({ "quota-exceeded": 1, "local-pause": 1 });
  expect(JSON.stringify(errors[0].spotifyFailure)).not.toMatch(/private-id|token|secret|payload/);
});

it.each([["30", "rate-limit", 30000], [null, "server-429", 60000]])("classifies Retry-After %s without inventing a cause", async (header, kind, wait) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 429, headers: header ? { "Retry-After": String(header) } : {} })));
  const error = await spotifyFetch("https://api.spotify.com/v1/tracks/example").catch(error => error);
  expect(error.spotifyFailure).toMatchObject({ kind, dispatched: true });
  expect(getSpotifyRetryAfterMs(error)).toBe(wait);
});

it("bounds malformed, oversized and stalled error bodies without losing HTTP evidence", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"error":')); }, cancel });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 429, headers: { "Retry-After": "20" } })));
  const pending = spotifyFetch("https://api.spotify.com/v1/tracks/stalled").catch(error => error);
  await vi.advanceTimersByTimeAsync(251);
  expect((await pending).spotifyFailure.kind).toBe("rate-limit"); expect(cancel).toHaveBeenCalledTimes(1);
});

it("classifies desktop/GraphQL errors without adding a probe", async () => {
  const run = vi.fn().mockRejectedValue({ statusCode: 429, body: { error: { reason: "QUOTA_EXCEEDED" } } });
  await expect(spotifyRead("graphql:operation", run, { transport: "graphql" })).rejects.toMatchObject({ spotifyFailure: { kind: "quota-exceeded", dispatched: true } });
  expect(run).toHaveBeenCalledTimes(1);
  expect(classifySpotifyFailure({ extensions: { http: { status: 429, headers: { "retry-after": "10" } } } })?.kind).toBe("rate-limit");
  expect(spotifyEndpointLabel("https://spclient.wg.spotify.com/metadata/4/track/secret?token=hidden")).toBe("GET spclient.wg.spotify.com/metadata/4/track/{id}");
});

it("pauses new dispatch at 429 headers while the error body is still being diagnosed", async () => {
  vi.useFakeTimers();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 429, headers: { "Retry-After": "40" } }));
  vi.stubGlobal("fetch", fetch);
  const first = spotifyFetch("https://api.spotify.com/v1/tracks/a").catch(error => error);
  await vi.advanceTimersByTimeAsync(1);
  await expect(spotifyFetch("https://api.spotify.com/v1/tracks/b")).rejects.toMatchObject({ spotifyFailure: { kind: "local-pause", dispatched: false } });
  controller.enqueue(new TextEncoder().encode('{"error":{"reason":"QUOTA_EXCEEDED"}}')); controller.close();
  expect((await first).spotifyFailure.kind).toBe("quota-exceeded");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("limits oversized error bodies and keeps an old pause's unknown origin explicit", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(8193)); }, cancel });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 429 })));
  expect((await spotifyFetch("https://api.spotify.com/v1/tracks/large").catch(error => error)).spotifyFailure.kind).toBe("server-429");
  expect(cancel).toHaveBeenCalledOnce();
  graphqlRateLimiter.reset();
  localStorage.removeItem(`tagify:spotify-cooldown:v1:${Spicetify.Platform.username}:cause`);
  const run = vi.fn();
  const error = await spotifyRead("legacy-pause", run).catch(error => error);
  expect(classifySpotifyFailure(error)).toMatchObject({ kind: "local-pause", dispatched: false });
  expect(classifySpotifyFailure(error)?.cause).toBeUndefined(); expect(run).not.toHaveBeenCalled();
});

it("recognizes an already-decoded SDK body without treating an access error as throttling", () => {
  expect(classifySpotifyFailure({ body: JSON.stringify({ error: { status: 429, reason: "QUOTA_EXCEEDED" } }) })?.kind).toBe("quota-exceeded");
  expect(classifySpotifyFailure({ status: 403, body: { error: { reason: "QUOTA_EXCEEDED" } } })).toBeUndefined();
  expect(classifySpotifyFailure({ status: 429, headers: { "Retry-After": "nonsense" } })?.kind).toBe("server-429");
  expect(spotifyEndpointLabel("https://api.spotify.com.example.org/v1/tracks/private")).toBe("Spotify SDK");
});

it("does not turn a local background deferral into a global server cooldown", async () => {
  const { spotifyLocalPause } = await import("@/utils/spotifyRequestFailure");
  await expect(spotifyRead("optional", async () => { throw spotifyLocalPause(120); })).rejects.toMatchObject({ spotifyFailure: { kind: "local-pause", dispatched: false } });
  const foreground = vi.fn().mockResolvedValue("works");
  expect(await spotifyRead("foreground", foreground)).toBe("works");
  expect(foreground).toHaveBeenCalledTimes(1);
  expect(spotifyRequestAccounting.snapshot().failures).toEqual({ "local-pause": 1 });
});

it("does not apply a late old-account 429 to the newly signed-in account", async () => {
  const platform = { ...Spicetify.Platform, username: "old-account" };
  vi.stubGlobal("Spicetify", { ...Spicetify, Platform: platform });
  let finish!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const old = spotifyFetch("https://api.spotify.com/v1/tracks/old").catch(error => error);
  platform.username = "new-account";
  finish(new Response('{"error":{"reason":"QUOTA_EXCEEDED"}}', { status: 429 }));
  expect((await old).name).toBe("AbortError");
  expect((await spotifyFetch("https://api.spotify.com/v1/tracks/new")).ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not reuse stale cause metadata after a partial cooldown storage write", async () => {
  const { spotifyAccountKey } = await import("../SpotifyRequests");
  const key = `tagify:spotify-cooldown:v1:${spotifyAccountKey()}`, until = Date.now() + 60000;
  localStorage.setItem(key, String(until));
  localStorage.setItem(`${key}:cause`, JSON.stringify({ until: until - 1000, failure: { kind: "quota-exceeded", dispatched: true } }));
  const run = vi.fn();
  const error = await spotifyRead("paused", run).catch(error => error);
  expect(classifySpotifyFailure(error)).toMatchObject({ kind: "local-pause", dispatched: false });
  expect(classifySpotifyFailure(error)?.cause).toBeUndefined(); expect(run).not.toHaveBeenCalled();
});
