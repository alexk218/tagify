import { PRIVATE_SYNC_PROTOCOL_VERSION } from "@tagify/sync-contracts";
import packageJson from "@/package";
import {
  getDesktopSyncConfiguration,
  setDesktopSyncConfiguration,
  type DesktopSyncConfiguration,
} from "./SyncLocalState";

const COMMUNITY_ORIGIN = "https://community.tagify.fm";
const RECOVERY_ENROLLMENT_MARKER_PREFIX =
  "tagify:sync:account-recovery-v2:";
const INSTALL_RECOVERY_SECRET_PATTERN = /^tgfy_install_[A-Za-z0-9_-]{43}$/;
const RECOVERY_REENROLL_MS = 30 * 24 * 60 * 60_000;
const SPOTIFY_TOKEN_WAIT_MS = 3_000;
const SYNC_CLIENT_GENERATION = "event-driven-v1";
/**
 * Set when Community definitively finds no approved device for this
 * installation. Spotify updates that wipe the WebView storage also remove it,
 * so recovery after a wipe still runs on the next start.
 */
export const RECOVERY_UNAVAILABLE_UNTIL_KEY = "tagify:sync:recovery-unavailable-until";
export const RECOVERY_UNAVAILABLE_SKIP_MS = 7 * 24 * 60 * 60_000;

declare global {
  interface Window {
    __tagifyInstallRecoveryKey?: string;
    __tagifyInstallRecoveryPromise?: Promise<DesktopSyncConfiguration | null>;
  }
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

export async function enrollDesktopRecovery(
  configuration: DesktopSyncConfiguration,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const recoverySecret = getInstallRecoverySecret();
  const spotifyAccessToken = await waitForSpotifyAccessToken();
  if (!recoverySecret && !spotifyAccessToken) return false;

  // Startup may still hold yesterday's Community token. Normal sync refreshes
  // it; enrolling with the stale token only creates a misleading 401.
  const storedConfiguration = getDesktopSyncConfiguration();
  const activeConfiguration = storedConfiguration?.deviceId === configuration.deviceId
    ? storedConfiguration
    : configuration;
  if (activeConfiguration.expiresAt * 1_000 - Date.now() <= 60_000) return false;

  const markerKey = `${RECOVERY_ENROLLMENT_MARKER_PREFIX}${configuration.deviceId}`;
  try {
    const lastEnrolledAt = Number(localStorage.getItem(markerKey));
    if (
      Number.isFinite(lastEnrolledAt) &&
      lastEnrolledAt > 0 &&
      lastEnrolledAt <= Date.now() &&
      Date.now() - lastEnrolledAt < RECOVERY_REENROLL_MS
    ) {
      return true;
    }
  } catch {
    // Enrollment still works when Spotify temporarily blocks localStorage.
  }

  try {
    const response = await request(
      `${configuration.apiBaseUrl}/api/v2/device-recovery/enroll`,
      {
        method: "POST",
        headers: {
          ...syncRecoveryHeaders(activeConfiguration.accessToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deviceId: configuration.deviceId,
          ...(recoverySecret ? { recoverySecret } : {}),
          ...(spotifyAccessToken ? { spotifyAccessToken } : {}),
        }),
      },
    );
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as {
      methods?: { spotify?: unknown };
    } | null;
    // The v2 marker means the installer-independent Spotify identity is also
    // enrolled. Until that succeeds, retry safely on a later launch.
    if (!spotifyAccessToken || body?.methods?.spotify !== true) return false;
    try {
      localStorage.setItem(markerKey, String(Date.now()));
    } catch {
      // A missing marker only causes a safe enrollment retry next launch.
    }
    return true;
  } catch {
    return false;
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

  const recoverySecret = getInstallRecoverySecret();
  // An installer recovery secret is always checked. Without one, a recent
  // definitive "nothing to recover" answer skips the request (and the wait for
  // Spotify's token) on every start for a week.
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
      // rate limits, and malformed requests are retried on the next start.
      if (response.status === 401) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
        if (body?.error?.code === "invalid_grant") rememberRecoveryUnavailable();
      }
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const next = configurationFromRecovery(body);
    if (!next) return null;

    clearRecoveryUnavailable();
    setDesktopSyncConfiguration(next);
    await enrollDesktopRecovery(next);
    window.dispatchEvent(
      new CustomEvent("tagify:syncStatus", { detail: { status: "idle" } }),
    );
    return next;
  } catch {
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
