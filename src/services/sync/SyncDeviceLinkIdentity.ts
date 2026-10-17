import { getInstallRecoverySecret } from "./SyncInstallRecovery";

const COMMUNITY_ORIGIN = "https://community.tagify.fm";
const SECRET_PREFIX = "tagify:sync:device-link-secret:";
const SECRET_PATTERN = /^tgfy_link_[A-Za-z0-9_-]{43}$/;

/** Private linking proof, never part of library data or exported backups. */
export function getDeviceLinkSecret(apiBaseUrl: string): string | null {
  const origin = new URL(apiBaseUrl).origin;
  const installerSecret = origin === COMMUNITY_ORIGIN ? getInstallRecoverySecret() : null;
  if (installerSecret) return installerSecret;

  // Manual installs keep their identity through disconnects and account switches.
  // Scope it to the server so a different server never receives Community's proof.
  try {
    const key = `${SECRET_PREFIX}${origin}`;
    const existing = localStorage.getItem(key);
    if (existing && SECRET_PATTERN.test(existing)) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = `tgfy_link_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    localStorage.setItem(key, secret);
    return secret;
  } catch {
    // Linking still works when Spotify blocks storage, without an unstable proof.
    return null;
  }
}
