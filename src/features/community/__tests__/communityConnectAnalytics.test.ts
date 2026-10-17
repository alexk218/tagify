import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import {
  recordCommunityConnectCompleted,
  recordCommunityConnectFinishFailed,
  recordCommunityConnectPromptShown,
  recordCommunityConnectStarted,
} from "../communityConnectAnalytics";
import { getDesktopSyncConnectionState, setDesktopSyncConfiguration, setDisconnectedSyncProvenance } from "@/services/sync/SyncLocalState";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

const ACCOUNT_A = "a".repeat(64);
const ACCOUNT_B = "b".repeat(64);
const recorded = () => vi.mocked(recordProductInteraction).mock.calls;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(recordProductInteraction).mockClear();
  recordCommunityConnectCompleted("community", "first-link");
  vi.mocked(recordProductInteraction).mockClear();
});

describe("Community connection measurements", () => {
  it("reports the invitation at most once a day for each account", () => {
    recordCommunityConnectPromptShown(ACCOUNT_A, new Date("2026-10-17T08:00:00Z"));
    recordCommunityConnectPromptShown(ACCOUNT_A, new Date("2026-10-17T20:00:00Z"));
    recordCommunityConnectPromptShown(ACCOUNT_B, new Date("2026-10-17T20:00:00Z"));
    recordCommunityConnectPromptShown(ACCOUNT_A, new Date("2026-10-18T08:00:00Z"));
    expect(recorded()).toEqual([["community_connect_prompt_shown"], ["community_connect_prompt_shown"], ["community_connect_prompt_shown"]]);
  });

  it("credits a connection finished in a later session to the screen where it started", () => {
    recordCommunityConnectStarted("prompt");
    recordCommunityConnectCompleted("sync", "account-switch");
    recordCommunityConnectCompleted("sync", "reconnect");
    expect(recorded()).toEqual([
      ["community_connect_started", { entry: "prompt" }],
      ["community_connect_completed", { entry: "prompt", relationship: "account_switch" }],
      ["community_connect_completed", { entry: "sync", relationship: "reconnect" }],
    ]);
  });

  it("reports repeated approval-check failures once for each attempt", () => {
    recordCommunityConnectStarted("community");
    recordCommunityConnectFinishFailed("sync");
    recordCommunityConnectFinishFailed("sync");
    recordCommunityConnectStarted("community");
    recordCommunityConnectFinishFailed("community");
    expect(recorded().filter(([event]) => event === "community_connect_failed")).toEqual([
      ["community_connect_failed", { entry: "community", stage: "finish" }],
      ["community_connect_failed", { entry: "community", stage: "finish" }],
    ]);
  });

  it("reports a failure once for an attempt started before measurements existed", () => {
    recordCommunityConnectFinishFailed("sync");
    recordCommunityConnectFinishFailed("sync");
    expect(recorded()).toEqual([["community_connect_failed", { entry: "sync", stage: "finish" }]]);
  });

  it("describes whether this device syncs, disconnected or never connected", () => {
    expect(getDesktopSyncConnectionState()).toBe("not_connected");
    setDisconnectedSyncProvenance({ accountId: "account-a", libraryId: "library-a", disconnectedAt: "2026-10-01T00:00:00Z" });
    expect(getDesktopSyncConnectionState()).toBe("disconnected");
    setDesktopSyncConfiguration({
      accountId: "account-a", libraryId: "library-a", deviceId: "device-a", apiBaseUrl: "https://community.tagify.fm",
      supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key", accessToken: "access", refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
    });
    expect(getDesktopSyncConnectionState()).toBe("connected");
  });
});
