export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  releaseDate?: string;
  downloadUrl?: string;
  changelog?: string;
}

export class VersionCheckerService {
  private currentVersion: string;
  private repoOwner: string;
  private repoName: string;
  private static readonly DISMISSED_VERSIONS_KEY = "tagify:dismissedVersions";

  constructor(currentVersion: string, repoOwner: string, repoName: string) {
    this.currentVersion = currentVersion;
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    const baseInfo: UpdateInfo = {
      hasUpdate: false,
      latestVersion: this.currentVersion,
    };

    try {
      const apiUrl = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        console.warn(`GitHub API responded with status: ${response.status}`);
        return baseInfo;
      }

      const release = await response.json();
      const latestVersion = this.cleanVersionString(release.tag_name);
      const currentVersion = this.cleanVersionString(this.currentVersion);

      const hasUpdate = this.isNewerVersion(currentVersion, latestVersion);

      return {
        hasUpdate,
        latestVersion,
        releaseDate: release.published_at,
        downloadUrl: release.html_url,
        changelog: release.body || undefined,
      };
    } catch (error) {
      console.error("Error checking for updates:", error);
      return baseInfo;
    }
  }

  /**
   * Compare two semantic version strings
   * Returns true if latest is newer than current
   */
  private isNewerVersion(current: string, latest: string): boolean {
    const currentParts = this.parseVersion(current);
    const latestParts = this.parseVersion(latest);

    // Handle pre-release versions
    const currentIsPreRelease = this.isPreRelease(current);
    const latestIsPreRelease = this.isPreRelease(latest);

    // Compare main version numbers (major.minor.patch)
    for (let i = 0; i < 3; i++) {
      const currentPart = currentParts.version[i] || 0;
      const latestPart = latestParts.version[i] || 0;

      if (latestPart > currentPart) {
        return true;
      } else if (latestPart < currentPart) {
        return false;
      }
    }

    // If base versions are equal, handle pre-release logic
    if (currentIsPreRelease && !latestIsPreRelease) {
      // Pre-release to stable is an update
      return true;
    } else if (!currentIsPreRelease && latestIsPreRelease) {
      // Stable to pre-release is not an update
      return false;
    } else if (currentIsPreRelease && latestIsPreRelease) {
      // Both are pre-releases, compare pre-release versions
      return this.comparePreReleaseVersions(currentParts.preRelease!, latestParts.preRelease!);
    }

    // Versions are identical
    return false;
  }

  /**
   * Parse version string into components
   */
  private parseVersion(version: string): { version: number[]; preRelease: string | null } {
    const cleanVersion = this.cleanVersionString(version);
    const parts = cleanVersion.split("-");
    const mainVersion = parts[0];
    const preRelease = parts.length > 1 ? parts.slice(1).join("-") : null;

    const versionNumbers = mainVersion.split(".").map((part) => {
      const num = parseInt(part, 10);
      return isNaN(num) ? 0 : num;
    });

    // Ensure we have at least 3 parts (major.minor.patch)
    while (versionNumbers.length < 3) {
      versionNumbers.push(0);
    }

    return {
      version: versionNumbers,
      preRelease,
    };
  }

  /**
   * Clean version string by removing 'v' prefix and extra parts
   */
  private cleanVersionString(version: string): string {
    if (!version) return "0.0.0";

    // Remove 'v' prefix if present
    let cleaned = version.startsWith("v") ? version.substring(1) : version;

    // Remove any .0 suffixes beyond the third part
    const parts = cleaned.split(".");
    if (parts.length > 3) {
      // Keep only first 3 parts if they're meaningful, or if 4th part is not just '0'
      if (parts[3] !== "0") {
        cleaned = parts.slice(0, 3).join(".");
      } else {
        cleaned = parts.slice(0, 3).join(".");
      }
    }

    return cleaned;
  }

  /**
   * Check if version is a pre-release
   */
  private isPreRelease(version: string): boolean {
    return version.includes("-");
  }

  /**
   * Compare pre-release versions
   */
  private comparePreReleaseVersions(current: string, latest: string): boolean {
    const currentLower = current.toLowerCase();
    const latestLower = latest.toLowerCase();

    // Define precedence order: alpha < beta < rc
    const typeOrder: { [key: string]: number } = { alpha: 1, beta: 2, rc: 3 };

    // Extract type and number from pre-release strings
    const currentInfo = this.parsePreReleaseInfo(currentLower);
    const latestInfo = this.parsePreReleaseInfo(latestLower);

    // Compare by type first
    if (currentInfo.type !== latestInfo.type) {
      const currentOrder = typeOrder[currentInfo.type] || 999;
      const latestOrder = typeOrder[latestInfo.type] || 999;
      return latestOrder > currentOrder;
    }

    // Same type, compare by number
    if (currentInfo.number !== null && latestInfo.number !== null) {
      return latestInfo.number > currentInfo.number;
    }

    // Fall back to string comparison
    return latest > current;
  }

  /**
   * Parse pre-release info to extract type and number
   */
  private parsePreReleaseInfo(preRelease: string): { type: string; number: number | null } {
    // Match patterns like "alpha.1", "alpha-1", "alpha1", or just "alpha"
    const match = preRelease.match(/(alpha|beta|rc)[.-]?(\d+)?/);

    if (match) {
      const type = match[1];
      const number = match[2] ? parseInt(match[2], 10) : null;
      return { type, number };
    }

    // No recognized pattern, treat as unknown type
    return { type: preRelease, number: null };
  }

  /**
   * Static method to dismiss a version permanently
   */
  static dismissVersion(version: string): void {
    try {
      const dismissed = this.getDismissedVersions();
      dismissed.add(version);
      localStorage.setItem(this.DISMISSED_VERSIONS_KEY, JSON.stringify(Array.from(dismissed)));
    } catch (error) {
      console.error("Error dismissing version:", error);
    }
  }

  /**
   * Static method to check if a version is dismissed
   */
  static isDismissed(version: string): boolean {
    try {
      const dismissed = this.getDismissedVersions();
      return dismissed.has(version);
    } catch (error) {
      console.error("Error checking dismissed versions:", error);
      return false;
    }
  }

  /**
   * Get set of dismissed versions from localStorage
   */
  private static getDismissedVersions(): Set<string> {
    try {
      const stored = localStorage.getItem(this.DISMISSED_VERSIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return new Set(Array.isArray(parsed) ? parsed : []);
      }
    } catch (error) {
      console.error("Error loading dismissed versions:", error);
    }
    return new Set();
  }

  /**
   * Clear all dismissed versions (useful for testing or user preference)
   */
  static clearDismissedVersions(): void {
    try {
      localStorage.removeItem(this.DISMISSED_VERSIONS_KEY);
    } catch (error) {
      console.error("Error clearing dismissed versions:", error);
    }
  }
}
