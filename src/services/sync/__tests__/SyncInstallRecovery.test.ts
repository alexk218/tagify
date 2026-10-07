import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enrollDesktopRecovery,
  restoreDesktopSyncConfiguration,
} from "../SyncInstallRecovery";
import {
  getDesktopSyncConfiguration,
  getTagifyDatabaseName,
  setDesktopSyncConfiguration,
  type DesktopSyncConfiguration,
} from "../SyncLocalState";

const recoverySecret = `tgfy_install_${"a".repeat(43)}`;
const spotifyAccessToken = "spotify-access-token-for-current-user";
const recoveryAccessToken = `header.${btoa(JSON.stringify({ sub: "account-a" })).replace(/=+$/, "")}.signature`;
const configuration: DesktopSyncConfiguration = {
  accountId: "account-a",
  libraryId: "library-a",
  deviceId: "device-a",
  apiBaseUrl: "https://community.tagify.fm",
  supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "publishable-key",
  accessToken: recoveryAccessToken,
  refreshToken: "refresh-token",
  expiresAt: 1_800_000_000,
};

describe("Spotify update Community recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.__tagifyInstallRecoveryPromise;
    window.__tagifyInstallRecoveryKey = recoverySecret;
    vi.spyOn(
      Spicetify.Platform.AuthorizationAPI,
      "getState",
    ).mockReturnValue({
      token: { accessToken: spotifyAccessToken },
    } as ReturnType<typeof Spicetify.Platform.AuthorizationAPI.getState>);
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("restores the approved account before opening its local database", async () => {
    expect(getDesktopSyncConfiguration()).toBeNull();
    expect(getTagifyDatabaseName()).toBe("tagify-db");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ status: "recovered", ...configuration }),
      )
      .mockResolvedValueOnce(
        Response.json({
          enrolled: true,
          methods: { installation: true, spotify: true },
        }),
      );

    const recovered = await restoreDesktopSyncConfiguration();

    expect(recovered).toEqual(configuration);
    expect(getDesktopSyncConfiguration()).toEqual(configuration);
    expect(getTagifyDatabaseName()).toBe("tagify-db:account-a");
    expect(fetch).toHaveBeenCalledWith(
      "https://community.tagify.fm/api/v2/device-recovery/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("restores an existing manual install through the still-signed-in Spotify account", async () => {
    delete window.__tagifyInstallRecoveryKey;
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ status: "recovered", ...configuration }),
      )
      .mockResolvedValueOnce(
        Response.json({
          enrolled: true,
          methods: { installation: false, spotify: true },
        }),
      );

    await expect(restoreDesktopSyncConfiguration()).resolves.toEqual(
      configuration,
    );

    const [, init] = request.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ spotifyAccessToken });
    expect(body).not.toHaveProperty("recoverySecret");
    expect(getTagifyDatabaseName()).toBe("tagify-db:account-a");
  });

  it("leaves a revoked installation disconnected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: { code: "invalid_grant" } }, { status: 401 }),
    );

    await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
    expect(getDesktopSyncConfiguration()).toBeNull();
    expect(getTagifyDatabaseName()).toBe("tagify-db");
  });

  it("enrolls the installer proof without putting it in the saved configuration", async () => {
    setDesktopSyncConfiguration(configuration);
    const request = vi.fn().mockResolvedValue(
      Response.json({
        enrolled: true,
        methods: { installation: true, spotify: true },
      }),
    );

    await expect(
      enrollDesktopRecovery(configuration, request),
    ).resolves.toBe(true);

    const [, init] = request.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      deviceId: configuration.deviceId,
      recoverySecret,
      spotifyAccessToken,
    });
    expect(JSON.stringify(getDesktopSyncConfiguration())).not.toContain(
      recoverySecret,
    );
  });

  it("enrolls an already connected user without an installer proof", async () => {
    delete window.__tagifyInstallRecoveryKey;
    setDesktopSyncConfiguration(configuration);
    const request = vi.fn().mockResolvedValue(
      Response.json({
        enrolled: true,
        methods: { installation: false, spotify: true },
      }),
    );

    await expect(
      enrollDesktopRecovery(configuration, request),
    ).resolves.toBe(true);

    const [, init] = request.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      deviceId: configuration.deviceId,
      spotifyAccessToken,
    });
  });

  it("waits for normal sync to refresh an expired Community token before enrollment", async () => {
    const expired = { ...configuration, expiresAt: Math.floor(Date.now() / 1_000) - 1 };
    setDesktopSyncConfiguration(expired);
    const request = vi.fn();

    await expect(enrollDesktopRecovery(expired, request)).resolves.toBe(false);

    expect(request).not.toHaveBeenCalled();
  });

  it("uses the refreshed token if sync updated the same device during startup", async () => {
    const refreshed = { ...configuration, accessToken: "refreshed-community-token" };
    setDesktopSyncConfiguration(refreshed);
    const request = vi.fn().mockResolvedValue(
      Response.json({ enrolled: true, methods: { spotify: true } }),
    );

    await expect(enrollDesktopRecovery({ ...configuration, accessToken: "old-token" }, request)).resolves.toBe(true);

    const [, init] = request.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer refreshed-community-token");
  });

  it("automatically upgrades an existing connected user on startup", async () => {
    delete window.__tagifyInstallRecoveryKey;
    setDesktopSyncConfiguration(configuration);
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        enrolled: true,
        methods: { installation: false, spotify: true },
      }),
    );

    await expect(restoreDesktopSyncConfiguration()).resolves.toEqual(
      configuration,
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    const [, init] = request.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      deviceId: configuration.deviceId,
      spotifyAccessToken,
    });
  });

  it("does not attempt automatic recovery without either live proof", async () => {
    delete window.__tagifyInstallRecoveryKey;
    vi.mocked(
      Spicetify.Platform.AuthorizationAPI.getState,
    ).mockReturnValue({ token: { accessToken: "" } } as ReturnType<
      typeof Spicetify.Platform.AuthorizationAPI.getState
    >);
    const request = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();

    const recovery = restoreDesktopSyncConfiguration();
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(recovery).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
