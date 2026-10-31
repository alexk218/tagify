import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ runSongNameReports: vi.fn(), runArtistCreditReports: vi.fn() }));
vi.mock("../SyncLocalState", async (original) => ({ ...(await original<typeof import("../SyncLocalState")>()), getDesktopSyncConfiguration: () => configuration }));
vi.mock("../CommunitySongNames", async (original) => ({ ...(await original<typeof import("../CommunitySongNames")>()), runSongNameReports: mocks.runSongNameReports }));
vi.mock("../CommunityArtistCredits", async (original) => ({ ...(await original<typeof import("../CommunityArtistCredits")>()), runArtistCreditReports: mocks.runArtistCreditReports }));
import { syncRuntime } from "../SyncRuntime";

type RuntimeFixture = {
  started: boolean;
  capabilities: Record<string, unknown> | null;
  songNamesWanted: boolean;
  songNamesHeld: boolean;
  handleSongNames: (value: typeof configuration) => void;
  handleArtistCredits: (value: typeof configuration) => void;
  stop: () => void;
};

describe("sending Community the names of synced music", () => {
  let runtime: RuntimeFixture;
  const sentMusic = () => { runtime.songNamesWanted = true; runtime.handleSongNames(configuration); };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-20T18:00:00.000Z"));
    mocks.runSongNameReports.mockReset().mockResolvedValue({ sent: 0 });
    mocks.runArtistCreditReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
  });
  afterEach(() => { runtime.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("does nothing when Community doesn't offer it, so older Community servers are unaffected", () => {
    runtime.capabilities = { songReleases: { protocolVersion: 1 } };
    runtime.handleSongNames(configuration);
    runtime.capabilities = { songNames: { protocolVersion: 2 } };
    runtime.handleSongNames(configuration);
    runtime.capabilities = null;
    runtime.handleSongNames(configuration);
    expect(mocks.runSongNameReports).not.toHaveBeenCalled();
  });

  it("runs once a start, then only after sync sent music, at most every ten minutes and one run at a time", async () => {
    runtime.capabilities = { songNames: { protocolVersion: 1 } };
    let finish!: () => void;
    mocks.runSongNameReports.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ sent: 3 }); }));
    runtime.handleSongNames(configuration);
    runtime.handleSongNames(configuration);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(1);

    // Music sent during the run waits for it, then for the interval, without needing another sync.
    sentMusic();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(2);

    // Nothing new was sent: later syncs don't ask Community again.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    runtime.handleSongNames(configuration);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(2);

    sentMusic();
    sentMusic();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(3);
  });

  it("waits while sync is still sending, then names everything it sent in one run", async () => {
    runtime.capabilities = { songNames: { protocolVersion: 1 } };
    runtime.songNamesHeld = true;
    sentMusic();
    sentMusic();
    expect(mocks.runSongNameReports).not.toHaveBeenCalled();
    runtime.songNamesHeld = false;
    runtime.handleSongNames(configuration);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(1);
  });

  it("doesn't wait for Spotify readers, since it reads only Tagify's saved library", () => {
    runtime.capabilities = { songNames: { protocolVersion: 1 }, artistCredits: { protocolVersion: 1 } };
    mocks.runArtistCreditReports.mockReturnValueOnce(new Promise(() => {}));
    runtime.handleArtistCredits(configuration);
    runtime.handleSongNames(configuration);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(1);
  });

  it("stops asking a Community without the route, and tries again later after a network failure", async () => {
    runtime.capabilities = { songNames: { protocolVersion: 1 } };
    mocks.runSongNameReports.mockResolvedValueOnce({ sent: 0, stopped: "network" });
    runtime.handleSongNames(configuration);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(2);

    mocks.runSongNameReports.mockResolvedValueOnce({ sent: 0, stopped: "unsupported" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    sentMusic();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    sentMusic();
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(3);
  });

  it("stops its pending run when sync stops", async () => {
    runtime.capabilities = { songNames: { protocolVersion: 1 } };
    runtime.handleSongNames(configuration);
    await vi.advanceTimersByTimeAsync(0);
    sentMusic();
    runtime.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mocks.runSongNameReports).toHaveBeenCalledTimes(1);
  });
});
