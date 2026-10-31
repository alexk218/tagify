import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ runCatalogFillJobs: vi.fn(), runSongReleaseReports: vi.fn() }));
vi.mock("../SyncLocalState", async (original) => ({ ...(await original<typeof import("../SyncLocalState")>()), getDesktopSyncConfiguration: () => configuration }));
vi.mock("../CommunityCatalogFillJobs", async (original) => ({ ...(await original<typeof import("../CommunityCatalogFillJobs")>()), runCatalogFillJobs: mocks.runCatalogFillJobs }));
vi.mock("../CommunitySongReleases", async (original) => ({ ...(await original<typeof import("../CommunitySongReleases")>()), runSongReleaseReports: mocks.runSongReleaseReports }));
import { syncRuntime } from "../SyncRuntime";

type RuntimeFixture = {
  started: boolean;
  capabilities: Record<string, unknown> | null;
  handleCatalogFill: (value: typeof configuration) => void;
  handleSongReleases: (value: typeof configuration) => void;
  stop: () => void;
};

describe("filling Community's track lists and discographies", () => {
  let runtime: RuntimeFixture;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-28T08:00:00.000Z"));
    mocks.runCatalogFillJobs.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    mocks.runSongReleaseReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
  });
  afterEach(() => { runtime.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("does nothing when Community doesn't offer it, as today's production doesn't", () => {
    runtime.capabilities = { songReleases: { protocolVersion: 1 }, artistCredits: { protocolVersion: 1 } };
    runtime.handleCatalogFill(configuration);
    runtime.capabilities = { catalogFill: { protocolVersion: 2 } };
    runtime.handleCatalogFill(configuration);
    runtime.capabilities = null;
    runtime.handleCatalogFill(configuration);
    expect(mocks.runCatalogFillJobs).not.toHaveBeenCalled();
  });

  it("runs once a start, then at most every three hours, and stops asking a Community without the route", async () => {
    runtime.capabilities = { catalogFill: { path: "/api/v2/sync/catalog-fill", protocolVersion: 1, maxJobs: 50, maxReportItems: 20 } };
    mocks.runCatalogFillJobs.mockResolvedValueOnce({ sent: 0, reads: 0, stopped: "unsupported" });
    runtime.handleCatalogFill(configuration);
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    runtime.handleCatalogFill(configuration);
    expect(mocks.runCatalogFillJobs).toHaveBeenCalledTimes(1);
  });

  it("never reads Spotify beside the song releases run", async () => {
    runtime.capabilities = { catalogFill: { protocolVersion: 1 }, songReleases: { protocolVersion: 1 } };
    let finish!: () => void;
    mocks.runCatalogFillJobs.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ sent: 0, reads: 0 }); }));
    runtime.handleCatalogFill(configuration);
    runtime.handleSongReleases(configuration);
    expect(mocks.runSongReleaseReports).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    runtime.handleSongReleases(configuration);
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
  });
});
