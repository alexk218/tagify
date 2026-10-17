import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDeviceLinkSecret } from "../SyncDeviceLinkIdentity";
import { captureDurableLocalState } from "../DurableAppState";
import { webcrypto } from "node:crypto";
import { syncPairingService, PENDING_PAIRING_STORAGE_KEY } from "../SyncPairingService";

const origin = "https://community.tagify.fm";
const installerSecret = `tgfy_install_${"a".repeat(43)}`;

describe("device linking identity", () => {
  beforeEach(() => { localStorage.clear(); delete window.__tagifyInstallRecoveryKey; });
  afterEach(() => { localStorage.clear(); delete window.__tagifyInstallRecoveryKey; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("reuses the installer proof so existing Mac connections can be recognized", () => {
    window.__tagifyInstallRecoveryKey = installerSecret;
    expect(getDeviceLinkSecret(origin)).toBe(installerSecret);
    expect(getDeviceLinkSecret(`${origin}/`)).toBe(installerSecret);
  });

  it("keeps one proof for a manual install across disconnects and account changes", () => {
    const first = getDeviceLinkSecret(origin);
    expect(first).toMatch(/^tgfy_link_[A-Za-z0-9_-]{43}$/);
    localStorage.setItem("tagify:sync:account-id", "another-account");
    expect(getDeviceLinkSecret(origin)).toBe(first);
    expect(JSON.stringify(captureDurableLocalState())).not.toContain(first);
  });

  it("does not share the Community proof with a different server", () => {
    window.__tagifyInstallRecoveryKey = installerSecret;
    const other = getDeviceLinkSecret("https://community.example");
    expect(other).not.toBe(installerSecret);
    expect(getDeviceLinkSecret("https://community.example")).toBe(other);
    expect(getDeviceLinkSecret("https://another.example")).not.toBe(other);
  });

  it("does not use a new unpersisted proof when storage is unavailable", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    expect(getDeviceLinkSecret(origin)).toBeNull();
  });

  it("replaces an invalid saved proof instead of transmitting it", () => {
    localStorage.setItem(`tagify:sync:device-link-secret:${origin}`, "broken");
    expect(getDeviceLinkSecret(origin)).toMatch(/^tgfy_link_[A-Za-z0-9_-]{43}$/);
  });

  it("sends the same proof when linking again and keeps it out of pending-code data", async () => {
    vi.stubGlobal("crypto", webcrypto);
    window.__tagifyInstallRecoveryKey = installerSecret;
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      deviceCode: "d".repeat(43), userCode: "ABCD-EFGH", verificationUri: `${origin}/settings/devices/authorize`, expiresIn: 600, interval: 10,
    }) });
    vi.stubGlobal("fetch", request);
    await syncPairingService.begin(origin, "Tagify on Mac", "MacIntel");
    syncPairingService.cancelPending();
    await syncPairingService.begin(origin, "Tagify on Mac", "MacIntel");
    for (const [, options] of request.mock.calls) expect(JSON.parse(options.body).installationSecret).toBe(installerSecret);
    expect(localStorage.getItem(PENDING_PAIRING_STORAGE_KEY)).not.toContain(installerSecret);
    expect(JSON.parse(request.mock.calls[0][1].body).verifierChallenge).not.toBe(JSON.parse(request.mock.calls[1][1].body).verifierChallenge);
  });
});
