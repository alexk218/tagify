import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Tagify Community imports src/shared by relative path, so nothing here may depend on this app's aliases or packages.
const root = join(__dirname, "..");
const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(path);
  return /\.(ts|tsx|mjs|mts)$/.test(entry.name) ? [path] : [];
});

describe("shared code", () => {
  it.each(sources(root).map((path) => [relative(root, path), path]))("%s imports only other shared files", (_name, path) => {
    const specifiers = [...readFileSync(path, "utf8").matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']/g)]
      .map((match) => match[1] ?? match[2]);
    expect(specifiers.filter((specifier) => !specifier.startsWith("./") && !specifier.startsWith("../"))).toEqual([]);
    for (const specifier of specifiers) expect(join(path, "..", specifier).startsWith(root)).toBe(true);
  });
});
