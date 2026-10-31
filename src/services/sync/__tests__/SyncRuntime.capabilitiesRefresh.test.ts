import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { DesktopSyncConfiguration } from "../SyncLocalState";
import { capabilitiesCacheKey, syncRuntime } from "../SyncRuntime";

const configuration = { apiBaseUrl: "https://community.example" } as DesktopSyncConfiguration;
const HOUR_MS = 60 * 60_000;

type CapabilityRuntime = {
  capabilities: unknown;
  capabilitiesFetchedAt: number;
  currentCapabilities(configuration: DesktopSyncConfiguration): Promise<Record<string, unknown>>;
};
const runtime = syncRuntime as unknown as CapabilityRuntime;

const before = { protocolVersion: 2, supportedProtocolVersions: [1, 2] };
const after = { ...before, catalogFillRuns: { path: "/api/v2/sync/catalog-fill-runs", protocolVersion: 1 } };

describe("Community capability refresh", () => {
  let fetchMock: Mock<unknown[], Promise<Response>>;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z"), toFake: ["Date"] });
    localStorage.clear();
    runtime.capabilities = null;
    runtime.capabilitiesFetchedAt = 0;
    fetchMock = vi.fn(async (): Promise<Response> => Response.json(after));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    runtime.capabilities = null;
    runtime.capabilitiesFetchedAt = 0;
  });

  it("asks Community past Spotify's browser cache", async () => {
    await expect(runtime.currentCapabilities(configuration)).resolves.toEqual(after);
    expect(fetchMock).toHaveBeenCalledWith("https://community.example/api/v2/sync/capabilities", expect.objectContaining({ cache: "no-cache" }));
  });

  it("uses a saved list under an hour old, and asks again once it is older", async () => {
    const key = capabilitiesCacheKey(configuration.apiBaseUrl);
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now() - HOUR_MS + 60_000, value: before }));
    await expect(runtime.currentCapabilities(configuration)).resolves.toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();

    runtime.capabilities = null;
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now() - HOUR_MS - 1, value: before }));
    await expect(runtime.currentCapabilities(configuration)).resolves.toEqual(after);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("picks up what a release adds within the hour while Tagify stays open", async () => {
    fetchMock.mockImplementationOnce(async () => Response.json(before));
    await expect(runtime.currentCapabilities(configuration)).resolves.toEqual(before);

    vi.setSystemTime(Date.now() + HOUR_MS - 1);
    await expect(runtime.currentCapabilities(configuration)).resolves.toEqual(before);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    await expect(runtime.currentCapabilities(configuration)).resolves.toEqual(after);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the list it has when a refresh fails, and fails only without one", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("offline"); });
    await expect(runtime.currentCapabilities(configuration)).rejects.toThrow("offline");

    runtime.capabilities = before;
    runtime.capabilitiesFetchedAt = Date.now() - HOUR_MS;
    await expect(runtime.currentCapabilities(configuration)).resolves.toEqual(before);
  });
});
