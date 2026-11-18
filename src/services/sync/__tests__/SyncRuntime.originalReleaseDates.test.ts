import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ runOriginalReleaseDates: vi.fn(), database: { name: "tagify-account-a" } }));
vi.mock("../SyncLocalState", async (original) => ({
  ...(await original<typeof import("../SyncLocalState")>()),
  getDesktopSyncConfiguration: () => configuration,
  getTagifyDatabaseName: () => mocks.database.name,
}));
vi.mock("../CommunityOriginalReleaseDates", async (original) => ({
  ...(await original<typeof import("../CommunityOriginalReleaseDates")>()), runOriginalReleaseDates: mocks.runOriginalReleaseDates,
}));
import { syncRuntime } from "../SyncRuntime";

type RuntimeFixture = {
  started: boolean;
  capabilities: Record<string, unknown> | null;
  handleOriginalReleaseDates: (value: typeof configuration) => void;
  stop: () => void;
};

const HOUR = 60 * 60_000;
const newRuntime = () => {
  const runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
  runtime.started = true;
  runtime.capabilities = { originalReleaseDates: { path: "/api/v2/sync/original-release-dates", protocolVersion: 1, pageSize: 500 } };
  return runtime;
};

describe("reading songs' original release dates from Community", () => {
  let runtime: RuntimeFixture;
  let updates: string[];
  const noteUpdate = (event: Event) => updates.push((event as CustomEvent<{ type: string }>).detail.type);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-16T18:00:00.000Z"));
    localStorage.clear();
    mocks.database.name = "tagify-account-a";
    mocks.runOriginalReleaseDates.mockReset().mockResolvedValue({ pages: 1, saved: 0 });
    updates = [];
    window.addEventListener("tagify:dataUpdated", noteUpdate);
    runtime = newRuntime();
  });
  afterEach(() => { window.removeEventListener("tagify:dataUpdated", noteUpdate); runtime.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("runs about once a day per library, also across restarts", async () => {
    runtime.handleOriginalReleaseDates(configuration);
    runtime.handleOriginalReleaseDates(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runOriginalReleaseDates).toHaveBeenCalledTimes(1);

    // Tagify restarts a few hours later: still today's run.
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    runtime.stop();
    runtime = newRuntime();
    runtime.handleOriginalReleaseDates(configuration);
    expect(mocks.runOriginalReleaseDates).toHaveBeenCalledTimes(1);

    // Another account's library has its own day.
    mocks.database.name = "tagify-account-b";
    runtime.handleOriginalReleaseDates(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runOriginalReleaseDates).toHaveBeenCalledTimes(2);

    mocks.database.name = "tagify-account-a";
    await vi.advanceTimersByTimeAsync(19 * HOUR);
    runtime.handleOriginalReleaseDates(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runOriginalReleaseDates).toHaveBeenCalledTimes(3);
  });

  it("tries again a few hours later when Community couldn't be reached, and leaves a Community without the route alone", async () => {
    mocks.runOriginalReleaseDates.mockResolvedValueOnce({ pages: 0, saved: 0, stopped: "network" });
    runtime.handleOriginalReleaseDates(configuration);
    await vi.advanceTimersByTimeAsync(HOUR);
    runtime.handleOriginalReleaseDates(configuration);
    expect(mocks.runOriginalReleaseDates).toHaveBeenCalledTimes(1);

    mocks.runOriginalReleaseDates.mockResolvedValueOnce({ pages: 0, saved: 0, stopped: "unsupported" });
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    runtime.handleOriginalReleaseDates(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runOriginalReleaseDates).toHaveBeenCalledTimes(2);

    localStorage.clear();
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    runtime.handleOriginalReleaseDates(configuration);
    expect(mocks.runOriginalReleaseDates).toHaveBeenCalledTimes(2);
  });

  it("shows saved dates in Tagify only when a run changed some", async () => {
    runtime.handleOriginalReleaseDates(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toEqual([]);

    localStorage.clear();
    mocks.runOriginalReleaseDates.mockResolvedValueOnce({ pages: 2, saved: 12 });
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    runtime.handleOriginalReleaseDates(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(updates).toEqual(["songDetails"]);
  });

  it("does nothing once sync has stopped", () => {
    runtime.started = false;
    runtime.handleOriginalReleaseDates(configuration);
    expect(mocks.runOriginalReleaseDates).not.toHaveBeenCalled();
  });

  it("asks only a Community that advertises original release dates", () => {
    runtime.capabilities = null;
    runtime.handleOriginalReleaseDates(configuration);
    runtime.capabilities = { songNames: { protocolVersion: 1 } };
    runtime.handleOriginalReleaseDates(configuration);
    runtime.capabilities = { originalReleaseDates: { protocolVersion: 2 } };
    runtime.handleOriginalReleaseDates(configuration);
    expect(mocks.runOriginalReleaseDates).not.toHaveBeenCalled();
  });
});
