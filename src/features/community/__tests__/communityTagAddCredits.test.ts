// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushCommunityTagAddCredits, queueCommunityTagAddCredits } from "../communityTagAddCredits";

const KEY = "tagify:communityTagAddCredits:v1";
const connection = { accountId: "account-1", deviceId: "device-1" };
const song = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const other = "spotify:track:7ouMYWpwJ422jRcDASZB7P";
const outbox = () => JSON.parse(localStorage.getItem(KEY) || "[]") as Array<{ accountId: string; name: string; spotifyTrackId: string }>;

describe("curator credits for members' tags added on desktop", () => {
  beforeEach(() => localStorage.removeItem(KEY));

  it("queues each spelling once per song and skips songs that aren't on Spotify", () => {
    queueCommunityTagAddCredits("account-1", song, ["Coastal", "coastal ", "Coast-al"]);
    queueCommunityTagAddCredits("account-1", other, ["Coastal"]);
    queueCommunityTagAddCredits("account-1", "spotify:local:a:b:c:1", ["Coastal"]);
    expect(outbox().map((entry) => [entry.spotifyTrackId, entry.name])).toEqual([
      ["4uLU6hMCjMI75M1A2tKUQC", "Coastal"],
      ["4uLU6hMCjMI75M1A2tKUQC", "Coast-al"],
      ["7ouMYWpwJ422jRcDASZB7P", "Coastal"],
    ]);
  });

  it("sends the connected account's adds and keeps the ones Community can't credit yet", async () => {
    queueCommunityTagAddCredits("account-1", song, ["Coastal", "Dusk"]);
    queueCommunityTagAddCredits("account-2", song, ["Coastal"]);
    const request = vi.fn().mockResolvedValue({ waiting: [1] });
    await flushCommunityTagAddCredits(connection, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/v2/tag-adds", {
      method: "POST",
      body: { deviceId: "device-1", adds: [
        { name: "Coastal", spotifyTrackId: "4uLU6hMCjMI75M1A2tKUQC" },
        { name: "Dusk", spotifyTrackId: "4uLU6hMCjMI75M1A2tKUQC" },
      ] },
    });
    expect(outbox().map((entry) => `${entry.accountId}:${entry.name}`)).toEqual(["account-1:Dusk", "account-2:Coastal"]);
  });

  it("keeps everything when Community can't be reached or doesn't know the route yet", async () => {
    queueCommunityTagAddCredits("account-1", song, ["Coastal"]);
    await flushCommunityTagAddCredits(connection, vi.fn().mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 })));
    await flushCommunityTagAddCredits(connection, vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(outbox()).toHaveLength(1);
  });

  it("drops a batch Community will never accept", async () => {
    queueCommunityTagAddCredits("account-1", song, ["Coastal"]);
    await flushCommunityTagAddCredits(connection, vi.fn().mockRejectedValue(Object.assign(new Error("Invalid"), { status: 400 })));
    expect(outbox()).toEqual([]);
  });

  it("forgets adds after a week", async () => {
    queueCommunityTagAddCredits("account-1", song, ["Coastal"], 0);
    const request = vi.fn();
    await flushCommunityTagAddCredits(connection, request, 8 * 24 * 60 * 60 * 1000);
    expect(request).not.toHaveBeenCalled();
  });

  it("sends nothing without a Community connection", async () => {
    queueCommunityTagAddCredits("account-1", song, ["Coastal"]);
    const request = vi.fn();
    await flushCommunityTagAddCredits(null, request);
    expect(request).not.toHaveBeenCalled();
  });
});
