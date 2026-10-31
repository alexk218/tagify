import { parseCatalogFillRunReport } from "@tagify/sync-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ runCatalogFillJobs: vi.fn(), runSongReleaseReports: vi.fn(), runArtistCreditReports: vi.fn() }));
vi.mock("../SyncLocalState", async (original) => ({ ...(await original<typeof import("../SyncLocalState")>()), getDesktopSyncConfiguration: () => configuration }));
vi.mock("../CommunityCatalogFillJobs", async (original) => ({ ...(await original<typeof import("../CommunityCatalogFillJobs")>()), runCatalogFillJobs: mocks.runCatalogFillJobs }));
vi.mock("../CommunitySongReleases", async (original) => ({ ...(await original<typeof import("../CommunitySongReleases")>()), runSongReleaseReports: mocks.runSongReleaseReports }));
vi.mock("../CommunityArtistCredits", async (original) => ({ ...(await original<typeof import("../CommunityArtistCredits")>()), runArtistCreditReports: mocks.runArtistCreditReports }));
import { syncRuntime } from "../SyncRuntime";

type RuntimeFixture = {
  started: boolean;
  capabilities: Record<string, unknown> | null;
  catalogFill: Promise<void> | null;
  handleCatalogFill: (value: typeof configuration) => void;
  handleSongReleases: (value: typeof configuration) => void;
  handleArtistCredits: (value: typeof configuration) => void;
  stop: () => void;
};

const HOURS = 60 * 60_000;
const readers = { catalogFill: { protocolVersion: 1 }, songReleases: { protocolVersion: 1 }, artistCredits: { protocolVersion: 1 } };
const runLog = { catalogFillRuns: { path: "/api/v2/sync/catalog-fill-runs", protocolVersion: 1 } };

describe("the catalog filler run log", () => {
  let runtime: RuntimeFixture;
  let fetchMock: ReturnType<typeof vi.fn<[string, RequestInit?], Promise<Response>>>;
  const sent = () => fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/api/v2/sync/catalog-fill-runs"))
    .map(([, init]) => parseCatalogFillRunReport(JSON.parse(String((init as RequestInit).body))).run);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-28T08:00:00.000Z"));
    mocks.runCatalogFillJobs.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    mocks.runSongReleaseReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    mocks.runArtistCreditReports.mockReset().mockResolvedValue({ sent: 0, reads: 0 });
    fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ recorded: true, filler: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
    runtime.capabilities = { ...readers, ...runLog };
  });
  afterEach(() => { runtime.stop(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("sends one summary per run: start first, then schedule, with the reader's counts and stop reason", async () => {
    let finish!: () => void;
    mocks.runCatalogFillJobs
      .mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ sent: 4, reads: 12 }); }))
      .mockResolvedValueOnce({ sent: 1, reads: 3, stopped: "budget" });
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3 * HOURS);
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(0);

    expect(sent()).toEqual([
      { job: "catalogFill", trigger: "start", startedAt: "2026-10-28T08:00:00.000Z", finishedAt: "2026-10-28T08:05:00.000Z", reads: 12, sent: 4, stopped: "done" },
      { job: "catalogFill", trigger: "schedule", startedAt: "2026-10-28T11:05:00.000Z", finishedAt: "2026-10-28T11:05:00.000Z", reads: 3, sent: 1, stopped: "budget" },
    ]);
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" } });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ protocolVersion: 1, deviceId: configuration.deviceId });
  });

  it("counts each job's first run as its start, and records a reader that failed as an error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.runSongReleaseReports.mockRejectedValueOnce(new Error("boom"));
    mocks.runArtistCreditReports.mockResolvedValueOnce({ sent: 2, reads: 5, stopped: "spotify" });
    runtime.handleSongReleases(configuration);
    await vi.advanceTimersByTimeAsync(0);
    runtime.handleArtistCredits(configuration);
    await vi.advanceTimersByTimeAsync(0);
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(0);

    expect(sent().map(({ job, trigger, reads, sent: items, stopped }) => ({ job, trigger, reads, sent: items, stopped }))).toEqual([
      { job: "songReleases", trigger: "start", reads: 0, sent: 0, stopped: "error" },
      { job: "artistCredits", trigger: "start", reads: 5, sent: 2, stopped: "spotify" },
      { job: "catalogFill", trigger: "start", reads: 0, sent: 0, stopped: "done" },
    ]);
  });

  it("stops sending once Community says this desktop isn't a filler, or has no route", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ recorded: false, filler: false }), { status: 200 }));
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(3 * HOURS);
    runtime.handleSongReleases(configuration);
    await vi.advanceTimersByTimeAsync(3 * HOURS);
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runCatalogFillJobs).toHaveBeenCalledTimes(2);
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);

    const other = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    other.started = true;
    other.capabilities = { ...readers, ...runLog };
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    other.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(3 * HOURS);
    other.handleSongReleases(configuration);
    await vi.advanceTimersByTimeAsync(0);
    other.stop();
    expect(sent()).toHaveLength(2);
  });

  it("sends nothing when Community doesn't advertise the run log", async () => {
    for (const catalogFillRuns of [undefined, { path: "/api/v2/sync/catalog-fill-runs", protocolVersion: 2 }, { path: "https://elsewhere.example/x", protocolVersion: 1 }]) {
      runtime.capabilities = { ...readers, catalogFillRuns };
      runtime.handleCatalogFill(configuration);
      await vi.advanceTimersByTimeAsync(3 * HOURS);
    }
    expect(mocks.runCatalogFillJobs).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never holds up or breaks a reader when the summary can't be sent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { answer = resolve; }));
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(0);
    // The summary is still waiting on Community, yet the reader's slot is free for the next reader.
    expect(runtime.catalogFill).toBeNull();
    runtime.handleSongReleases(configuration);
    expect(mocks.runSongReleaseReports).toHaveBeenCalledTimes(1);
    answer(new Response("", { status: 500 }));
    await vi.advanceTimersByTimeAsync(0);

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(3 * HOURS);
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(3 * HOURS);
    runtime.handleCatalogFill(configuration);
    await vi.advanceTimersByTimeAsync(0);
    // Failures other than "not a filler" keep sending, and warn only once.
    expect(mocks.runCatalogFillJobs).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("run summary"))).toHaveLength(1);
  });
});
