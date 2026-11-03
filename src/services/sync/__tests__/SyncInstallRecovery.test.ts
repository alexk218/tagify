import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENROLLMENT_BACKOFF,
  enrollDesktopRecovery,
  RECOVERY_ENROLLMENT_PREFIX,
  RECOVERY_RETRY_KEY,
  RECOVERY_UNAVAILABLE_SKIP_MS,
  RECOVERY_UNAVAILABLE_UNTIL_KEY,
  askToReconnectAgain,
  dismissReconnection,
  getReconnectionState,
  RECONNECTION_EVENT,
  restoreDesktopSyncConfiguration,
} from "../SyncInstallRecovery";
import { syncPairingService } from "../SyncPairingService";
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
const TOKEN_URL = "https://community.tagify.fm/api/v2/device-recovery/token";
const APPROVAL_URL = "https://community.tagify.fm/api/v2/device-authorizations/token";

/** What a later Spotify start sees: a new page with the same local storage. */
function newSpotifyStart() {
  clearTimeout(window.__tagifyReconnection?.timer);
  delete window.__tagifyReconnection;
  delete window.__tagifyInstallRecoveryRejected;
  delete window.__tagifyInstallRecoveryPromise;
  delete window.__tagifyRecoveryEnrollments;
}

function sentBody(request: { mock: { calls: unknown[][] } }, call = 0) {
  return JSON.parse(String((request.mock.calls[call][1] as RequestInit).body));
}

