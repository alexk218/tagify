import { describe, expect, it } from "vitest";
import { isPhoneButtonVisible, QUIET_MENU_GRACE_MS } from "../phoneAppState";
import { parseCommunityAndroidReleased } from "@/features/community-updates/communityUpdateService";

const NOW = Date.parse("2026-11-20T12:00:00Z");

describe("phone app button visibility", () => {
  it("is one of the optional buttons when they are shown", () => {
    expect(isPhoneButtonVisible({}, true, NOW)).toBe(true);
    expect(isPhoneButtonVisible({ opened: true }, true, NOW)).toBe(true);
  });

  it("shows in a quiet menu until it is opened once", () => {
    expect(isPhoneButtonVisible({}, false, NOW)).toBe(true);
    expect(isPhoneButtonVisible({ quietSince: NOW - 1000 }, false, NOW)).toBe(true);
    expect(isPhoneButtonVisible({ quietSince: NOW - 1000, opened: true }, false, NOW)).toBe(false);
  });

  it("leaves a quiet menu after two weeks even if never opened", () => {
    expect(isPhoneButtonVisible({ quietSince: NOW - QUIET_MENU_GRACE_MS + 1 }, false, NOW)).toBe(true);
    expect(isPhoneButtonVisible({ quietSince: NOW - QUIET_MENU_GRACE_MS }, false, NOW)).toBe(false);
  });

  it("stays away after Don't show again, with or without optional buttons", () => {
    expect(isPhoneButtonVisible({ hidden: true }, true, NOW)).toBe(false);
    expect(isPhoneButtonVisible({ hidden: true }, false, NOW)).toBe(false);
  });

  it("comes back for good from Settings, even in a quiet menu", () => {
    expect(isPhoneButtonVisible({ pinned: true, opened: true, quietSince: 0 }, false, NOW)).toBe(true);
  });
});

describe("Android release in Community's update feed", () => {
  it.each([
    ["missing", undefined, false],
    ["null", null, false],
    ["not released", { released: false }, false],
    ["a string", { released: "true" }, false],
    ["released", { released: true }, true],
  ])("treats %s as %s", (_name, android, expected) => {
    expect(parseCommunityAndroidReleased({ schemaVersion: 1, releases: [], ...(android === undefined ? {} : { android }) })).toBe(expected);
  });
});
