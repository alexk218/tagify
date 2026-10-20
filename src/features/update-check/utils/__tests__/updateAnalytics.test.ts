// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { recordUpdateBannerShown, updateKind } from "../updateAnalytics";
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: vi.fn() }));

describe("update analytics", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  it.each([
    ["3.2.0", "3.2.1", "patch"], ["3.2.0", "3.3.0", "minor"], ["3.2.0", "4.0.0", "major"],
    ["v3.2.0", "3.4.0-beta.1", "minor"], ["unknown", "3.3.0", "major"], ["3.2.0", "next", "patch"],
  ])("classifies %s to %s as a %s update", (current, latest, kind) => {
    expect(updateKind(current, latest)).toBe(kind);
  });
  it("reports a waiting version at most once a day", () => {
    recordUpdateBannerShown("3.2.0", "3.3.0", new Date("2026-10-20T08:00:00Z"));
    recordUpdateBannerShown("3.2.0", "3.3.0", new Date("2026-10-20T22:00:00Z"));
    recordUpdateBannerShown("3.2.0", "3.3.1", new Date("2026-10-20T22:00:00Z"));
    recordUpdateBannerShown("3.2.0", "3.3.0", new Date("2026-10-21T08:00:00Z"));
    expect(vi.mocked(recordProductInteraction).mock.calls).toEqual([
      ["update_banner_shown", { update_kind: "minor" }],
      ["update_banner_shown", { update_kind: "minor" }],
      ["update_banner_shown", { update_kind: "minor" }],
    ]);
  });
});
