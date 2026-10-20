import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { GENERAL_INVITE_PREVIEW, GENERAL_INVITE_URL, resolveInviteLink } from "../inviteLink";

// Community answers CORS for /api/v2/device/profile with its external API headers
// (packages/tagify-community/lib/http.ts). Spotify refuses a request that sends any other header.
const PROFILE_ROUTE_ALLOWED_HEADERS = ["authorization", "content-type", "if-none-match"];

function connect(expiresInSeconds = 3600) {
  setDesktopSyncConfiguration({
    accountId: "account-a", libraryId: "library-a", deviceId: "device-a",
    apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key",
    accessToken: "access", refreshToken: "refresh", expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds,
    profile: { handle: "alex", displayName: "Alex" },
  });
}

function profileHeaders(request: { mock: { calls: Parameters<typeof fetch>[] } }) {
  const calls = request.mock.calls.filter(([input]) => String(input) === "https://community.tagify.fm/api/v2/device/profile");
  expect(calls).toHaveLength(1);
  return calls[0][1]?.headers as Record<string, string>;
}

describe("resolveInviteLink", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    setDesktopSyncConfiguration(null);
    vi.restoreAllMocks();
  });

  it("offers tagify.fm and Community setup when this computer isn't connected", async () => {
    const request = vi.fn();
    expect(await resolveInviteLink(request)).toEqual({ kind: "general", url: GENERAL_INVITE_URL, preview: GENERAL_INVITE_PREVIEW, nameStep: "connect" });
    expect(request).not.toHaveBeenCalled();
  });

  it("shares the member's personal invite when Community says it opens for other people", async () => {
    connect();
    const request = vi.fn().mockResolvedValue({ profile: { handle: "alex", invitable: true } });
    expect(await resolveInviteLink(request)).toEqual({
      kind: "personal",
      url: "https://community.tagify.fm/join/alex",
      preview: "https://community.tagify.fm/join/alex/opengraph-image",
    });
    expect(request).toHaveBeenCalledWith("/api/v2/device/profile");
  });

  it("suggests making tags public when the member's profile isn't public yet", async () => {
    connect();
    const link = await resolveInviteLink(vi.fn().mockResolvedValue({ profile: { handle: "alex", invitable: false } }));
    expect(link).toMatchObject({ kind: "general", url: GENERAL_INVITE_URL, nameStep: "publish" });
  });

  it("never asks a member to publish when Community doesn't say whether the invite works", async () => {
    connect();
    expect(await resolveInviteLink(vi.fn().mockResolvedValue({ profile: { handle: "alex" } }))).toMatchObject({ kind: "general", nameStep: null });
    expect(await resolveInviteLink(vi.fn().mockRejectedValue(new Error("offline")))).toMatchObject({ kind: "general", nameStep: null });
  });

  it("asks Community for the profile with only the headers that route allows", async () => {
    connect();
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ profile: { handle: "alex", invitable: true } }));

    expect(await resolveInviteLink()).toMatchObject({ kind: "personal", url: "https://community.tagify.fm/join/alex" });
    const headers = profileHeaders(request);
    expect(headers.authorization).toBe("Bearer access");
    // Before: sync's x-tagify-* headers went along, Spotify refused the request, and the general link appeared.
    expect(Object.keys(headers).filter((name) => !PROFILE_ROUTE_ALLOWED_HEADERS.includes(name.toLowerCase()))).toEqual([]);
  });

  it("refreshes a session about to expire through sync first, then asks with the new one", async () => {
    connect(60);
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://example.supabase.co/auth/v1/token")) {
        return Response.json({ access_token: "access-2", refresh_token: "refresh-2", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 });
      }
      if (url === "https://community.tagify.fm/api/v2/device/profile") return Response.json({ profile: { handle: "alex", invitable: true } });
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    });

    expect(await resolveInviteLink()).toMatchObject({ kind: "personal" });
    const urls = request.mock.calls.map(([input]) => String(input));
    expect(urls.findIndex((url) => url.includes("/auth/v1/token"))).toBeLessThan(urls.indexOf("https://community.tagify.fm/api/v2/device/profile"));
    const headers = profileHeaders(request);
    expect(headers.authorization).toBe("Bearer access-2");
    expect(Object.keys(headers).filter((name) => !PROFILE_ROUTE_ALLOWED_HEADERS.includes(name.toLowerCase()))).toEqual([]);
  });
});
