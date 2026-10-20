import { describe, expect, it, vi } from "vitest";
import { answerDesktopPlay, canPlayFromCommunity, DesktopPlayer, playRequestedSong, readDesktopPlayRequest } from "../DesktopPlay";

const device = { libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222" };
const NOW = Date.parse("2026-10-19T18:00:00.000Z");
const request = (overrides: Record<string, unknown> = {}) => ({
  libraryId: device.libraryId, deviceId: device.deviceId, requestId: "33333333-3333-4333-8333-333333333333",
  trackId: "4uLU6hMCjMI75M1A2tKUQC", requestedAt: "2026-10-19T17:59:58.000Z", ...overrides,
});
const session = async () => ({ apiBaseUrl: "https://community.example", accessToken: "token", deviceId: device.deviceId });

describe("readDesktopPlayRequest", () => {
  it("accepts a recent request for this library and this computer", () => {
    expect(readDesktopPlayRequest(request(), device, NOW)).toEqual({ requestId: "33333333-3333-4333-8333-333333333333", trackId: "4uLU6hMCjMI75M1A2tKUQC" });
  });

  it("ignores requests for another computer or library, or that aren't one Spotify song", () => {
    expect(readDesktopPlayRequest(request({ deviceId: "44444444-4444-4444-8444-444444444444" }), device, NOW)).toBeNull();
    expect(readDesktopPlayRequest(request({ libraryId: "55555555-5555-4555-8555-555555555555" }), device, NOW)).toBeNull();
    expect(readDesktopPlayRequest(request({ trackId: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" }), device, NOW)).toBeNull();
    expect(readDesktopPlayRequest(request({ requestId: "not-a-request" }), device, NOW)).toBeNull();
    expect(readDesktopPlayRequest(null, device, NOW)).toBeNull();
  });

  it("never plays a request from more than a minute ago, so a Tagify that was asleep stays quiet", () => {
    expect(readDesktopPlayRequest(request({ requestedAt: "2026-10-19T17:58:30.000Z" }), device, NOW)).toBeNull();
    expect(readDesktopPlayRequest(request({ requestedAt: "2026-10-19T18:02:00.000Z" }), device, NOW)).toBeNull();
    expect(readDesktopPlayRequest(request({ requestedAt: "yesterday" }), device, NOW)).toBeNull();
  });
});

describe("playing and answering", () => {
  it("plays the song with Spotify's player and says whether Spotify took it", async () => {
    const player = { playUri: vi.fn().mockResolvedValue(undefined) };
    expect(await playRequestedSong("4uLU6hMCjMI75M1A2tKUQC", player)).toBe(true);
    expect(player.playUri).toHaveBeenCalledWith("spotify:track:4uLU6hMCjMI75M1A2tKUQC");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await playRequestedSong("4uLU6hMCjMI75M1A2tKUQC", { playUri: vi.fn().mockRejectedValue(new Error("offline")) })).toBe(false);
    expect(canPlayFromCommunity(player)).toBe(true);
    expect(canPlayFromCommunity({})).toBe(false);
  });

  it("answers Community, and never throws when Community can't hear it", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await answerDesktopPlay(session, "33333333-3333-4333-8333-333333333333", "played", fetcher)).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://community.example/api/v2/sync/desktop-play");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ deviceId: device.deviceId, requestId: "33333333-3333-4333-8333-333333333333", outcome: "played" });
    expect(await answerDesktopPlay(session, "x", "failed", vi.fn().mockResolvedValue(new Response("", { status: 404 })))).toBe(false);
    expect(await answerDesktopPlay(session, "x", "failed", vi.fn().mockRejectedValue(new TypeError("offline")))).toBe(false);
  });

  it("plays each request once, even when the broadcast arrives twice", async () => {
    const play = vi.fn().mockResolvedValue(true);
    const answer = vi.fn().mockResolvedValue(true);
    const player = new DesktopPlayer(play, answer);
    const read = readDesktopPlayRequest(request(), device, NOW)!;
    expect(await player.handle(read, session)).toBe("played");
    expect(await player.handle(read, session)).toBe("repeat");
    expect(play).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith(session, read.requestId, "played");
    play.mockResolvedValue(false);
    expect(await player.handle({ ...read, requestId: "66666666-6666-4666-8666-666666666666" }, session)).toBe("failed");
    expect(answer).toHaveBeenLastCalledWith(session, "66666666-6666-4666-8666-666666666666", "failed");
  });
});
