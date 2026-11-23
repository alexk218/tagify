import { beforeEach, describe, expect, it } from "vitest";
import { isUpgradedSince, recordInstalledVersion } from "../installedVersion";

describe("New marks only for people who had Tagify before the feature", () => {
  beforeEach(() => localStorage.clear());

  it("marks nothing for a brand-new installation", () => {
    recordInstalledVersion("3.4.1");
    expect(isUpgradedSince("3.4.0", "3.4.1")).toBe(false);
    expect(isUpgradedSince("3.4.1", "3.4.1")).toBe(false);
  });

  it("marks later features once a new installation updates", () => {
    recordInstalledVersion("3.4.1");
    expect(isUpgradedSince("3.5.0", "3.5.0")).toBe(true);
  });

  it("marks features from the version an existing installation last opened, and later ones", () => {
    localStorage.setItem("tagify:lastSeenVersion", "3.4.0");
    recordInstalledVersion("3.4.1");
    expect(isUpgradedSince("3.3.6", "3.4.1")).toBe(false);
    expect(isUpgradedSince("3.4.0", "3.4.1")).toBe(true);
    expect(isUpgradedSince("3.4.1", "3.4.1")).toBe(true);
  });

  it("keeps the first record when Tagify updates again", () => {
    recordInstalledVersion("3.4.1");
    localStorage.setItem("tagify:lastSeenVersion", "3.4.1");
    recordInstalledVersion("3.5.0");
    expect(isUpgradedSince("3.4.1", "3.5.0")).toBe(false);
  });

  it("records on first use when startup didn't", () => {
    expect(isUpgradedSince("3.4.0", "3.4.1")).toBe(false);
    localStorage.clear();
    localStorage.setItem("tagify:lastSeenVersion", "3.3.6");
    expect(isUpgradedSince("3.4.0", "3.4.1")).toBe(true);
  });
});
