import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUsageAccountDigest, recordDiscoveryAnswer, recordTagifyOpen } from "../tagifyUsage";

describe("private Tagify usage recording", () => {
  let getUser: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    getUser = vi.fn().mockResolvedValue({ username: "stable-account", displayName: "A changeable name" });
    vi.stubGlobal("Spicetify", { Platform: { UserAPI: { getUser } } });
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("records an empty-library open without sending names, tokens, or song data", async () => {
    expect(await recordTagifyOpen("3.0.0")).toBe(true);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(Object.keys(body).sort()).toEqual(["accountDigest", "appVersion"]);
    expect(body.accountDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain("stable-account");
  });

  it("keeps the same identity after local data is cleared or the display name changes", async () => {
    const before = await getUsageAccountDigest();
    localStorage.clear();
    getUser.mockResolvedValue({ username: "stable-account", displayName: "Changed" });
    expect(await getUsageAccountDigest()).toBe(before);
    getUser.mockResolvedValue({ username: "another-account" });
    expect(await getUsageAccountDigest()).not.toBe(before);
  });

  it("throttles repeated opens but sends an answer immediately", async () => {
    await recordTagifyOpen("3.0.0");
    await recordTagifyOpen("3.0.0");
    expect(fetch).toHaveBeenCalledTimes(1);
    await recordDiscoveryAnswer("3.0.0", { source: "reddit" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).survey).toEqual({ source: "reddit" });
  });

  it("retries a failed answer with its own account on a later open", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    expect(await recordDiscoveryAnswer("3.0.0", { source: "friend", otherDetails: "a DJ" })).toBe(false);
    getUser.mockResolvedValue({ username: "another-account" });
    await recordTagifyOpen("3.0.0");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).not.toHaveProperty("survey");
    getUser.mockResolvedValue({ username: "stable-account" });
    await recordTagifyOpen("3.0.0");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body)).survey.source).toBe("friend");
  });

  it("does not invent a user identity when Spotify's account is unavailable", async () => {
    getUser.mockResolvedValue({ displayName: "Only a name" });
    expect(await recordTagifyOpen("3.0.0")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
