import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_UPDATE_INTERVAL_MS, COMMUNITY_UPDATE_SEEN_KEY, CommunityUpdateService, parseCommunityUpdates } from "../communityUpdateService";

const release = (revision: number) => ({ revision, title: `Update ${revision}`, publishedAt: "2026-09-30T12:00:00.000Z", changes: ["Browse music using your favorite tags."] });
const feed = (...revisions: number[]) => ({ schemaVersion: 1, releases: revisions.map(release) });
const respond = (value: unknown) => vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => value } as Response);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Community website update notices", () => {
  it("shows only the latest approved summary to a new reader and persists dismissal across app restarts", async () => {
    respond(feed(1, 2));
    const service = new CommunityUpdateService();
    const updates = await service.check();
    expect(updates.map((item) => item.revision)).toEqual([2]);
    expect(localStorage.getItem(COMMUNITY_UPDATE_SEEN_KEY)).toBeNull();
    service.dismiss(updates);
    expect(await new CommunityUpdateService().check()).toEqual([]);
    expect(fetch).toHaveBeenCalledWith("https://community.tagify.fm/api/v1/updates", expect.objectContaining({ credentials: "omit" }));
  });

  it("collects missed announcements even when the Tagify app version has not changed", async () => {
    localStorage.setItem(COMMUNITY_UPDATE_SEEN_KEY, "1");
    respond(feed(1, 3, 2));
    const service = new CommunityUpdateService();
    const updates = await service.check();
    expect(updates.map((item) => item.revision)).toEqual([3, 2]);
    service.dismiss(updates);
    expect(await service.check()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    respond(feed(4, 3));
    vi.advanceTimersByTime(COMMUNITY_UPDATE_INTERVAL_MS);
    expect((await service.check()).map((item) => item.revision)).toEqual([4]);
  });

  it("does not replay an older announcement after a website rollback", async () => {
    localStorage.setItem(COMMUNITY_UPDATE_SEEN_KEY, "4");
    respond(feed(2, 3));
    expect(await new CommunityUpdateService().check()).toEqual([]);
  });

  it("deduplicates overlapping checks", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done; }));
    const service = new CommunityUpdateService();
    const first = service.check();
    const second = service.check();
    resolve({ ok: true, json: async () => feed(1) } as Response);
    expect(await first).toEqual(await second);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for missing, offline, empty, and invalid feeds without marking anything seen", async () => {
    for (const response of [null, feed(), { schemaVersion: 2, releases: [] }, { schemaVersion: 1, releases: [{ ...release(1), changes: [] }] }]) {
      if (response === null) vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
      else respond(response);
      const service = new CommunityUpdateService();
      expect(await service.check()).toEqual([]);
      const requests = vi.mocked(fetch).mock.calls.length;
      expect(await service.check()).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(requests);
      expect(localStorage.getItem(COMMUNITY_UPDATE_SEEN_KEY)).toBeNull();
    }
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    expect(await new CommunityUpdateService().check()).toEqual([]);
  });

  it("retries after a failure and times out stalled requests", async () => {
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const service = new CommunityUpdateService();
    const pending = service.check();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual([]);
    respond(feed(1));
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(await service.check()).toEqual([release(1)]);
  });

  it("does not show future announcements or repeat notices when storage is blocked", async () => {
    respond({ schemaVersion: 1, releases: [release(1), { ...release(2), publishedAt: "2030-01-01T00:00:00Z" }] });
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const service = new CommunityUpdateService();
    const updates = await service.check();
    expect(updates).toEqual([release(1)]);
    service.dismiss(updates);
    expect(await service.check()).toEqual([]);
  });

  it("rejects duplicate revisions and oversized or malformed content", () => {
    for (const value of [feed(1, 1), { ...feed(1), schemaVersion: 2 }, { schemaVersion: 1, releases: [{ ...release(1), title: "x".repeat(121) }] }, { schemaVersion: 1, releases: [{ ...release(1), revision: -1 }] }]) {
      expect(() => parseCommunityUpdates(value)).toThrow();
    }
  });
});
