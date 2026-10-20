import { PRIVATE_SYNC_PROTOCOL_VERSION } from "@tagify/sync-contracts";
import packageJson from "@/package";
import {
  getDesktopSyncConfiguration,
  sessionNeedsRefresh,
  setDesktopSyncConfiguration,
  type DesktopSyncConfiguration,
} from "./SyncLocalState";
import { backoffDelayMs, retryAfterSeconds, type BackoffPolicy } from "./SyncRetryAfter";

const COMMUNITY_ORIGIN = "https://community.tagify.fm";
/** Set by Tagify 3.0–3.3 once both proofs were enrolled; read once to keep those enrollments. */
const LEGACY_ENROLLMENT_MARKER_PREFIX = "tagify:sync:account-recovery-v2:";
/** Per device: which proofs Community holds, and when a failed enrollment may be tried again. */
export const RECOVERY_ENROLLMENT_PREFIX = "tagify:sync:recovery-enrollment-v3:";
const INSTALL_RECOVERY_SECRET_PATTERN = /^tgfy_install_[A-Za-z0-9_-]{43}$/;
const SPOTIFY_TOKEN_WAIT_MS = 3_000;
const SYNC_CLIENT_GENERATION = "event-driven-v1";
/**
 * Set when Community definitively finds no approved device for this
 * installation. Spotify updates that wipe the WebView storage also remove it,
 * so recovery after a wipe still runs on the next start.
 */
export const RECOVERY_UNAVAILABLE_UNTIL_KEY = "tagify:sync:recovery-unavailable-until";
export const RECOVERY_UNAVAILABLE_SKIP_MS = 7 * 24 * 60 * 60_000;
/**
 * Set when Community could not answer a reconnection: until then no start or
 * page opening asks again. A 503 or 429 names the wait in Retry-After; other
 * failures double it from a minute up to an hour.
 */
export const RECOVERY_RETRY_KEY = "tagify:sync:recovery-retry";
export const RECOVERY_BACKOFF: BackoffPolicy = { baseMs: 60_000, maxMs: 60 * 60_000, maxRetryAfterMs: 6 * 60 * 60_000 };
/** Enrollment matters only if this device later loses its link, so failed attempts wait longer. */
export const ENROLLMENT_BACKOFF: BackoffPolicy = { baseMs: 60 * 60_000, maxMs: 24 * 60 * 60_000, maxRetryAfterMs: 24 * 60 * 60_000 };

declare global {
  interface Window {
    __tagifyInstallRecoveryKey?: string;
    __tagifyInstallRecoveryPromise?: Promise<DesktopSyncConfiguration | null>;
    /** Community said this installation has nothing to recover; set for the rest of this Spotify session. */
    __tagifyInstallRecoveryRejected?: boolean;
    /** Enrollments in progress, by device, shared by Tagify's page and background bundles. */
    __tagifyRecoveryEnrollments?: Map<string, Promise<boolean>>;
  }
}

interface RetryRecord { until: number; failures: number }

interface EnrollmentRecord {
  /** Fingerprint of the installer proof Community holds for this device. */
  installation?: string;
  /** Fingerprint of the Spotify account Community holds for this device; "unknown" when Spotify didn't name it. */
  spotify?: string;
  /** After `failures` failed attempts in a row, no automatic enrollment before this time. */
  retryAt?: number;
  failures?: number;
}

export function getInstallRecoverySecret(): string | null {
  const value = window.__tagifyInstallRecoveryKey;
  return typeof value === "string" && INSTALL_RECOVERY_SECRET_PATTERN.test(value)
    ? value
    : null;
}

function recoveryRecentlyUnavailable(now = Date.now()): boolean {
  try {
    const until = Number(localStorage.getItem(RECOVERY_UNAVAILABLE_UNTIL_KEY));
    return Number.isFinite(until) && until > now && until - now <= RECOVERY_UNAVAILABLE_SKIP_MS;
  } catch {
    return false;
  }
}

function rememberRecoveryUnavailable(): void {
  try {
    localStorage.setItem(RECOVERY_UNAVAILABLE_UNTIL_KEY, String(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS));
  } catch {
    // Without the marker the next start simply checks again.
  }
}

