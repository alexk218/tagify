import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  songReleases: Promise<void> | null;
  artistCredits: Promise<void> | null;
  songReleasesSoon: boolean;
  handleSongReleases: (value: typeof configuration) => void;
  handleArtistCredits: (value: typeof configuration) => void;
  stop: () => void;
};

describe("sending Community songs' albums", () => {
  let runtime: RuntimeFixture;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-20T18:00:00.000Z"));
    mocks.runSongReleaseReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    mocks.runArtistCreditReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
  });
  afterEach(() => { runtime.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("does nothing when Community doesn't offer it, so older Community servers are unaffected", () => {
    runtime.capabilities = { artistCredits: { protocolVersion: 1 } };
    runtime.handleSongReleases(configuration);
    runtime.capabilities = { songReleases: { protocolVersion: 2 } };
    runtime.handleSongReleases(configuration);
    runtime.capabilities = null;
    runtime.handleSongReleases(configuration);
    expect(mocks.runSongReleaseReports).not.toHaveBeenCalled();
  });

  it("runs once a start, then at most every three hours, and stops asking a Community without the route", async () => {
    runtime.capabilities = { songReleases: { path: "/api/v2/sync/song-releases", protocolVersion: 1, maxNeeded: 500, maxReportItems: 200 } };
    runtime.handleSongReleases(configuration);
    runtime.handleSongReleases(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);

    runtime.handleSongReleases(configuration);
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
    mocks.runSongReleaseReports.mockResolvedValueOnce({ sent: 0, reads: 0, stopped: "unsupported" });
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    runtime.handleSongReleases(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    runtime.handleSongReleases(configuration);
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(2);
  });

  it("never reads Spotify for albums and artists at the same time", async () => {
    runtime.capabilities = { songReleases: { protocolVersion: 1 }, artistCredits: { protocolVersion: 1 } };
    let finishArtists!: () => void;
    mocks.runArtistCreditReports.mockReturnValueOnce(new Promise((resolve) => { finishArtists = () => resolve({ sent: 0, reads: 0 }); }));
    runtime.handleArtistCredits(configuration);
    runtime.handleSongReleases(configuration);
    expect(mocks.runSongReleaseReports).not.toHaveBeenCalled();

    finishArtists();
    await vi.advanceTimersByTimeAsync(0);
    runtime.handleSongReleases(configuration);
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
  });

  describe("after sync sends music", () => {
    const offered = { songReleases: { protocolVersion: 1 } };
    const sentMusic = () => { runtime.songReleasesSoon = true; runtime.handleSongReleases(configuration); };

    it("reads the new songs' albums within two minutes instead of waiting three hours, so Community can group their versions", async () => {
      runtime.capabilities = offered;
      runtime.handleSongReleases(configuration);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);

      // A song tagged half a minute after the start's run waits out the rest of the two minutes.
      await vi.advanceTimersByTimeAsync(30_000);
      sentMusic();
      sentMusic();
      await vi.advanceTimersByTimeAsync(89_000);
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(2);

      // Nothing new sent: the next run waits for the usual three hours.
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(2);
    });

    it("starts right away when the last run was more than two minutes ago", async () => {
      runtime.capabilities = offered;
      runtime.handleSongReleases(configuration);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      sentMusic();
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(2);
    });

    it("waits for another Spotify reader to finish, then reads without another sync", async () => {
      runtime.capabilities = { ...offered, artistCredits: { protocolVersion: 1 } };
      let finishArtists!: () => void;
      mocks.runArtistCreditReports.mockReturnValueOnce(new Promise((resolve) => { finishArtists = () => resolve({ sent: 0, reads: 0 }); }));
      runtime.handleArtistCredits(configuration);
      sentMusic();
      expect(mocks.runSongReleaseReports).not.toHaveBeenCalled();

      finishArtists();
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
    });

    it("reads music sent during a run in the next one", async () => {
      runtime.capabilities = offered;
      let finish!: () => void;
      mocks.runSongReleaseReports.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ sent: 1, reads: 1 }); }));
      sentMusic();
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
      sentMusic();
      finish();
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(2);
    });

    it("stops its pending run when sync stops", async () => {
      runtime.capabilities = offered;
      runtime.handleSongReleases(configuration);
      await vi.advanceTimersByTimeAsync(0);
      sentMusic();
      runtime.stop();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
    });

    it("does nothing for a Community without the route", async () => {
      runtime.capabilities = null;
      sentMusic();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(mocks.runSongReleaseReports).not.toHaveBeenCalled();
    });
  });
});