describe("Spotify update Community recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    newSpotifyStart();
    window.__tagifyInstallRecoveryKey = recoverySecret;
    Spicetify.Platform.username = "test-user";
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

  afterEach(() => {
    vi.useRealTimers();
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
      TOKEN_URL,
      expect.objectContaining({ method: "POST" }),
    );
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

    expect(sentBody(request)).toEqual({
      deviceId: configuration.deviceId,
      recoverySecret,
      spotifyAccessToken,
    });
    expect(JSON.stringify(getDesktopSyncConfiguration())).not.toContain(
      recoverySecret,
    );
    // The saved record tells proofs apart without holding them.
    const saved = Object.keys(localStorage).filter((key) => key.startsWith(RECOVERY_ENROLLMENT_PREFIX)).map((key) => localStorage.getItem(key)).join();
    expect(saved).not.toContain(recoverySecret);
    expect(saved).not.toContain("test-user");
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

    expect(sentBody(request)).toEqual({
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
    // Nothing failed, so the enrollment after the refresh goes out at once.
    const refreshed = { ...configuration, accessToken: "refreshed-community-token" };
    setDesktopSyncConfiguration(refreshed);
    request.mockResolvedValue(Response.json({ enrolled: true, methods: { installation: true, spotify: true } }));
    await expect(enrollDesktopRecovery(refreshed, request)).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("waits until a session about to expire has been refreshed", async () => {
    const expiring = { ...configuration, expiresAt: Math.floor(Date.now() / 1_000) + 4 * 60 };
    setDesktopSyncConfiguration(expiring);
    const request = vi.fn();

    await expect(enrollDesktopRecovery(expiring, request)).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the refreshed token if sync updated the same device during startup", async () => {
    const refreshed = { ...configuration, accessToken: "refreshed-community-token" };
    setDesktopSyncConfiguration(refreshed);
    const request = vi.fn().mockResolvedValue(
      Response.json({ enrolled: true, methods: { installation: true, spotify: true } }),
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

    expect(sentBody(request)).toMatchObject({
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
  });

  describe("when Community can't answer a reconnection", () => {
    beforeEach(() => {
      delete window.__tagifyInstallRecoveryKey;
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      vi.spyOn(Math, "random").mockReturnValue(0);
    });

    const busy = (status: number, retryAfter?: string) => () => new Response(JSON.stringify({ error: { code: "spotify_unavailable" } }), {
      status,
      headers: { "content-type": "application/json", ...(retryAfter ? { "retry-after": retryAfter } : {}) },
    });

    it.each([
      ["503", 503],
      ["429", 429],
    ])("waits out Retry-After after a %s, across starts and openings of Tagify", async (_label, status) => {
      const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => busy(status, "600")());

      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(1);

      // Opening Tagify, and later starts, ask nothing until the wait is over.
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      vi.setSystemTime(Date.now() + 599_000);
      newSpotifyStart();
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 1_000);
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
      // A Community that is only busy never counts as "nothing to recover".
      expect(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY)).toBeNull();
    });

    it("skips the wait for Spotify's sign-in while it waits", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => busy(503, "600")());
      await restoreDesktopSyncConfiguration();
      vi.mocked(Spicetify.Platform.AuthorizationAPI.getState).mockReturnValue({ token: { accessToken: "" } } as ReturnType<typeof Spicetify.Platform.AuthorizationAPI.getState>);

      let settled = false;
      void restoreDesktopSyncConfiguration().then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
    });

    it.each([
      ["a Community error without a time", () => Response.json({ error: { code: "sync_unavailable" } }, { status: 500 })],
      ["a rejected request", () => Response.json({ error: { code: "invalid_request" } }, { status: 400 })],
      ["a network failure", () => { throw new TypeError("Failed to fetch"); }],
    ])("backs off from a minute, doubling, after %s", async (_label, response) => {
      const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());

      await restoreDesktopSyncConfiguration();
      await restoreDesktopSyncConfiguration();
      expect(request).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 60_000);
      await restoreDesktopSyncConfiguration();
      expect(request).toHaveBeenCalledTimes(2);

      // The second failure in a row waits two minutes.
      vi.setSystemTime(Date.now() + 119_000);
      await restoreDesktopSyncConfiguration();
      expect(request).toHaveBeenCalledTimes(2);
      vi.setSystemTime(Date.now() + 1_000);
      await restoreDesktopSyncConfiguration();
      expect(request).toHaveBeenCalledTimes(3);
      expect(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY)).toBeNull();
    });

    it("reconnects once Community answers again, and forgets the wait", async () => {
      const request = vi.spyOn(globalThis, "fetch")
        .mockImplementationOnce(async () => busy(503, "60")())
        .mockResolvedValueOnce(Response.json({ status: "recovered", ...configuration }))
        .mockResolvedValue(Response.json({ enrolled: true, methods: { installation: false, spotify: true } }));

      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      vi.setSystemTime(Date.now() + 60_000);
      await expect(restoreDesktopSyncConfiguration()).resolves.toEqual(configuration);

      expect(request.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(2);
      expect(localStorage.getItem(RECOVERY_RETRY_KEY)).toBeNull();
    });

    it("never waits longer than six hours, even when a moved clock says so", async () => {
      localStorage.setItem(RECOVERY_RETRY_KEY, JSON.stringify({ until: Date.now() + 7 * 60 * 60_000, failures: 1 }));
      const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => busy(503, "600")());

      await restoreDesktopSyncConfiguration();
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe("installations with nothing to recover", () => {
    const rejected = () => Response.json({ error: { code: "invalid_grant", message: "This Tagify installation is not approved for automatic reconnection" } }, { status: 401 });

    beforeEach(() => {
      delete window.__tagifyInstallRecoveryKey;
    });

    it("skips the check on later starts for a week after Community finds no approved device", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => rejected());

      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
      expect(Number(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY))).toBe(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS);

      // No request and no wait for Spotify's token on the next start.
      newSpotifyStart();
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS);
      newSpotifyStart();
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
    });

    it("checks an installer recovery proof once per start", async () => {
      window.__tagifyInstallRecoveryKey = recoverySecret;
      const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => rejected());

      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      // Opening Tagify during the same start asks nothing more.
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(1);

      newSpotifyStart();
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
      expect(sentBody(request, 1)).toMatchObject({ recoverySecret });
    });

    it("always checks an installer recovery proof on a new start", async () => {
      localStorage.setItem(RECOVERY_UNAVAILABLE_UNTIL_KEY, String(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS));
      window.__tagifyInstallRecoveryKey = recoverySecret;
      const request = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json({ status: "recovered", ...configuration }))
        .mockResolvedValueOnce(Response.json({ enrolled: true, methods: { installation: true, spotify: true } }));

      await expect(restoreDesktopSyncConfiguration()).resolves.toEqual(configuration);

      expect(request).toHaveBeenCalledWith(TOKEN_URL, expect.objectContaining({ method: "POST" }));
      expect(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY)).toBeNull();
    });

    it("checks again on the next start after the user starts linking", async () => {
      localStorage.setItem(RECOVERY_UNAVAILABLE_UNTIL_KEY, String(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS));
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({
        deviceCode: "device-code", userCode: "ABCD-EFGH", verificationUri: "https://community.tagify.fm/link", expiresIn: 600, interval: 5,
      }));

      await syncPairingService.begin("https://community.tagify.fm", "Tagify on Mac", "MacIntel");

      expect(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY)).toBeNull();
      syncPairingService.cancelPending();
    });
  });

  describe("enrollment", () => {
    const saved = (methods: { installation: boolean; spotify: boolean }) => Response.json({ enrolled: true, methods });

    beforeEach(() => {
      setDesktopSyncConfiguration(configuration);
      vi.spyOn(Math, "random").mockReturnValue(0);
    });

    it("sends nothing once Community holds this device's proofs, on every later start and refresh", async () => {
      const request = vi.fn().mockImplementation(async () => saved({ installation: true, spotify: true }));

      await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(true);
      for (let start = 0; start < 5; start++) {
        newSpotifyStart();
        await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(true);
      }
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("sends only what changed: another Spotify account, or a new installer proof", async () => {
      const request = vi.fn().mockImplementation(async () => saved({ installation: true, spotify: true }));
      await enrollDesktopRecovery(configuration, request);

      Spicetify.Platform.username = "another-spotify-user";
      await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(true);
      expect(sentBody(request, 1)).toEqual({ deviceId: configuration.deviceId, spotifyAccessToken });

      window.__tagifyInstallRecoveryKey = `tgfy_install_${"b".repeat(43)}`;
      await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(true);
      expect(sentBody(request, 2)).toEqual({ deviceId: configuration.deviceId, recoverySecret: `tgfy_install_${"b".repeat(43)}` });
      expect(request).toHaveBeenCalledTimes(3);
    });

    it("enrolls a newly linked device even when this computer enrolled another before", async () => {
      const request = vi.fn().mockImplementation(async () => saved({ installation: true, spotify: true }));
      await enrollDesktopRecovery(configuration, request);
      const relinked = { ...configuration, deviceId: "device-b" };
      setDesktopSyncConfiguration(relinked);

      await expect(enrollDesktopRecovery(relinked, request)).resolves.toBe(true);
      expect(sentBody(request, 1)).toEqual({ deviceId: "device-b", recoverySecret, spotifyAccessToken });
    });

    it("keeps enrollments an earlier Tagify confirmed", async () => {
      localStorage.setItem(`tagify:sync:account-recovery-v2:${configuration.deviceId}`, String(Date.now() - 60_000));
      const request = vi.fn();

      await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(true);
      expect(request).not.toHaveBeenCalled();
    });

    it("waits out Retry-After and backs off while Spotify can't confirm the account", async () => {
      delete window.__tagifyInstallRecoveryKey;
      vi.useFakeTimers();
      vi.setSystemTime(1_790_000_000_000);
      const request = vi.fn().mockImplementation(async () => Response.json(
        { error: { code: "spotify_unavailable" } },
        { status: 503, headers: { "retry-after": "600" } },
      ));

      await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(false);
      // Starts and hourly session refreshes during the wait send nothing.
      for (let minute = 10; minute < 60; minute += 10) {
        vi.setSystemTime(Date.now() + 10 * 60_000);
        newSpotifyStart();
        await enrollDesktopRecovery(configuration, request);
      }
      expect(request).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 10 * 60_000);
      await enrollDesktopRecovery(configuration, request);
      expect(request).toHaveBeenCalledTimes(2);
      // A second failure in a row waits two hours.
      vi.setSystemTime(Date.now() + ENROLLMENT_BACKOFF.baseMs * 2 - 1);
      await enrollDesktopRecovery(configuration, request);
      expect(request).toHaveBeenCalledTimes(2);
      vi.setSystemTime(Date.now() + 1);
      await enrollDesktopRecovery(configuration, request);
      expect(request).toHaveBeenCalledTimes(3);
    });

    it("keeps the saved installer proof and later sends only the Spotify account", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_790_000_000_000);
      const request = vi.fn()
        .mockImplementationOnce(async () => saved({ installation: true, spotify: false }))
        .mockImplementation(async () => saved({ installation: false, spotify: true }));

      await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(false);
      newSpotifyStart();
      await enrollDesktopRecovery(configuration, request);
      expect(request).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + ENROLLMENT_BACKOFF.baseMs);
      await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(true);
      expect(sentBody(request, 1)).toEqual({ deviceId: configuration.deviceId, spotifyAccessToken });
    });

    it("doesn't count a Spotify session that isn't ready yet as a failure", async () => {
      delete window.__tagifyInstallRecoveryKey;
      // Real setImmediate lets the account digest finish between timer steps.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.mocked(Spicetify.Platform.AuthorizationAPI.getState).mockReturnValue({ token: { accessToken: "" } } as ReturnType<typeof Spicetify.Platform.AuthorizationAPI.getState>);
      const request = vi.fn().mockImplementation(async () => saved({ installation: false, spotify: true }));

      let first: boolean | undefined;
      void enrollDesktopRecovery(configuration, request).then((value) => { first = value; });
      for (let step = 0; step < 100 && first === undefined; step++) {
        await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(first).toBe(false);
      expect(request).not.toHaveBeenCalled();

      vi.mocked(Spicetify.Platform.AuthorizationAPI.getState).mockReturnValue({ token: { accessToken: spotifyAccessToken } } as ReturnType<typeof Spicetify.Platform.AuthorizationAPI.getState>);
      await expect(enrollDesktopRecovery(configuration, request)).resolves.toBe(true);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("shares one request between Tagify's page and background", async () => {
      let answer!: (response: Response) => void;
      const request = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));

      const first = enrollDesktopRecovery(configuration, request);
      const second = enrollDesktopRecovery(configuration, request);
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      answer(saved({ installation: true, spotify: true }));

      await expect(first).resolves.toBe(true);
      await expect(second).resolves.toBe(true);
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconnection the member approves on Community", () => {
    const deviceCode = "d".repeat(43);
    const approvalPage = "https://tagify.fm/settings/devices/reconnect";
    const approvalRequired = (overrides: Record<string, unknown> = {}) => Response.json({
      status: "approval_required",
      deviceCode,
      userCode: "BCDF-GHJK",
      verificationUri: approvalPage,
      verificationUriComplete: `${approvalPage}?code=BCDF-GHJK`,
      expiresIn: 600,
      interval: 10,
      ...overrides,
    }, { status: 202 });
    const pending = () => Response.json({ status: "authorization_pending", interval: 10 }, { status: 428 });
    const approved = () => Response.json({ status: "approved", ...configuration, tokenType: "bearer" });
    const approvalChecks = (request: { mock: { calls: unknown[][] } }) => request.mock.calls.filter(([url]) => url === APPROVAL_URL);
    let completeReconnection: ReturnType<typeof vi.fn<[DesktopSyncConfiguration], Promise<{ configuration: DesktopSyncConfiguration; requiresReload: boolean }>>>;

    beforeEach(() => {
      delete window.__tagifyInstallRecoveryKey;
      vi.useFakeTimers();
      vi.setSystemTime(1_800_000_000_000);
      vi.spyOn(Math, "random").mockReturnValue(0);
      completeReconnection = vi.fn(async (next: DesktopSyncConfiguration) => {
        setDesktopSyncConfiguration(next);
        return { configuration: next, requiresReload: false };
      });
      window.TagifySync = { completeReconnection } as unknown as typeof window.TagifySync;
    });

    afterEach(() => {
      newSpotifyStart();
      delete window.TagifySync;
    });

    it("asks with a verifier challenge, shows the code, and never connects on a Spotify sign-in alone", async () => {
      const events: unknown[] = [];
      const listener = (event: Event) => events.push((event as CustomEvent).detail);
      window.addEventListener(RECONNECTION_EVENT, listener);
      const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(approvalRequired());

      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      window.removeEventListener(RECONNECTION_EVENT, listener);

      const body = sentBody(request);
      expect(body).toMatchObject({ spotifyAccessToken });
      expect(body.verifierChallenge).toMatch(/^[a-f0-9]{64}$/);
      expect(body).not.toHaveProperty("verifier");
      expect(getDesktopSyncConfiguration()).toBeNull();
      expect(getTagifyDatabaseName()).toBe("tagify-db");
      const waiting = { status: "waiting", userCode: "BCDF-GHJK", approvalUrl: `${approvalPage}?code=BCDF-GHJK`, expiresAt: Date.now() + 600_000 };
      expect(getReconnectionState()).toEqual(waiting);
      expect(events).toEqual([waiting]);
      // Waiting for the member is not "nothing to recover", and nothing about it is stored.
      expect(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY)).toBeNull();
      expect(JSON.stringify({ ...localStorage })).not.toContain(deviceCode);
    });

    it("waits for the member's approval, then connects with the verifier only this desktop holds", async () => {
      const request = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(approved());
      await restoreDesktopSyncConfiguration();
      const challenge = sentBody(request).verifierChallenge;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(approvalChecks(request)).toHaveLength(1);
      expect(getReconnectionState()?.status).toBe("waiting");
      expect(completeReconnection).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(approvalChecks(request)).toHaveLength(2);
      const check = JSON.parse(String((approvalChecks(request)[1][1] as RequestInit).body));
      expect(check.deviceCode).toBe(deviceCode);
      expect(check.verifier.length).toBeGreaterThanOrEqual(43);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(check.verifier));
      expect(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")).toBe(challenge);

      expect(completeReconnection).toHaveBeenCalledWith(configuration);
      expect(getDesktopSyncConfiguration()).toEqual(configuration);
      expect(getReconnectionState()).toBeNull();

      // Nothing more is asked once connected.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(request).toHaveBeenCalledTimes(3);
    });

    it("saves the approved connection for the next start when sync isn't running", async () => {
      delete window.TagifySync;
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockResolvedValueOnce(approved())
        .mockResolvedValue(Response.json({ enrolled: true, methods: { installation: false, spotify: true } }));
      await restoreDesktopSyncConfiguration();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(getDesktopSyncConfiguration()).toEqual(configuration);
      expect(getReconnectionState()).toBeNull();
    });

    it("stops when the member says it wasn't them, and doesn't ask on starts for a week", async () => {
      const request = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockResolvedValueOnce(Response.json({ error: { code: "invalid_grant" } }, { status: 400 }));
      await restoreDesktopSyncConfiguration();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(getReconnectionState()).toEqual({ status: "declined" });
      expect(getDesktopSyncConfiguration()).toBeNull();
      expect(completeReconnection).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600_000);
      expect(request).toHaveBeenCalledTimes(2);
      // Opening Tagify during this start, and the next start, ask nothing.
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      newSpotifyStart();
      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
      expect(Number(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY))).toBe(1_800_000_010_000 + RECOVERY_UNAVAILABLE_SKIP_MS);
    });

    it.each([
      ["Community says it expired", () => Response.json({ error: { code: "expired_token" } }, { status: 410 })],
      ["nobody approves it within ten minutes", pending],
    ])("ends as expired when %s, and asks again only on the next start", async (_label, answer) => {
      const request = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockImplementation(async () => answer());
      await restoreDesktopSyncConfiguration();

      await vi.advanceTimersByTimeAsync(600_000);
      expect(getReconnectionState()).toEqual({ status: "expired" });
      const checks = approvalChecks(request).length;
      expect(checks).toBeLessThanOrEqual(60);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(approvalChecks(request)).toHaveLength(checks);

      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      expect(request.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(1);
      expect(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY)).toBeNull();

      newSpotifyStart();
      request.mockResolvedValueOnce(approvalRequired());
      await restoreDesktopSyncConfiguration();
      expect(request.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(2);
    });

    it("slows down when Community asks, and keeps waiting through a moment offline", async () => {
      const request = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockResolvedValueOnce(Response.json({ status: "slow_down", interval: 20 }, { status: 429, headers: { "retry-after": "20" } }))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(approved());
      await restoreDesktopSyncConfiguration();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(approvalChecks(request)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(19_000);
      expect(approvalChecks(request)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(approvalChecks(request)).toHaveLength(2);
      expect(getReconnectionState()?.status).toBe("waiting");

      await vi.advanceTimersByTimeAsync(20_000);
      expect(completeReconnection).toHaveBeenCalledWith(configuration);
    });

    it("waits out Community's limit on requests, never reading it as nothing to recover", async () => {
      const limited = () => Response.json({ error: { code: "rate_limited" } }, { status: 429, headers: { "retry-after": "3600" } });
      const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => limited());

      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();
      // A start shows nothing; the person can still link from Cloud Sync.
      expect(getReconnectionState()).toBeNull();
      expect(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY)).toBeNull();

      vi.setSystemTime(Date.now() + 3_599_000);
      newSpotifyStart();
      await restoreDesktopSyncConfiguration();
      expect(request).toHaveBeenCalledTimes(1);

      // Asking again by hand says when it can work, without asking Community.
      await askToReconnectAgain();
      expect(getReconnectionState()).toEqual({ status: "rate-limited", retryAt: 1_800_003_600_000 });
      expect(request).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 1_000);
      newSpotifyStart();
      await restoreDesktopSyncConfiguration();
      expect(request).toHaveBeenCalledTimes(2);
    });

    it("shows the limit when a request the person asked for is refused", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockResolvedValueOnce(Response.json({ error: { code: "invalid_grant" } }, { status: 400 }))
        .mockResolvedValueOnce(Response.json({ error: { code: "rate_limited" } }, { status: 429, headers: { "retry-after": "3600" } }));
      await restoreDesktopSyncConfiguration();
      await vi.advanceTimersByTimeAsync(10_000);

      await askToReconnectAgain();

      expect(getReconnectionState()).toEqual({ status: "rate-limited", retryAt: Date.now() + 3_600_000 });
    });

    it("asks again when the person chooses to after a declined request", async () => {
      const request = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockResolvedValueOnce(Response.json({ error: { code: "invalid_grant" } }, { status: 400 }))
        .mockResolvedValueOnce(approvalRequired({ userCode: "LMNP-QRST", verificationUriComplete: `${approvalPage}?code=LMNP-QRST` }));
      await restoreDesktopSyncConfiguration();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(getReconnectionState()?.status).toBe("declined");

      await askToReconnectAgain();

      expect(request.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(2);
      expect(getReconnectionState()).toMatchObject({ status: "waiting", userCode: "LMNP-QRST" });
      expect(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY)).toBeNull();
    });

    it("tells the person when this computer can't reconnect this way", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockResolvedValueOnce(Response.json({ error: { code: "expired_token" } }, { status: 410 }))
        .mockResolvedValueOnce(Response.json({ error: { code: "invalid_grant" } }, { status: 401 }));
      await restoreDesktopSyncConfiguration();
      await vi.advanceTimersByTimeAsync(10_000);

      await askToReconnectAgain();

      expect(getReconnectionState()).toEqual({ status: "unavailable" });
      dismissReconnection();
      expect(getReconnectionState()).toBeNull();
    });

    it("treats an old-style refusal as approve-on-the-website, never a connection", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({
        error: { code: "invalid_grant", message: "Approve this computer on Tagify Community", details: { approval: "website" } },
      }, { status: 401 }));

      await expect(restoreDesktopSyncConfiguration()).resolves.toBeNull();

      expect(getDesktopSyncConfiguration()).toBeNull();
      expect(getReconnectionState()).toBeNull();
      expect(Number(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY))).toBe(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS);
    });

    it("sends one request while the member is approving, however often Tagify opens", async () => {
      const request = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockImplementation(async () => pending());
      await restoreDesktopSyncConfiguration();

      await restoreDesktopSyncConfiguration();
      await askToReconnectAgain();

      expect(request.mock.calls.filter(([url]) => url === TOKEN_URL)).toHaveLength(1);
    });

    it("stops checking once the person links this computer from Cloud Sync instead", async () => {
      const request = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(approvalRequired())
        .mockImplementation(async () => pending());
      await restoreDesktopSyncConfiguration();
      setDesktopSyncConfiguration(configuration);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(approvalChecks(request)).toHaveLength(0);
      expect(getReconnectionState()).toBeNull();
    });

    it.each([
      ["an approval page outside Community", { verificationUri: "https://example.com/approve", verificationUriComplete: "https://example.com/approve?code=BCDF-GHJK" }],
      ["no device code", { deviceCode: undefined }],
    ])("backs off from an answer with %s", async (_label, overrides) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(approvalRequired(overrides));

      await restoreDesktopSyncConfiguration();

      expect(getReconnectionState()).toBeNull();
      expect(JSON.parse(localStorage.getItem(RECOVERY_RETRY_KEY) || "null")).toMatchObject({ failures: 1 });
    });

    it("keeps an installer proof reconnecting straight away, and asks with Spotify only when it can't", async () => {
      window.__tagifyInstallRecoveryKey = recoverySecret;
      const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(approvalRequired());

      await restoreDesktopSyncConfiguration();

      expect(sentBody(request)).toMatchObject({ recoverySecret, spotifyAccessToken, verifierChallenge: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(getReconnectionState()?.status).toBe("waiting");
    });
  });
});