/** Lets the next Spotify start check for automatic reconnection again. */
export function clearRecoveryUnavailable(): void {
  try {
    localStorage.removeItem(RECOVERY_UNAVAILABLE_UNTIL_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

function readRetry(): RetryRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(RECOVERY_RETRY_KEY) || "null") as Partial<RetryRecord> | null;
    if (!value || !Number.isFinite(value.until) || !Number.isSafeInteger(value.failures)) return null;
    return { until: Number(value.until), failures: Math.max(0, Number(value.failures)) };
  } catch {
    return null;
  }
}

/** Whether an earlier answer still says to wait. A clock moved backwards can't extend the wait. */
function recoveryRetryPending(now = Date.now()): boolean {
  const retry = readRetry();
  return Boolean(retry) && retry!.until > now && retry!.until - now <= RECOVERY_BACKOFF.maxRetryAfterMs;
}

function noteRecoveryFailure(retryAfter: number | null): void {
  const failures = (readRetry()?.failures ?? 0) + 1;
  try {
    localStorage.setItem(RECOVERY_RETRY_KEY, JSON.stringify({ until: Date.now() + backoffDelayMs(failures, retryAfter, RECOVERY_BACKOFF), failures }));
  } catch {
    // This Spotify session still stops asking: the next request needs a new start.
  }
}

function clearRecoveryRetry(): void {
  try {
    localStorage.removeItem(RECOVERY_RETRY_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/**
 * Restores only the device session. Library data remains in its account-scoped
 * IndexedDB database or is recovered through the normal confirmed cloud flow.
 */
export function restoreDesktopSyncConfiguration(): Promise<DesktopSyncConfiguration | null> {
  const existing = window.__tagifyInstallRecoveryPromise;
  if (existing) return existing;

  const pending = restoreOrEnroll().finally(() => {
    delete window.__tagifyInstallRecoveryPromise;
  });
  window.__tagifyInstallRecoveryPromise = pending;
  return pending;
}

/**
 * Saves this installation's recovery proofs with Community: the installer's
 * proof and the signed-in Spotify account. Each is sent only when Community
 * doesn't hold it for this device yet (a new device, proof or Spotify
 * account), and a failed attempt waits as Community asked or backs off.
 */
export function enrollDesktopRecovery(
  configuration: DesktopSyncConfiguration,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const enrollments = (window.__tagifyRecoveryEnrollments ??= new Map());
  const existing = enrollments.get(configuration.deviceId);
  if (existing) return existing;
  const pending = enroll(configuration, request).finally(() => {
    enrollments.delete(configuration.deviceId);
  });
  enrollments.set(configuration.deviceId, pending);
  return pending;
}

async function enroll(configuration: DesktopSyncConfiguration, request: typeof fetch): Promise<boolean> {
  const recoverySecret = getInstallRecoverySecret();
  const installation = recoverySecret ? await fingerprint(`installation:${recoverySecret}`) : null;
  const spotifyAccount = currentSpotifyAccountName();
  const spotify = spotifyAccount ? await fingerprint(`spotify:${spotifyAccount}`) : null;
  const key = `${RECOVERY_ENROLLMENT_PREFIX}${configuration.deviceId}`;
  let record = readEnrollment(key);
  if (!record && legacyEnrollmentConfirmed(configuration.deviceId)) {
    // Tagify before 3.3.2 marked a device once Community held both proofs.
    record = { ...(installation ? { installation } : {}), spotify: spotify ?? "unknown" };
    writeEnrollment(key, record);
  }
  record ??= {};

  const sendInstallation = Boolean(installation) && record.installation !== installation;
  // Without Spotify's account name, an account enrolled before is kept.
  const sendSpotify = spotify ? record.spotify !== spotify : !record.spotify;
  if (!sendInstallation && !sendSpotify) return true;
  const now = Date.now();
  if (record.retryAt && record.retryAt > now && record.retryAt - now <= ENROLLMENT_BACKOFF.maxRetryAfterMs) return false;

  const spotifyAccessToken = sendSpotify ? await waitForSpotifyAccessToken() : null;
  if (!sendInstallation && !spotifyAccessToken) return false;

  // Startup may still hold yesterday's Community token. Sync refreshes it and
  // enrolls again; enrolling with the stale token only creates a misleading 401.
  const storedConfiguration = getDesktopSyncConfiguration();
  const activeConfiguration = storedConfiguration?.deviceId === configuration.deviceId
    ? storedConfiguration
    : configuration;
  if (sessionNeedsRefresh(activeConfiguration)) return false;

  let response: Response;
  try {
    response = await request(
      `${configuration.apiBaseUrl}/api/v2/device-recovery/enroll`,
      {
        method: "POST",
        headers: {
          ...syncRecoveryHeaders(activeConfiguration.accessToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deviceId: configuration.deviceId,
          ...(sendInstallation ? { recoverySecret } : {}),
          ...(spotifyAccessToken ? { spotifyAccessToken } : {}),
        }),
      },
    );
  } catch {
    writeEnrollment(key, failedEnrollment(record, null));
    return false;
  }
  if (!response.ok) {
    writeEnrollment(key, failedEnrollment(record, retryAfterSeconds(response.headers.get("retry-after"))));
    return false;
  }
  const body = (await response.json().catch(() => null)) as {
    methods?: { installation?: unknown; spotify?: unknown };
  } | null;
  const next: EnrollmentRecord = {
    ...(record.installation ? { installation: record.installation } : {}),
    ...(record.spotify ? { spotify: record.spotify } : {}),
  };
  if (sendInstallation && installation && body?.methods?.installation === true) next.installation = installation;
  if (spotifyAccessToken && body?.methods?.spotify === true) next.spotify = spotify ?? "unknown";
  const installationSaved = !sendInstallation || next.installation === installation;
  const spotifySaved = !sendSpotify || next.spotify === (spotify ?? "unknown");
  // Spotify's session wasn't ready yet: nothing failed, so the next start or
  // session refresh sends the account.
  const spotifyNotSent = sendSpotify && !spotifyAccessToken;
  // Otherwise Spotify couldn't confirm the account (Community still saved the
  // installer proof): that part waits for the back-off, not the next start.
  writeEnrollment(key, installationSaved && (spotifySaved || spotifyNotSent) ? next : failedEnrollment(next, null, record.failures));
  return installationSaved && spotifySaved;
}

function failedEnrollment(record: EnrollmentRecord, retryAfter: number | null, previousFailures = record.failures): EnrollmentRecord {
  const failures = (previousFailures ?? 0) + 1;
  return {
    ...(record.installation ? { installation: record.installation } : {}),
    ...(record.spotify ? { spotify: record.spotify } : {}),
    failures,
    retryAt: Date.now() + backoffDelayMs(failures, retryAfter, ENROLLMENT_BACKOFF),
  };
}

function readEnrollment(key: string): EnrollmentRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as EnrollmentRecord | null;
    if (!value || typeof value !== "object") return null;
    return {
      ...(typeof value.installation === "string" ? { installation: value.installation } : {}),
      ...(typeof value.spotify === "string" ? { spotify: value.spotify } : {}),
      ...(Number.isFinite(value.retryAt) ? { retryAt: Number(value.retryAt) } : {}),
      ...(Number.isSafeInteger(value.failures) ? { failures: Number(value.failures) } : {}),
    };
  } catch {
    return null;
  }
}

function writeEnrollment(key: string, record: EnrollmentRecord): void {
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Enrollment still worked; without the record a later start sends it again.
  }
}

