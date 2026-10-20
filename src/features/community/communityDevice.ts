import { getDesktopSyncConfiguration, sessionNeedsRefresh, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
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
