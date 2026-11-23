import { afterEach, describe, expect, it, vi } from "vitest";
import { LIKED_SAVE_CREDIT_PATH, flushLikedSaveCredits, queueLikedSaveCredit } from "../communityLikedSaveCredits";

const TRACK = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const connection = { accountId: "account-1", deviceId: "device-1" };
type Sent = { body: { requestId: string } };
const requestIdOf = (mock: { mock: { calls: unknown[][] } }, call = 0) => ((mock.mock.calls[call] as unknown[])[1] as Sent).body.requestId;
const failure = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

afterEach(() => localStorage.clear());

describe("curator credit for songs saved from On Community", () => {
  it("sends the saved song with its searched tags once, then forgets it", async () => {
    queueLikedSaveCredit("account-1", TRACK, [" Deep House ", "deep house", "Deep House", ""]);
    queueLikedSaveCredit("account-1", TRACK, ["Minimal"]);
    const request = vi.fn(async () => ({ credited: true }));
    await flushLikedSaveCredits(connection, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(LIKED_SAVE_CREDIT_PATH, {
      method: "POST",
      body: { deviceId: "device-1", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), spotifyTrackId: "4uLU6hMCjMI75M1A2tKUQC", tags: ["Deep House", "deep house"] },
    });
    await flushLikedSaveCredits(connection, request);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps a save while Community doesn't take it yet, with the same request id", async () => {
    queueLikedSaveCredit("account-1", TRACK, ["Deep House"]);
    const notYet = vi.fn(async () => { throw failure(404); });
    await flushLikedSaveCredits(connection, notYet);
    const later = vi.fn(async () => ({ credited: false }));
    await flushLikedSaveCredits(connection, later);
    expect(requestIdOf(later)).toBe(requestIdOf(notYet));
    await flushLikedSaveCredits(connection, later);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("drops a save Community refuses, and ignores local files and other accounts", async () => {
    queueLikedSaveCredit("account-1", "spotify:local:a:b:c:1", ["Deep House"]);
    queueLikedSaveCredit("account-2", TRACK, ["Deep House"]);
    queueLikedSaveCredit("account-1", TRACK, ["Deep House"]);
    const refused = vi.fn(async () => { throw failure(400); });
    await flushLikedSaveCredits(connection, refused);
    expect(refused).toHaveBeenCalledTimes(1);
    const again = vi.fn(async () => ({}));
    await flushLikedSaveCredits(connection, again);
    expect(again).not.toHaveBeenCalled();
    await flushLikedSaveCredits({ accountId: "account-2", deviceId: "device-2" }, again);
    expect(again).toHaveBeenCalledTimes(1);
  });
});
