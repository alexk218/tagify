import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStarterTaxonomy, defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure } from "@/types/tagData";
import { downloadSafetyTagDataBackup, maybeDownloadAutomaticTagDataFileBackup } from "../tagData.backup";
import { hasCustomTaxonomy, hasUserLibraryContent } from "../tagData.schema";

/** A library Tagify 3.3.3 or earlier started: the 73 version-1 starter tags and nothing else. */
const version1Library = (): TagDataStructure => ({
  ...structuredClone(defaultTagData),
  taxonomy: buildStarterTaxonomy(1),
});

/** The same library after the member renamed one starter tag. */
function version1WithRenamedTag(): TagDataStructure {
  const library = version1Library();
  const vintage = Object.values(library.taxonomy.tagsById).find((tag) => tag.name === "Vintage")!;
  library.taxonomy.tagsById[vintage.id] = { ...vintage, name: "Old School" };
  return library;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a library that still has the 73 starter tags from before the refresh", () => {
  it("counts as holding nothing of the member's own, like a new library", () => {
    expect(hasCustomTaxonomy(version1Library().taxonomy)).toBe(false);
    expect(hasUserLibraryContent(version1Library())).toBe(false);
    expect(hasCustomTaxonomy(defaultTagData.taxonomy)).toBe(false);
  });

  it("counts as the member's own once they change a starter tag", () => {
    expect(hasCustomTaxonomy(version1WithRenamedTag().taxonomy)).toBe(true);
    expect(hasUserLibraryContent(version1WithRenamedTag())).toBe(true);
  });

  it("isn't saved as a backup file on its own, but is once the member changes it", () => {
    const anchors: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { anchors.push(this.download); });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const now = new Date(Date.UTC(2026, 10, 2, 12, 0, 0));

    expect(downloadSafetyTagDataBackup(version1Library(), {}, "before-reset", now)).toBe(false);
    expect(maybeDownloadAutomaticTagDataFileBackup(version1Library(), { now: now.getTime() })).toEqual({ status: "skipped", reason: "empty-data" });
    expect(downloadSafetyTagDataBackup(version1WithRenamedTag(), {}, "before-reset", now)).toBe(true);
    expect(anchors).toEqual(["tagify-before-reset-2026-11-02T12-00-00-000Z.json"]);
  });
});
