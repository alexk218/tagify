/**
 * Which Tagify version this installation started on, so "New" marks only reach people who used
 * Tagify before the feature arrived. For someone who just installed Tagify everything is new, so
 * nothing is marked.
 *
 * Stored on this computer only. Installations from before this was recorded only know the last
 * version they opened ("tagify:lastSeenVersion"), so they are kept as "on or before" that version
 * and still see the marks for what that version brought.
 */
const INSTALLED_VERSION_KEY = "tagify:installed-version";
const LAST_SEEN_VERSION_KEY = "tagify:lastSeenVersion";

interface InstalledVersion {
  version: string;
  /** Installed on this version or an earlier one (recorded from an existing installation). */
  atOrBefore: boolean;
}

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/.exec(version);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function readInstalledVersion(): InstalledVersion | null {
  const raw = localStorage.getItem(INSTALLED_VERSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as InstalledVersion).version === "string") {
      return { version: (parsed as InstalledVersion).version, atOrBefore: (parsed as InstalledVersion).atOrBefore === true };
    }
  } catch { /* A damaged value is recorded again below. */ }
  return null;
}

/**
 * Records the installation's first version once. Runs at startup before "tagify:lastSeenVersion"
 * is updated to this version, so an existing installation is still told apart from a new one.
 */
export function recordInstalledVersion(currentVersion: string): void {
  try {
    if (readInstalledVersion()) return;
    const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);
    const record: InstalledVersion = lastSeen && versionParts(lastSeen)
      ? { version: lastSeen, atOrBefore: true }
      : { version: currentVersion, atOrBefore: false };
    localStorage.setItem(INSTALLED_VERSION_KEY, JSON.stringify(record));
  } catch {
    // Without storage nothing can be recorded; isUpgradedSince then keeps the marks hidden.
  }
}

/**
 * Whether this installation was using Tagify before `featureVersion`, the version a feature
 * arrived in. False for new installations and whenever it can't be told.
 */
export function isUpgradedSince(featureVersion: string, currentVersion: string): boolean {
  try {
    recordInstalledVersion(currentVersion);
    const installed = readInstalledVersion();
    const from = installed ? versionParts(installed.version) : null;
    const feature = versionParts(featureVersion);
    if (!installed || !from || !feature) return false;
    const order = compareVersions(from, feature);
    return order < 0 || (order === 0 && installed.atOrBefore);
  } catch {
    return false;
  }
}

/**
 * Whether this installation started on `currentVersion`: someone who just installed Tagify, as
 * opposed to someone who had an earlier version. True whenever it can't be told, so a new user is
 * never shown "what changed" popups meant for people who were already using Tagify.
 */
export function isNewInstallation(currentVersion: string): boolean {
  return !isUpgradedSince(currentVersion, currentVersion);
}
