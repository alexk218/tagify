// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_UPDATE_INTERVAL_MS, CommunityUpdateService, parseCommunityRewindYear, parseCommunityUpdates } from "../communityUpdateService";

const release = { revision: 1, title: "Update 1", publishedAt: "2026-09-30T12:00:00.000Z", changes: ["Browse music using your favorite tags."] };
const feed = (rewind?: unknown) => ({ schemaVersion: 1, releases: [release], ...(rewind === undefined ? {} : { rewind }) });
const respond = (value: unknown) => vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => value } as Response);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-10T12:00:00.000Z"));
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("whether Community says Rewind is open", () => {
  it("reads the year from the update feed every Tagify already fetches", async () => {
    respond(feed({ year: 2026, open: true }));
    const service = new CommunityUpdateService();
    expect(service.hasChecked()).toBe(false);
    expect(service.isRewindOpen(2026)).toBe(false);

    await service.check();
    expect(service.hasChecked()).toBe(true);
    expect(service.isRewindOpen(2026)).toBe(true);
    expect(service.isRewindOpen(2027)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://community.tagify.fm/api/v1/updates", expect.objectContaining({ credentials: "omit" }));
  });

  it.each([
    ["a feed without the field", undefined],
    ["a closed Rewind", { year: 2026, open: false }],
    ["a missing year", { open: true }],
    ["a year written as text", { year: "2026", open: true }],
    ["open written as text", { year: 2026, open: "true" }],
    ["nothing", null],
    ["a list", [2026]],
  ])("treats %s as not open, and still shows the update notices", async (_name, rewind) => {
    respond(feed(rewind));
    const service = new CommunityUpdateService();
    const updates = await service.check();
    expect(service.isRewindOpen(2026)).toBe(false);
    expect(updates.map((item) => item.revision)).toEqual([1]);
    expect(parseCommunityRewindYear(feed(rewind))).toBeNull();
  });

  it("keeps update notices exactly as they were when the field is present", () => {
    expect(parseCommunityUpdates(feed({ year: 2026, open: true }))).toEqual([release]);
  });

  it("stays closed when Community can't be reached, and follows the feed when it closes", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const service = new CommunityUpdateService();
    await service.check();
    expect(service.hasChecked()).toBe(true);
    expect(service.isRewindOpen(2026)).toBe(false);

    respond(feed({ year: 2026, open: true }));
    vi.advanceTimersByTime(COMMUNITY_UPDATE_INTERVAL_MS);
    await service.check();
    expect(service.isRewindOpen(2026)).toBe(true);

    respond(feed());
    vi.advanceTimersByTime(COMMUNITY_UPDATE_INTERVAL_MS);
    await service.check();
    expect(service.isRewindOpen(2026)).toBe(false);
  });
});
