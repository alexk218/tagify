// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { graphqlRateLimiter } from "@/utils/RateLimiter";
import { assertSpotifyWriteSettled, spotifyFetch } from "../SpotifyRequests";

afterEach(() => { graphqlRateLimiter.reset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function stalledBody(cancellable = true) {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  let signal!: AbortSignal;
  const fetch = vi.fn(async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      body = controller;
      controller.enqueue(new TextEncoder().encode('{"ok":'));
      if (cancellable) signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    } }));
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, finish: () => { body.enqueue(new TextEncoder().encode('true}')); body.close(); }, signal: () => signal };
}

it("times out after headers when the body stalls, then allows a healthy request", async () => {
  vi.useFakeTimers();
  const transport = stalledBody();
  const result = expect(spotifyFetch("https://api.spotify.com/body")).rejects.toMatchObject({ spotifyRequestStopped: true });
  await vi.advanceTimersByTimeAsync(10_001);
  await result;
  expect(transport.signal().aborted).toBe(true);
  await vi.waitFor(() => expect(graphqlRateLimiter.getStats().stalledRequests).toBe(0));
  transport.fetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 201, headers: { "X-Test": "kept" } }));
  const response = await spotifyFetch("https://api.spotify.com/recovered");
  expect(response.status).toBe(201);
  expect(response.headers.get("X-Test")).toBe("kept");
  expect(await response.json()).toEqual({ ok: true });
  expect(transport.fetch).toHaveBeenCalledTimes(2);
});

it("holds an uncancellable timed-out write until its body settles, without replaying it", async () => {
  vi.useFakeTimers();
  const transport = stalledBody(false);
  const url = "https://api.spotify.com/v1/playlists/body-write/items";
  const result = expect(spotifyFetch(url, { method: "POST" })).rejects.toMatchObject({ spotifyRequestStopped: true });
  await vi.advanceTimersByTimeAsync(10_001); await result;
  expect(() => assertSpotifyWriteSettled("spotify:playlist:body-write")).toThrow();
  await expect(spotifyFetch(url, { method: "POST" })).rejects.toMatchObject({ spotifyRequestStopped: true });
  expect(transport.fetch).toHaveBeenCalledTimes(1);
  transport.finish();
  await vi.waitFor(() => expect(() => assertSpotifyWriteSettled("spotify:playlist:body-write")).not.toThrow());
});

it("keeps a shared body alive when only one reader cancels", async () => {
  const transport = stalledBody();
  const controller = new AbortController();
  const first = spotifyFetch("https://api.spotify.com/shared-body", { signal: controller.signal });
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = spotifyFetch("https://api.spotify.com/shared-body");
  controller.abort(); await cancelled;
  expect(transport.signal().aborted).toBe(false);
  transport.finish();
  expect(await (await second).json()).toEqual({ ok: true });
  expect(transport.fetch).toHaveBeenCalledTimes(1);
});

it("preserves empty write responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  const response = await spotifyFetch("https://api.spotify.com/v1/playlists/empty/items", { method: "DELETE" });
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
});

it("bounds a stalled throttled body and cancels it", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('partial')); }, cancel });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 429, headers: { "Retry-After": "10" } })));
  await expect(spotifyFetch("https://api.spotify.com/throttled-body")).rejects.toMatchObject({ status: 429 });
  expect(cancel).toHaveBeenCalledOnce();
});