function legacyEnrollmentConfirmed(deviceId: string): boolean {
  try {
    const enrolledAt = Number(localStorage.getItem(`${LEGACY_ENROLLMENT_MARKER_PREFIX}${deviceId}`));
    return Number.isFinite(enrolledAt) && enrolledAt > 0;
  } catch {
    return false;
  }
}

/** A short digest, so the saved record can tell proofs and accounts apart without holding them. */
async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tagify-recovery-enrollment-v1:${value}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function currentSpotifyAccountName(): string | null {
  try {
    const platform = Spicetify.Platform as typeof Spicetify.Platform & { UserAPI?: { _user?: { username?: unknown } } };
    const username = platform?.username ?? platform?.UserAPI?._user?.username;
    return typeof username === "string" && username.trim() ? username : null;
  } catch {
    return null;
  }
}

async function restoreOrEnroll(): Promise<DesktopSyncConfiguration | null> {
  const configuration = getDesktopSyncConfiguration();
  if (configuration) {
    // Existing users can start immediately while their installer-independent
    // recovery identity is enrolled in the background.
    void enrollDesktopRecovery(configuration);
    return configuration;
  }

  // Each Spotify start asks at most once: Community already answered that
  // nothing can be recovered, or asked to wait (Retry-After), or failed and
  // is backed off. Opening Tagify again, or any timer, never repeats it.
  if (window.__tagifyInstallRecoveryRejected || recoveryRetryPending()) return null;
  const recoverySecret = getInstallRecoverySecret();
  // An installer recovery secret is checked on every start. Without one, a
  // recent definitive "nothing to recover" answer skips the request (and the
  // wait for Spotify's token) on every start for a week.
  if (!recoverySecret && recoveryRecentlyUnavailable()) return null;
  const spotifyAccessToken = recoverySecret
    ? currentSpotifyAccessToken()
    : await waitForSpotifyAccessToken();
  if ((!recoverySecret && !spotifyAccessToken) || !navigator.onLine) return null;

  try {
    const response = await fetch(`${COMMUNITY_ORIGIN}/api/v2/device-recovery/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(recoverySecret ? { recoverySecret } : {}),
        ...(spotifyAccessToken ? { spotifyAccessToken } : {}),
        name: deviceName(),
        platform: navigator.platform || "Spotify desktop",
      }),
    });
    if (!response.ok) {
      // Only an explicit rejection means no approved device exists. Outages,
      // rate limits and malformed requests wait as Community asked, or back off.
      const body = response.status === 401
        ? (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null
        : null;
      if (body?.error?.code === "invalid_grant") {
        rememberRecoveryUnavailable();
        clearRecoveryRetry();
        window.__tagifyInstallRecoveryRejected = true;
      } else {
        noteRecoveryFailure(retryAfterSeconds(response.headers.get("retry-after")));
      }
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const next = configurationFromRecovery(body);
    if (!next) {
      noteRecoveryFailure(null);
      return null;
    }

    clearRecoveryUnavailable();
    clearRecoveryRetry();
    setDesktopSyncConfiguration(next);
    await enrollDesktopRecovery(next);
    window.dispatchEvent(
      new CustomEvent("tagify:syncStatus", { detail: { status: "idle" } }),
    );
    return next;
  } catch {
    noteRecoveryFailure(null);
    return null;
  }
}

function currentSpotifyAccessToken(): string | null {
  try {
    const authorizationToken =
      Spicetify.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken;
    const playlistToken = (
      Spicetify.Platform.PlaylistAPI as typeof Spicetify.Platform.PlaylistAPI & {
        _builder?: { _accessToken?: unknown };
      }
    )?._builder?._accessToken;
    const value = authorizationToken || playlistToken;
    return typeof value === "string" &&
      value.length >= 16 &&
      value.length <= 4_096 &&
      !/\s/.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function waitForSpotifyAccessToken(): Promise<string | null> {
  const deadline = Date.now() + SPOTIFY_TOKEN_WAIT_MS;
  let accessToken = currentSpotifyAccessToken();
  while (!accessToken && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    accessToken = currentSpotifyAccessToken();
  }
  return accessToken;
}

function configurationFromRecovery(
  body: Record<string, unknown>,
): DesktopSyncConfiguration | null {
  const required = [
    "libraryId",
    "deviceId",
    "supabaseUrl",
    "supabasePublishableKey",
    "accessToken",
    "refreshToken",
  ] as const;
  if (required.some((key) => typeof body[key] !== "string" || !body[key])) {
    return null;
  }
  if (typeof body.expiresAt !== "number" || !Number.isFinite(body.expiresAt)) {
    return null;
  }
  const accountId = decodeJwtSubject(body.accessToken as string);
  if (!accountId) return null;

  return {
    accountId,
    libraryId: body.libraryId as string,
    deviceId: body.deviceId as string,
    apiBaseUrl: COMMUNITY_ORIGIN,
    supabaseUrl: body.supabaseUrl as string,
    supabasePublishableKey: body.supabasePublishableKey as string,
    accessToken: body.accessToken as string,
    refreshToken: body.refreshToken as string,
    expiresAt: body.expiresAt,
  };
}

function decodeJwtSubject(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const claims = JSON.parse(atob(normalized)) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

function syncRecoveryHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "x-tagify-client-version": packageJson.version,
    "x-tagify-sync-protocol": String(PRIVATE_SYNC_PROTOCOL_VERSION),
    "x-tagify-sync-generation": SYNC_CLIENT_GENERATION,
  };
}

function deviceName(): string {
  return `Tagify on ${
    navigator.userAgent.includes("Mac")
      ? "Mac"
      : navigator.userAgent.includes("Windows")
        ? "Windows"
        : "desktop"
  }`;
}
