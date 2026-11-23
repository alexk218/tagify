import { getDesktopSyncConfiguration, sessionNeedsRefresh, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { COMMUNITY_ORIGIN } from "./communityLinks";

export interface CommunityProfileSummary {
  id?: string | null;
  handle: string | null;
  displayName: string | null;
}

export async function fetchCommunityProfile(
  accessToken: string,
  request: (path: string) => Promise<Response> = (path) => fetch(`${COMMUNITY_ORIGIN}${path}`, { headers: { authorization: `Bearer ${accessToken}` } }),
): Promise<CommunityProfileSummary | null> {
  const response = await request("/api/v2/device/profile");
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { profile?: { id?: unknown; handle?: unknown; displayName?: unknown } } | null;
  return {
    id: typeof body?.profile?.id === "string" ? body.profile.id : null,
    handle: typeof body?.profile?.handle === "string" ? body.profile.handle : null,
    displayName: typeof body?.profile?.displayName === "string" ? body.profile.displayName : null,
  };
}

/** Saves the Community handle on this device's connection the first time it is known. */
export async function hydrateSyncProfile(configuration: DesktopSyncConfiguration): Promise<DesktopSyncConfiguration | null> {
  // Sync may have refreshed the session since this view opened.
  const current = getDesktopSyncConfiguration();
  if (current?.deviceId !== configuration.deviceId) return null;
  // Community would refuse a session about to expire. Sync refreshes it, and
  // the next opening asks again.
  if (sessionNeedsRefresh(current)) return null;
  const profile = await fetchCommunityProfile(current.accessToken);
  if (!profile?.handle) return null;
  // Keep a session sync refreshed during the request.
  const latest = getDesktopSyncConfiguration();
  if (latest?.deviceId !== configuration.deviceId) return null;
  const next = { ...latest, profile };
  setDesktopSyncConfiguration(next);
  return next;
}

export function sameCommunityProfile(
  left: CommunityProfileSummary | null | undefined,
  right: CommunityProfileSummary | null | undefined,
): boolean {
  if (!left?.handle || !right?.handle) return true;
  if (left.id && right.id) return left.id === right.id;
  return left.handle.toLowerCase() === right.handle.toLowerCase();
}

/**
 * Whether the connected member still has to pick a handle: they connected inside Tagify (or on the
 * website's Connect page) before picking one (Community 9001_connect_before_handle). A known handle
 * is saved on the connection, as hydrateSyncProfile does. Null when Community couldn't be asked.
 */
export async function checkCommunityHandle(configuration: DesktopSyncConfiguration): Promise<{ handle: string | null; configuration: DesktopSyncConfiguration | null } | null> {
  if (configuration.profile?.handle) return { handle: configuration.profile.handle, configuration };
  const current = getDesktopSyncConfiguration();
  if (current?.deviceId !== configuration.deviceId || sessionNeedsRefresh(current)) return null;
  const profile = await fetchCommunityProfile(current.accessToken).catch(() => null);
  if (!profile) return null;
  if (!profile.handle) return { handle: null, configuration: null };
  return { handle: profile.handle, configuration: saveProfile(configuration, profile) };
}

export type HandleClaimErrorCode = "invalid_handle" | "handle_taken" | "handle_set" | "terms_required" | "unavailable";

export class HandleClaimError extends Error {
  constructor(readonly code: HandleClaimErrorCode, message: string) {
    super(message);
  }
}

/** The website's handle rules (3–30 lowercase letters, numbers or underscores), checked before asking Community. */
export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function handleProblem(handle: string): string | null {
  if (!handle) return "Pick a handle to publish your tags.";
  if (!/^[a-z0-9][a-z0-9_]{2,29}$/.test(handle)) return "Use 3–30 lowercase letters, numbers, or underscores.";
  return null;
}

/**
 * Picks the member's handle from Tagify (Alex, 2026-11-18: "In Tagify (Recommended)"). Pressing
 * Publish beside the Terms line is the member's agreement, as on the website's handle step. Saves the
 * profile on this computer's connection and returns it.
 */
export async function claimCommunityHandle(
  handle: string,
  request: (path: string, options: { method: "POST"; body: unknown }) => Promise<unknown> = (path, options) => syncRuntime.communityRequest(path, options),
): Promise<CommunityProfileSummary> {
  let body: { profile?: { id?: unknown; handle?: unknown; displayName?: unknown } };
  try {
    body = await request("/api/v2/device/profile", { method: "POST", body: { handle, acceptTerms: true } }) as typeof body;
  } catch (error) {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error && error.message ? error.message : "Your handle couldn't be saved. Try again.";
    if (status === 409 && /already has that handle/i.test(message)) throw new HandleClaimError("handle_taken", message);
    if (status === 409) throw new HandleClaimError("handle_set", message);
    if (status === 400 && /terms/i.test(message)) throw new HandleClaimError("terms_required", message);
    if (status === 400) throw new HandleClaimError("invalid_handle", message);
    throw new HandleClaimError("unavailable", "Your handle couldn't be saved. Try again.");
  }
  const profile: CommunityProfileSummary = {
    id: typeof body.profile?.id === "string" ? body.profile.id : null,
    handle: typeof body.profile?.handle === "string" ? body.profile.handle : handle,
    displayName: typeof body.profile?.displayName === "string" ? body.profile.displayName : handle,
  };
  const current = getDesktopSyncConfiguration();
  if (current) saveProfile(current, profile);
  window.dispatchEvent(new CustomEvent(COMMUNITY_HANDLE_CHANGED_EVENT, { detail: { profile } }));
  return profile;
}

/** Fired after the member picks a handle in Tagify, so every open view shows it. */
export const COMMUNITY_HANDLE_CHANGED_EVENT = "tagify:communityHandleChanged";

function saveProfile(configuration: DesktopSyncConfiguration, profile: CommunityProfileSummary): DesktopSyncConfiguration | null {
  // Keep a session sync refreshed during the request.
  const latest = getDesktopSyncConfiguration();
  if (latest?.deviceId !== configuration.deviceId) return null;
  const next = { ...latest, profile };
  setDesktopSyncConfiguration(next);
  return next;
}
