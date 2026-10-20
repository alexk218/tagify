// @vitest-environment node
import { expect, it, vi } from "vitest";
import { SpotifyFailureHistory } from "../spotifyFailureHistory";
import { spotifyLocalPause } from "../spotifyRequestFailure";

it("persists a bounded safe history across reloads without retaining identities or error payloads", () => {
  const history = new SpotifyFailureHistory();
  for (let i = 0; i < 75; i++) history.record("user", `fetch:https://api.spotify.com/v1/artists/private-${i}?token=secret`, { status: 429, retryAfterSeconds: i, message: "private payload" }, "artist-identities", "fetch");
  const restored = new SpotifyFailureHistory().read("user");
  expect(restored.length).toBeLessThanOrEqual(50);
  expect(restored.at(-1)).toMatchObject({ endpoint: "GET api.spotify.com/v1/artists/{id}", status: 429, dispatched: true });
  expect(JSON.stringify(restored)).not.toMatch(/private|secret|payload|user/);
  expect(history.read("another-account")).toEqual([]);
});
it("aggregates local pauses without confusing them with server responses", () => {
  const history = new SpotifyFailureHistory();
  history.record("user", "fetch:https://api.spotify.com/v1/artists/private", { status: 429, reason: "QUOTA_EXCEEDED" });
  for (let i = 0; i < 250; i++) history.record("user", "graphql:private", spotifyLocalPause(42), "smart-playlists", "graphql", false);
  expect(history.read("user")).toMatchObject([
    { kind: "quota-exceeded", status: 429, reason: "QUOTA_EXCEEDED", count: 1 },
    { kind: "local-pause", dispatched: false, count: 250 },
  ]);
  expect(history.read("user")[1].status).toBeUndefined();
});
it("does not double count a response rethrown by a nested SDK wrapper", () => {
  const history = new SpotifyFailureHistory(), error = { status: 429 };
  history.record("user", "fetch:https://api.spotify.com/v1/albums/private", error);
  history.record("user", "desktop:private", Object.assign(new Error("private"), error), undefined, "desktop", true, error);
  expect(history.read("user")).toHaveLength(1);
});
it("ignores corrupt storage and tolerates a full disk", () => {
  const storage = { getItem: vi.fn().mockReturnValue('{"token":"secret"}'), setItem: vi.fn(() => { throw new Error("quota"); }) };
  const history = new SpotifyFailureHistory(() => storage as unknown as Storage);
  expect(history.read("user")).toEqual([]);
  expect(() => history.record("user", "unknown:secret", { status: 403 })).not.toThrow();
  expect(history.read("user")[0]).toMatchObject({ status: 403, endpoint: "Spotify SDK" });
});
it("revalidates saved entries and expires old failures", () => {
  const history = new SpotifyFailureHistory();
  history.record("user", "https://api.spotify.com/v1/tracks/secret", { status: 401 });
  const rows = history.read("user");
  localStorage.setItem("tagify:spotify-failures:v1:other", JSON.stringify([{ ...rows[0], lastAt: "bad", token: "secret" }]));
  expect(new SpotifyFailureHistory().read("other")).toEqual([]);
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60_000);
  expect(history.read("user")).toEqual([]);
  vi.useRealTimers();
});
it("keeps a known SDK operation while discarding its private arguments", () => {
  const history = new SpotifyFailureHistory();
  history.record("user", 'desktop:playlist:getContents:["spotify:playlist:secret"]', { status: 429 });
  expect(history.read("user")[0].endpoint).toBe("Desktop PlaylistAPI.getContents");
  expect(JSON.stringify(history.read("user"))).not.toContain("secret");
});
it("captures the real request boundary and persisted response evidence without another dispatch", async () => {
  const { spotifyFetch, spotifyRead } = await import("@/services/SpotifyRequests");
  const { spotifyFailureHistory } = await import("../spotifyFailureHistory");
  const originalUser = Spicetify.Platform.username;
  Spicetify.Platform.username = "history-integration";
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { reason: "QUOTA_EXCEEDED", message: "private response" } }), { status: 429, headers: { "Retry-After": "120" } }));
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(spotifyFetch("https://api.spotify.com/v1/tracks/private?token=secret")).rejects.toMatchObject({ status: 429 });
    const run = vi.fn();
    await expect(spotifyRead("desktop:playlist:getContents:[]", run)).rejects.toMatchObject({ spotifyFailure: { dispatched: false } });
    expect(fetch).toHaveBeenCalledTimes(1); expect(run).not.toHaveBeenCalled();
    const saved = spotifyFailureHistory.read("history-integration");
    expect(saved).toMatchObject([{ kind: "quota-exceeded", retryAfterSeconds: 120, status: 429 }, { kind: "local-pause", dispatched: false }]);
    expect(new SpotifyFailureHistory().read("history-integration")).toEqual(saved);
    expect(JSON.stringify(saved)).not.toMatch(/private|secret|token/);
  } finally { Spicetify.Platform.username = originalUser; vi.unstubAllGlobals(); }
});
