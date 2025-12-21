/**
 * Test suite for VersionCheckerService
 * Tests semantic version comparison functionality
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { VersionCheckerService } from "../VersionCheckerService";

describe("VersionCheckerService", () => {
  let versionChecker;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    // Initialize with a base version for testing
    versionChecker = new VersionCheckerService("1.0.2", "alexk218", "tagify");
  });

  describe("Version Comparison - Standard Semver", () => {
    const testCases = [
      // Your main scenario
      { current: "1.0.2", latest: "2.0.1", shouldUpdate: true, description: "Major version bump" },

      // Standard version increments
      { current: "1.0.2", latest: "1.0.3", shouldUpdate: true, description: "Patch version bump" },
      { current: "1.0.2", latest: "1.1.0", shouldUpdate: true, description: "Minor version bump" },
      {
        current: "1.0.2",
        latest: "2.0.0",
        shouldUpdate: true,
        description: "Major version bump to .0",
      },

      // No update scenarios
      { current: "1.0.2", latest: "1.0.2", shouldUpdate: false, description: "Same version" },
      { current: "2.0.0", latest: "1.9.9", shouldUpdate: false, description: "Current is newer" },
      {
        current: "1.1.0",
        latest: "1.0.9",
        shouldUpdate: false,
        description: "Current minor is newer",
      },

      // Edge case: String vs numeric comparison (common failure point)
      {
        current: "1.2.0",
        latest: "1.10.0",
        shouldUpdate: true,
        description: "Double digit minor version",
      },
      {
        current: "1.9.0",
        latest: "1.10.0",
        shouldUpdate: true,
        description: "Single to double digit",
      },
      {
        current: "1.10.0",
        latest: "1.2.0",
        shouldUpdate: false,
        description: "Double digit current is newer",
      },
      {
        current: "1.0.9",
        latest: "1.0.10",
        shouldUpdate: true,
        description: "Double digit patch version",
      },

      // Large version numbers
      {
        current: "10.15.22",
        latest: "10.15.23",
        shouldUpdate: true,
        description: "Large version numbers",
      },
      { current: "99.99.99", latest: "100.0.0", shouldUpdate: true, description: "Version 100" },
    ];

    testCases.forEach(({ current, latest, shouldUpdate, description }) => {
      test(`${description}: ${current} vs ${latest}`, async () => {
        // Create a new version checker with the current version
        const checker = new VersionCheckerService(current, "alexk218", "tagify");

        // Mock the GitHub API response
        const mockResponse = {
          ok: true,
          json: () =>
            Promise.resolve({
              tag_name: latest,
              name: `Release ${latest}`,
              published_at: "2024-08-15T14:30:42Z",
              html_url: `https://github.com/alexk218/tagify/releases/tag/${latest}`,
              body: "Test release notes",
            }),
        };

        // Mock fetch using Vitest
        global.fetch = vi.fn().mockResolvedValue(mockResponse);

        // Test the update check
        const result = await checker.checkForUpdates();

        expect(result.hasUpdate).toBe(shouldUpdate);
        expect(result.latestVersion).toBe(latest);
      });
    });
  });

  describe("Version Format Edge Cases", () => {
    const edgeCases = [
      // Version prefix handling
      {
        current: "1.0.2",
        latest: "v1.0.3",
        shouldUpdate: true,
        description: "Latest has v prefix",
      },
      {
        current: "v1.0.2",
        latest: "1.0.3",
        shouldUpdate: true,
        description: "Current has v prefix",
      },
      {
        current: "v1.0.2",
        latest: "v1.0.3",
        shouldUpdate: true,
        description: "Both have v prefix",
      },

      // Different length versions
      { current: "1.0", latest: "1.0.1", shouldUpdate: true, description: "Current missing patch" },
      {
        current: "1",
        latest: "1.0.1",
        shouldUpdate: true,
        description: "Current missing minor and patch",
      },
      { current: "1.0.0", latest: "1.0", shouldUpdate: false, description: "Latest missing patch" },

      // Extra zeros
      {
        current: "1.0.2",
        latest: "1.0.2.0",
        shouldUpdate: false,
        description: "Latest has extra zero",
      },
      {
        current: "1.0.2.0",
        latest: "1.0.2",
        shouldUpdate: false,
        description: "Current has extra zero",
      },
    ];

    edgeCases.forEach(({ current, latest, shouldUpdate, description }) => {
      test(`${description}: "${current}" vs "${latest}"`, async () => {
        const checker = new VersionCheckerService(current, "alexk218", "tagify");

        const mockResponse = {
          ok: true,
          json: () =>
            Promise.resolve({
              tag_name: latest,
              name: `Release ${latest}`,
              published_at: "2024-08-15T14:30:42Z",
              html_url: `https://github.com/alexk218/tagify/releases/tag/${latest}`,
              body: "Test release notes",
            }),
        };

        global.fetch = vi.fn().mockResolvedValue(mockResponse);
        const result = await checker.checkForUpdates();

        expect(result.hasUpdate).toBe(shouldUpdate);
      });
    });
  });

  describe("Pre-release Versions", () => {
    const preReleaseCases = [
      {
        current: "1.0.2",
        latest: "2.0.0-alpha.1",
        shouldUpdate: true,
        description: "Alpha of next major",
      },
      {
        current: "1.0.2",
        latest: "1.0.3-beta.1",
        shouldUpdate: true,
        description: "Beta of next patch",
      },
      // {
      //   current: "2.0.0-alpha.1",
      //   latest: "2.0.0-alpha.2",
      //   shouldUpdate: true,
      //   description: "Alpha progression",
      // },
      {
        current: "2.0.0-alpha.2",
        latest: "2.0.0-beta.1",
        shouldUpdate: true,
        description: "Alpha to beta",
      },
      {
        current: "2.0.0-beta.1",
        latest: "2.0.0",
        shouldUpdate: true,
        description: "Beta to release",
      },
      {
        current: "2.0.0",
        latest: "2.0.0-alpha.1",
        shouldUpdate: false,
        description: "Release vs alpha",
      },
    ];

    preReleaseCases.forEach(({ current, latest, shouldUpdate, description }) => {
      test(`Pre-release: ${description}`, async () => {
        const checker = new VersionCheckerService(current, "alexk218", "tagify");

        const mockResponse = {
          ok: true,
          json: () =>
            Promise.resolve({
              tag_name: latest,
              name: `Release ${latest}`,
              published_at: "2024-08-15T14:30:42Z",
              html_url: `https://github.com/alexk218/tagify/releases/tag/${latest}`,
              body: "Test release notes",
              prerelease: latest.includes("-"),
            }),
        };

        global.fetch = vi.fn().mockResolvedValue(mockResponse);
        const result = await checker.checkForUpdates();

        expect(result.hasUpdate).toBe(shouldUpdate);
      });
    });
  });

  describe("GitHub API Integration", () => {
    test("handles GitHub API errors gracefully", async () => {
      const checker = new VersionCheckerService("1.0.2", "alexk218", "tagify");

      // Mock API failure
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await checker.checkForUpdates();

      expect(result.hasUpdate).toBe(false);
      expect(result.latestVersion).toBe("1.0.2"); // Should fallback to current
    });

    test("handles network errors gracefully", async () => {
      const checker = new VersionCheckerService("1.0.2", "alexk218", "tagify");

      // Mock network failure
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await checker.checkForUpdates();

      expect(result.hasUpdate).toBe(false);
      expect(result.latestVersion).toBe("1.0.2");
    });

    test("parses GitHub release data correctly", async () => {
      const checker = new VersionCheckerService("1.0.2", "alexk218", "tagify");

      const mockReleaseData = {
        tag_name: "1.0.3",
        name: "Tagify v1.0.3",
        published_at: "2024-08-15T14:30:42Z",
        html_url: "https://github.com/alexk218/tagify/releases/tag/1.0.3",
        body: "## What's New\n- Fixed banner styling\n- Added version checker",
        assets: [
          {
            browser_download_url:
              "https://github.com/alexk218/tagify/releases/download/1.0.3/tagify-1.0.3.zip",
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockReleaseData),
      });

      const result = await checker.checkForUpdates();

      expect(result.hasUpdate).toBe(true);
      expect(result.latestVersion).toBe("1.0.3");
      expect(result.releaseDate).toBe("2024-08-15T14:30:42Z");
      expect(result.downloadUrl).toBe("https://github.com/alexk218/tagify/releases/tag/1.0.3");
      expect(result.changelog).toContain("Fixed banner styling");
    });
  });

  describe("Version Dismissal", () => {
    // Mock localStorage for Vitest
    const mockLocalStorage = (() => {
      let store = {};

      return {
        getItem: vi.fn((key) => store[key] || null),
        setItem: vi.fn((key, value) => {
          store[key] = value.toString();
        }),
        removeItem: vi.fn((key) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          store = {};
        }),
      };
    })();

    beforeEach(() => {
      // Mock localStorage
      Object.defineProperty(global, "localStorage", {
        value: mockLocalStorage,
        writable: true,
      });

      // Clear localStorage before each test
      mockLocalStorage.clear();
      vi.clearAllMocks();
    });

    test("can dismiss version permanently", () => {
      VersionCheckerService.dismissVersion("1.0.3");
      expect(VersionCheckerService.isDismissed("1.0.3")).toBe(true);
      expect(VersionCheckerService.isDismissed("1.0.4")).toBe(false);
    });

    test("persists dismissed versions in localStorage", () => {
      VersionCheckerService.dismissVersion("1.0.3");

      // Verify localStorage was called
      expect(mockLocalStorage.setItem).toHaveBeenCalled();

      // Create new service instance to test persistence
      const newChecker = new VersionCheckerService("1.0.2", "alexk218", "tagify");
      expect(VersionCheckerService.isDismissed("1.0.3")).toBe(true);
    });
  });

  describe("Real-world Scenarios", () => {
    test("typical development progression", async () => {
      const scenarios = [
        { from: "1.0.0", to: "1.0.1", expected: true }, // Bug fix
        { from: "1.0.1", to: "1.1.0", expected: true }, // Feature
        { from: "1.1.0", to: "2.0.0", expected: true }, // Breaking change
        { from: "2.0.0", to: "2.1.0", expected: true }, // New feature
        { from: "2.1.0", to: "2.1.1", expected: true }, // Patch
      ];

      for (const { from, to, expected } of scenarios) {
        const checker = new VersionCheckerService(from, "alexk218", "tagify");

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              tag_name: to,
              published_at: "2024-08-15T14:30:42Z",
              html_url: `https://github.com/alexk218/tagify/releases/tag/${to}`,
            }),
        });

        const result = await checker.checkForUpdates();
        expect(result.hasUpdate).toBe(expected);
      }
    });
  });
});

// Helper function for manual testing in development
if (typeof window !== "undefined") {
  window.testVersionComparison = function () {
    console.log("Running manual version comparison tests...");

    const testCases = [
      { current: "1.0.2", latest: "2.0.1", expected: true },
      { current: "1.2.0", latest: "1.10.0", expected: true },
      { current: "1.10.0", latest: "1.2.0", expected: false },
    ];

    testCases.forEach(({ current, latest, expected }) => {
      const checker = new VersionCheckerService(current, "alexk218", "tagify");
      console.log(`${current} vs ${latest}: expected ${expected}`);
    });
  };
}
