import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogFillPace } from "../CommunityCatalogFill";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ runSongReleaseReports: vi.fn(), runArtistCreditReports: vi.fn() }));
vi.mock("../SyncLocalState", async (original) => ({ ...(await original<typeof import("../SyncLocalState")>()), getDesktopSyncConfiguration: () => configuration }));
vi.mock("../CommunitySongReleases", async (original) => ({ ...(await original<typeof import("../CommunitySongReleases")>()), runSongReleaseReports: mocks.runSongReleaseReports }));
vi.mock("../CommunityArtistCredits", async (original) => ({ ...(await original<typeof import("../CommunityArtistCredits")>()), runArtistCreditReports: mocks.runArtistCreditReports }));
import { syncRuntime } from "../SyncRuntime";

type RuntimeFixture = {
  started: boolean;
  capabilities: Record<string, unknown> | null;
  handleBackgroundReaders: (value: typeof configuration) => void;
  stop: () => void;
};

const HOURS = 60 * 60_000;
const readers = { catalogFill: { protocolVersion: 1 }, songReleases: { protocolVersion: 1 }, artistCredits: { protocolVersion: 1 } };
const fast = { preset: "fast", readIntervalMs: 1_000, hourlyReads: 900, dailyReads: 6_000 };

describe("the background Spotify readers' schedule", () => {
  let runtime: RuntimeFixture;
  let jobsPage: { filler: boolean; pace: typeof fast | null; items: never[]; hasMore: boolean };
  let fetchMock: ReturnType<typeof vi.fn<[string, RequestInit?], Promise<Response>>>;
  const jobRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/v2/sync/catalog-fill?")).length;
  const hide = () => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-29T00:53:00.000Z"));
    localStorage.clear();
    jobsPage = { filler: true, pace: fast, items: [], hasMore: false };
    // Community's catalog fill jobs (the real run, with no jobs to read) and nothing else.
    fetchMock = vi.fn(async (url: string) => String(url).includes("/api/v2/sync/catalog-fill?")
      ? new Response(JSON.stringify(jobsPage), { status: 200 })
      : new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.runArtistCreditReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    mocks.runSongReleaseReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
    runtime.capabilities = { ...readers };
  });
  afterEach(() => {
    runtime.stop();
    Reflect.deleteProperty(document, "visibilityState");
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks Community for the pace first, so a filler's first reader already keeps it", async () => {
    const paceAtFirstRead: string[] = [];
    mocks.runArtistCreditReports.mockImplementation(async () => { paceAtFirstRead.push(catalogFillPace().preset); return { sent: 0, reads: 0 }; });
    runtime.handleBackgroundReaders(configuration);
    expect(mocks.runArtistCreditReports).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);

    expect(jobRequests()).toBe(1);
    expect(paceAtFirstRead).toEqual(["fast"]);
    // A filler runs the readers back to back, without waiting for more pulls.
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
  });

  it("keeps a filler's readers running at their intervals while Spotify is hidden, with no pulls", async () => {
    hide();
    runtime.handleBackgroundReaders(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect([jobRequests(), mocks.runArtistCreditReports.mock.calls.length, mocks.runSongReleaseReports.mock.calls.length]).toEqual([1, 1, 1]);

    await vi.advanceTimersByTimeAsync(3 * HOURS - 1);
    expect(jobRequests()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect([jobRequests(), mocks.runArtistCreditReports.mock.calls.length, mocks.runSongReleaseReports.mock.calls.length]).toEqual([2, 2, 2]);
    await vi.advanceTimersByTimeAsync(5 * HOURS);
    expect([jobRequests(), mocks.runArtistCreditReports.mock.calls.length, mocks.runSongReleaseReports.mock.calls.length]).toEqual([3, 3, 3]);
  });

  it("stops a filler's schedule when sync stops", async () => {
    hide();
    runtime.handleBackgroundReaders(configuration);
    await vi.advanceTimersByTimeAsync(0);
    runtime.stop();
    await vi.advanceTimersByTimeAsync(12 * HOURS);
    expect(jobRequests()).toBe(1);
    expect(mocks.runArtistCreditReports).toHaveBeenCalledTimes(1);
  });

  it("leaves other desktops reading one reader per pull, and nothing between pulls", async () => {
    jobsPage = { filler: false, pace: null, items: [], hasMore: false };
    hide();
    runtime.handleBackgroundReaders(configuration);
    await vi.advanceTimersByTimeAsync(0);
    // Community's answer hands over to the reader that pull would have run anyway, and no more.
    expect(mocks.runArtistCreditReports).toHaveBeenCalledTimes(1);
    expect(mocks.runSongReleaseReports).not.toHaveBeenCalled();
    expect(catalogFillPace().preset).toBe("conservative");

    await vi.advanceTimersByTimeAsync(12 * HOURS);
    expect([jobRequests(), mocks.runArtistCreditReports.mock.calls.length, mocks.runSongReleaseReports.mock.calls.length]).toEqual([1, 1, 0]);
    // The next pull runs one reader, as before.
    runtime.handleBackgroundReaders(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect([jobRequests(), mocks.runArtistCreditReports.mock.calls.length, mocks.runSongReleaseReports.mock.calls.length]).toEqual([1, 2, 0]);
    runtime.handleBackgroundReaders(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect([jobRequests(), mocks.runArtistCreditReports.mock.calls.length, mocks.runSongReleaseReports.mock.calls.length]).toEqual([1, 2, 1]);
  });

  it("keeps today's order when Community doesn't offer catalog fill", async () => {
    runtime.capabilities = { songReleases: { protocolVersion: 1 }, artistCredits: { protocolVersion: 1 } };
    runtime.handleBackgroundReaders(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(jobRequests()).toBe(0);
    expect(mocks.runArtistCreditReports).toHaveBeenCalledTimes(1);
    expect(mocks.runSongReleaseReports).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(12 * HOURS);
    expect(mocks.runSongReleaseReports).not.toHaveBeenCalled();
  });
});
