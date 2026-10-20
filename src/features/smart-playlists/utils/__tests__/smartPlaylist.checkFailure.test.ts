// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spotifyLocalPause } from "@/utils/spotifyRequestFailure";
import { describeSmartPlaylistCheckFailure, formatCheckRetryWait, mostActionableCheckFailure } from "../smartPlaylist.checkFailure";

describe("Smart Playlist check failures", () => {
  it("distinguishes a Spotify pause, an unresponsive Spotify and other failures", () => {
    expect(describeSmartPlaylistCheckFailure(spotifyLocalPause(180), 1_000)).toEqual({ kind: "paused", retryAt: 181_000 });
    expect(describeSmartPlaylistCheckFailure({ status: 429, retryAfterSeconds: 30 }, 0)).toEqual({ kind: "paused", retryAt: 30_000 });
    expect(describeSmartPlaylistCheckFailure(Object.assign(new Error("slow"), { spotifyRequestStopped: true, recoveryRequired: true }))).toEqual({ kind: "notResponding" });
    expect(describeSmartPlaylistCheckFailure(new Error("Invalid playlist response!"))).toEqual({ kind: "failed" });
  });

  it("explains the failure the user can act on first", () => {
    expect(mostActionableCheckFailure([])).toBeUndefined();
    expect(mostActionableCheckFailure([{ kind: "failed" }, { kind: "paused", retryAt: 5 }, { kind: "paused", retryAt: 9 }, undefined])).toEqual({ kind: "paused", retryAt: 9 });
    expect(mostActionableCheckFailure([{ kind: "paused", retryAt: 9 }, { kind: "failed" }])).toEqual({ kind: "paused", retryAt: 9 });
    expect(mostActionableCheckFailure([{ kind: "paused", retryAt: 9 }, { kind: "notResponding" }, { kind: "paused", retryAt: 20 }])).toEqual({ kind: "notResponding" });
  });

  it.each([
    [0, "about a minute"], [30_000, "about a minute"], [61_000, "about 2 minutes"],
    [3 * 60_000, "about 3 minutes"], [60 * 60_000, "about an hour"], [150 * 60_000, "about 3 hours"],
  ])("describes a %ims wait as %s", (wait, text) => {
    expect(formatCheckRetryWait(1_000 + wait, 1_000)).toBe(text);
  });
});
