// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const lookup = vi.hoisted(() => vi.fn());
vi.mock("@/services/SpotifyService", () => ({ spotifyService: { getTrack: lookup } }));
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); lookup.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
it("caps explicit checks at 50 requests, deduplicates and skips known metadata", async () => {
  const { checkRuleDetails, rememberRuleFacts, readRuleFacts } = await import("../facts");
  rememberRuleFacts("spotify:track:known", { durationMs: 180000 });
  lookup.mockImplementation(async uri => { rememberRuleFacts(uri, { durationMs: 180000 }); return { duration_ms: 180000 }; });
  const uris = ["spotify:track:known", ...Array.from({ length: 100 }, (_, i) => `spotify:track:song${i}`)];
  const task = checkRuleDetails([...uris, ...uris], () => true, () => {});
  await vi.advanceTimersByTimeAsync(51000);
  expect(await task).toBe(50); expect(lookup).toHaveBeenCalledTimes(50);
  expect(readRuleFacts()["spotify:track:song49"].durationMs).toBe(180000);
});
it("stops on HTTP 429, honors Retry-After across reloads and never loops", async () => {
  const { checkRuleDetails } = await import("../facts");
  lookup.mockRejectedValue({ status: 429, headers: { "retry-after": "120" } });
  await expect(checkRuleDetails(["spotify:track:a", "spotify:track:b"], () => true, () => {})).rejects.toThrow("Checks paused");
  expect(lookup).toHaveBeenCalledTimes(1);
  vi.resetModules(); const reloaded = await import("../facts");
  await expect(reloaded.checkRuleDetails(["spotify:track:b"], () => true, () => {})).rejects.toThrow("paused");
  expect(lookup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120001);
  lookup.mockResolvedValue({ duration_ms: 180000 });
  const retry = reloaded.checkRuleDetails(["spotify:track:b"], () => true, () => {});
  await vi.advanceTimersByTimeAsync(1001); expect(await retry).toBe(1);
});
it("cancels before requests and after the current in-flight request", async () => {
  const { checkRuleDetails } = await import("../facts");
  await expect(checkRuleDetails(["spotify:track:a"], () => false, () => {})).resolves.toBe(0);
  expect(lookup).not.toHaveBeenCalled();
  let proceed = true;
  lookup.mockImplementation(async () => { proceed = false; return { duration_ms: 180000 }; });
  await expect(checkRuleDetails(["spotify:track:a", "spotify:track:b"], () => proceed, () => {})).resolves.toBe(1);
  expect(lookup).toHaveBeenCalledTimes(1);
});
it("treats unavailable details as a failure and leaves existing cached facts untouched", async () => {
  const { checkRuleDetails, rememberRuleFacts, readRuleFacts } = await import("../facts");
  rememberRuleFacts("spotify:track:known", { durationMs: 170000 });
  lookup.mockResolvedValue(null);
  await expect(checkRuleDetails(["spotify:track:a", "spotify:track:b"], () => true, () => {})).rejects.toThrow("Checks paused");
  expect(lookup).toHaveBeenCalledTimes(1); expect(readRuleFacts()["spotify:track:known"].durationMs).toBe(170000);
});

it("bounds large-library facts without repeated snapshots and keeps valid duration after partial reads", async () => {
  const { rememberRuleFacts, readRuleFacts } = await import("../facts");
  for (let i = 0; i < 10001; i++) rememberRuleFacts(`spotify:track:song${i}`, { durationMs: 180000, name: "Song", artists: "Artist" });
  const snapshot = readRuleFacts();
  expect(Object.keys(snapshot)).toHaveLength(10000);
  expect(snapshot["spotify:track:song0"]).toBeUndefined();
  expect(readRuleFacts()).toBe(snapshot);
  rememberRuleFacts("spotify:track:song10000", { name: "New display name" });
  expect(readRuleFacts()["spotify:track:song10000"]).toMatchObject({ durationMs: 180000, name: "New display name", artists: "Artist" });
  expect(lookup).not.toHaveBeenCalled();
});
