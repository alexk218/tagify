import { COMMUNITY_ORIGIN } from "./communityLinks";

export const COMMUNITY_DEVICE_CREDENTIAL_KEY = "tagify:communityDeviceCredentialV1";

export interface CommunityDeviceCredentialV1 {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  profile?: {
    id?: string | null;
    handle: string | null;
    displayName: string | null;
  };
}

export interface CommunityProfileSummary {
  id?: string | null;
  handle: string | null;
  displayName: string | null;
}

export function readCommunityDeviceCredential(): CommunityDeviceCredentialV1 | null {
  try {
    const value = JSON.parse(localStorage.getItem(COMMUNITY_DEVICE_CREDENTIAL_KEY) || "null") as unknown;
    if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).accessToken !== "string") return null;
    return value as CommunityDeviceCredentialV1;
  } catch {
    return null;
  }
}

export function clearCommunityDeviceCredential(): void {
  localStorage.removeItem(COMMUNITY_DEVICE_CREDENTIAL_KEY);
}

export function writeCommunityDeviceCredential(credential: CommunityDeviceCredentialV1): void {
  localStorage.setItem(COMMUNITY_DEVICE_CREDENTIAL_KEY, JSON.stringify(credential));
}

export async function refreshCommunityDeviceProfile(): Promise<CommunityDeviceCredentialV1 | null> {
  const credential = readCommunityDeviceCredential();
  if (!credential?.accessToken) return null;
  const profile = await fetchCommunityProfile(credential.accessToken, communityDeviceFetch);
  if (!profile) return readCommunityDeviceCredential();
  const next = {
    ...(readCommunityDeviceCredential() ?? credential),
    profile,
  };
  writeCommunityDeviceCredential(next);
  return next;
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

export function sameCommunityProfile(
  left: CommunityProfileSummary | null | undefined,
  right: CommunityProfileSummary | null | undefined,
): boolean {
  if (!left?.handle || !right?.handle) return true;
  if (left.id && right.id) return left.id === right.id;
  return left.handle.toLowerCase() === right.handle.toLowerCase();
}

export async function communityDeviceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let credential = readCommunityDeviceCredential();
  if (!credential?.accessToken) return new Response(null, { status: 401 });
  const request = () => fetch(`${COMMUNITY_ORIGIN}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${credential!.accessToken}` },
  });
  let response = await request();
  if (response.status !== 401 || !credential.refreshToken) return response;
  const refresh = await fetch(`${COMMUNITY_ORIGIN}/api/v2/device/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: credential.refreshToken }),
  });
  if (!refresh.ok) {
    clearCommunityDeviceCredential();
    return response;
  }
  credential = await refresh.json() as CommunityDeviceCredentialV1;
  writeCommunityDeviceCredential(credential);
  response = await request();
  return response;
}
