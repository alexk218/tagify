import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { communityPairing } from "../communityPairing";
import { syncPairingService, type ApprovedPairing } from "@/services/sync/SyncPairingService";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

const configuration = {
  accountId: "account-b", libraryId: "library-b", deviceId: "device-b",
  apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "key", accessToken: "access", refreshToken: "refresh",
  expiresAt: Date.now() + 60_000,
};

let codes = 0;
function issueCodes() {
  // Each code lives 10 minutes and is checked every 10 seconds, like Community's.
  return vi.spyOn(syncPairingService, "begin").mockImplementation(async () => {
    codes += 1;
    const pending = {
      apiBaseUrl: configuration.apiBaseUrl, deviceCode: `device-${codes}`, verifier: "verifier",
      userCode: `CODE-${codes}`, verificationUri: `https://community.tagify.fm/device?code=CODE-${codes}`,
      expiresAt: Date.now() + 600_000, interval: 10,
    };
    localStorage.setItem("tagify:sync:pending-pairing", JSON.stringify(pending));
    return pending;
  });
}
const events = () => vi.mocked(recordProductInteraction).mock.calls.map(([event]) => event).filter((event) => event.startsWith("community_"));

beforeEach(() => {
  vi.useFakeTimers();
  communityPairing.reset();
  syncPairingService.cancelPending();
  localStorage.clear();
  codes = 0;
  vi.mocked(recordProductInteraction).mockClear();
  vi.spyOn(window, "open").mockReturnValue(null);
  window.TagifySync = { activateCurrentAccount: vi.fn().mockResolvedValue(undefined) } as unknown as NonNullable<typeof window.TagifySync>;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ authorization_pending: true, status: "authorization_pending" }), { status: 428 }));
});

afterEach(() => {
  communityPairing.reset();
  delete window.TagifySync;
  vi.useRealTimers();
  vi.restoreAllMocks();
  syncPairingService.cancelPending();
});

it("replaces an expired code while a waiting screen is open, without reopening the browser or counting a new start", async () => {
  const begin = issueCodes();
  const unwatch = communityPairing.watch();
  await communityPairing.start("prompt");
  expect(communityPairing.getState().pending?.userCode).toBe("CODE-1");
  expect(window.open).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(601_000);

  expect(begin).toHaveBeenCalledTimes(2);
  expect(communityPairing.getState().pending?.userCode).toBe("CODE-2");
  expect(communityPairing.getState().error).toBe("");
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(events()).toEqual(["community_connect_started"]);
  unwatch();
});

it("keeps checking after the waiting screen closes, and stops when the code expires", async () => {
  const begin = issueCodes();
  const poll = vi.spyOn(syncPairingService, "poll");
  const unwatch = communityPairing.watch();
  await communityPairing.start("prompt");
  unwatch();

  await vi.advanceTimersByTimeAsync(30_000);
  expect(poll).toHaveBeenCalledTimes(3);
  expect(communityPairing.getState().pending?.userCode).toBe("CODE-1");

  await vi.advanceTimersByTimeAsync(600_000);
  // Nobody is waiting on screen, so the expired code isn't replaced and checking stops.
  expect(begin).toHaveBeenCalledTimes(1);
  expect(communityPairing.getState().pending).toBeNull();
  const checks = poll.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(poll.mock.calls.length).toBe(checks);
  expect(events()).toEqual(["community_connect_started"]);
});

it("finishes connecting by itself when the member approves after closing the waiting screen", async () => {
  issueCodes();
  const unwatch = communityPairing.watch();
  await communityPairing.start("prompt");
  unwatch();

  const approval: ApprovedPairing = { configuration, relationship: "first-link", previousAccount: null };
  vi.spyOn(syncPairingService, "poll").mockResolvedValue({ status: "approved", approval });
  vi.spyOn(syncPairingService, "complete").mockImplementation(async (next) => {
    setDesktopSyncConfiguration(next.configuration);
    syncPairingService.cancelPending();
    return { configuration: next.configuration, requiresReload: false };
  });
  const connected = vi.fn();
  const stop = communityPairing.onConnected(connected);

  await vi.advanceTimersByTimeAsync(10_000);

  expect(connected).toHaveBeenCalledWith(expect.objectContaining({ entry: "prompt", requiresReload: false }));
  expect(window.TagifySync?.activateCurrentAccount).toHaveBeenCalledTimes(1);
  expect(events()).toEqual(["community_connect_started", "community_connect_completed"]);
  stop();
  setDesktopSyncConfiguration(null);
});

it("cancels a waiting code only when asked", async () => {
  issueCodes();
  await communityPairing.start("community");
  expect(syncPairingService.getPending()).not.toBeNull();
  communityPairing.cancel();
  expect(syncPairingService.getPending()).toBeNull();
  expect(communityPairing.getState().pending).toBeNull();
});
