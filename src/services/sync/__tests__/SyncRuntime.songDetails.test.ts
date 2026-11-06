import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ runSongDetailReports: vi.fn(), runArtistCreditReports: vi.fn() }));
vi.mock("../SyncLocalState", async (original) => ({ ...(await original<typeof import("../SyncLocalState")>()), getDesktopSyncConfiguration: () => configuration }));
vi.mock("../CommunitySongDetails", async (original) => ({ ...(await original<typeof import("../CommunitySongDetails")>()), runSongDetailReports: mocks.runSongDetailReports }));
vi.mock("../CommunityArtistCredits", async (original) => ({ ...(await original<typeof import("../CommunityArtistCredits")>()), runArtistCreditReports: mocks.runArtistCreditReports }));
import { syncRuntime } from "../SyncRuntime";

type RuntimeFixture = {
  started: boolean;
  capabilities: Record<string, unknown> | null;
  handleSongDetails: (value: typeof configuration) => void;
  handleArtistCredits: (value: typeof configuration) => void;
  stop: () => void;
};

describe("sending Community songs' lengths and release dates", () => {
  let runtime: RuntimeFixture;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-05T18:00:00.000Z"));
    mocks.runSongDetailReports.mockReset().mockResolvedValue({ sent: 0 });
    mocks.runArtistCreditReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
  });
  afterEach(() => { runtime.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("runs once a start, then at most every three hours, and stops asking a Community without the route", async () => {
    runtime.handleSongDetails(configuration);
    runtime.handleSongDetails(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSongDetailReports).toHaveBeenCalledTimes(1);

    runtime.handleSongDetails(configuration);
    expect(mocks.runSongDetailReports).toHaveBeenCalledTimes(1);
    mocks.runSongDetailReports.mockResolvedValueOnce({ sent: 0, stopped: "unsupported" });
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    runtime.handleSongDetails(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSongDetailReports).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    runtime.handleSongDetails(configuration);
    expect(mocks.runSongDetailReports).toHaveBeenCalledTimes(2);
  });

  it("tries again after a few hours when Community was unreachable or paused", async () => {
    mocks.runSongDetailReports.mockResolvedValueOnce({ sent: 0, stopped: "network" }).mockResolvedValueOnce({ sent: 0, stopped: "paused" });
    runtime.handleSongDetails(configuration);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    runtime.handleSongDetails(configuration);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    runtime.handleSongDetails(configuration);
    expect(mocks.runSongDetailReports).toHaveBeenCalledTimes(3);
  });

  it("reads no Spotify, so it runs beside the Spotify readers", () => {
    runtime.capabilities = { artistCredits: { protocolVersion: 1 } };
    mocks.runArtistCreditReports.mockReturnValueOnce(new Promise(() => {}));
    runtime.handleArtistCredits(configuration);
    runtime.handleSongDetails(configuration);
    expect(mocks.runSongDetailReports).toHaveBeenCalledTimes(1);
  });

  it("does nothing once sync has stopped", () => {
    runtime.started = false;
    runtime.handleSongDetails(configuration);
    expect(mocks.runSongDetailReports).not.toHaveBeenCalled();
  });
});
