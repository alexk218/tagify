// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tests run from the package folder, like the other source checks in this suite.
const sourceRoot = "src/";

function shippedSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : shippedSources(path);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

// Tagify 3.2.0 checked tagify.fm for updates; every later version reads GitHub Releases only.
describe("Updates and installer downloads come from GitHub", () => {
  it("never checks or downloads from tagify.fm in shipped code", () => {
    const offenders = shippedSources(sourceRoot).filter((path) =>
      /https?:\/\/(www\.)?tagify\.fm\/(download|releases)\b/.test(readFileSync(path, "utf8")));
    expect(offenders.map((path) => path.slice(sourceRoot.length))).toEqual([]);
  });

  it("checks the latest GitHub release for new versions", () => {
    const checker = readFileSync(join(sourceRoot, "services/VersionCheckerService.ts"), "utf8");
    expect(checker).toContain("https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest");
    expect(checker).not.toMatch(/tagify\.fm/);
  });
});
