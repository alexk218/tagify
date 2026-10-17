// Shared by the extension and app: capture upgrade history before the welcome popup replaces it.
const INTRODUCTION_KEY = "tagify:stats-introduction:3.2";

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  return match ? match.slice(1, 4).map(Number) : null;
}

export function initializeStatsIntroduction(currentVersion: string): boolean {
  try {
    const current = versionParts(currentVersion);
    if (!current || current[0] < 3 || (current[0] === 3 && current[1] < 2)) return false;
    const saved = localStorage.getItem(INTRODUCTION_KEY);
    if (saved !== null) return saved === "pending";
    const previous = versionParts(localStorage.getItem("tagify:lastSeenVersion") ?? "");
    const upgrading = !!previous && (previous[0] < 3 || (previous[0] === 3 && previous[1] < 2));
    localStorage.setItem(INTRODUCTION_KEY, upgrading ? "pending" : "seen");
    return upgrading;
  } catch {
    // If installation history is unavailable, avoid highlighting a first-time install.
    return false;
  }
}

export function dismissStatsIntroduction(): void {
  try { localStorage.setItem(INTRODUCTION_KEY, "seen"); } catch { /* Opening Stats still works. */ }
}
