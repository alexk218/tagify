import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDesktopSyncConfiguration, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { hydrateSyncProfile } from "../communityDevice";

const configuration: DesktopSyncConfiguration = {
  accountId: "account-a",
  libraryId: "library-a",
  deviceId: "device-a",
  apiBaseUrl: "https://community.tagify.fm",
  supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "publishable-key",
  accessToken: "token-a",
  refreshToken: "refresh-a",
  expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
};
const profile = { id: "profile-a", handle: "alex", displayName: "Alex" };

describe("saving the Community handle on this device's connection", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    setDesktopSyncConfiguration(null);
    vi.restoreAllMocks();
  });

  it("never sends a session about to expire; sync refreshes it and the next opening asks", async () => {
    // Before: the stored token went out as it was, and an expired one came back 401.
    const expiring = { ...configuration, expiresAt: Math.floor(Date.now() / 1_000) + 60 };
    setDesktopSyncConfiguration(expiring);
    const request = vi.spyOn(globalThis, "fetch");

    await expect(hydrateSyncProfile(expiring)).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the session sync refreshed since the view opened, with only the authorization header", async () => {
    setDesktopSyncConfiguration({ ...configuration, accessToken: "token-b", refreshToken: "refresh-b" });
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ profile }));

    const next = await hydrateSyncProfile(configuration);

    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://community.tagify.fm/api/v2/device/profile");
    // This route's CORS allows authorization only; sync's x-tagify headers would be refused.
    expect(init.headers).toEqual({ authorization: "Bearer token-b" });
    expect(next).toMatchObject({ accessToken: "token-b", refreshToken: "refresh-b", profile });
    expect(getDesktopSyncConfiguration()).toMatchObject({ accessToken: "token-b", profile });
  });

  it("keeps a session sync refreshed while the request was out", async () => {
    setDesktopSyncConfiguration(configuration);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      setDesktopSyncConfiguration({ ...configuration, accessToken: "token-c", refreshToken: "refresh-c" });
      return Response.json({ profile });
    });

    await hydrateSyncProfile(configuration);
    expect(getDesktopSyncConfiguration()).toMatchObject({ accessToken: "token-c", refreshToken: "refresh-c", profile });
  });

  it("never writes the handle onto a different device's connection", async () => {
    setDesktopSyncConfiguration(configuration);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      setDesktopSyncConfiguration({ ...configuration, deviceId: "device-b" });
      return Response.json({ profile });
    });

    await expect(hydrateSyncProfile(configuration)).resolves.toBeNull();
    expect(getDesktopSyncConfiguration()?.profile).toBeUndefined();
  });
});
