import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeStatsIntroduction, dismissStatsIntroduction } from "../statsIntroduction";

describe("Stats introduction", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it.each(["2.9.0", "3.0.0", "3.1.0", "v3.1.9", "3.1.0-beta.1"])("persists the highlight when upgrading from %s", (previous) => {
    localStorage.setItem("tagify:lastSeenVersion", previous);
    expect(initializeStatsIntroduction("3.2.0")).toBe(true);
    localStorage.setItem("tagify:lastSeenVersion", "3.2.0");
    expect(initializeStatsIntroduction("3.2.0")).toBe(true);
    expect(initializeStatsIntroduction("3.3.0")).toBe(true);
    dismissStatsIntroduction();
    expect(initializeStatsIntroduction("3.3.0")).toBe(false);
  });

  it.each(["3.2.0", "3.3.0", "4.0.0"])("never highlights a first installation on %s", (version) => {
    expect(initializeStatsIntroduction(version)).toBe(false);
    localStorage.setItem("tagify:lastSeenVersion", version);
    expect(initializeStatsIntroduction("5.0.0")).toBe(false);
  });

  it.each(["3.2.0", "3.2.0-beta.1", "3.3.0", "4.0.0", "unknown"])("does not guess upgrade history from %s", (previous) => {
    localStorage.setItem("tagify:lastSeenVersion", previous);
    expect(initializeStatsIntroduction("4.0.0")).toBe(false);
  });

  it("supports skipping directly from 3.1 to a future release", () => {
    localStorage.setItem("tagify:lastSeenVersion", "3.1.0");
    expect(initializeStatsIntroduction("4.0.0")).toBe(true);
  });

  it("does not consume the introduction before 3.2", () => {
    localStorage.setItem("tagify:lastSeenVersion", "3.1.0");
    expect(initializeStatsIntroduction("3.1.1")).toBe(false);
    expect(initializeStatsIntroduction("3.2.0")).toBe(true);
  });

  it("keeps Stats usable when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
    expect(initializeStatsIntroduction("3.2.0")).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => dismissStatsIntroduction()).not.toThrow();
  });
});
