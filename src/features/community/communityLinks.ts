export type CommunityEntityKind = "track" | "album" | "artist";

export const COMMUNITY_ORIGIN = "https://community.tagify.fm";
const SPOTIFY_URI = /^spotify:(track|album|artist):([A-Za-z0-9]{10,64})$/;

export function getCommunityHomeUrl(): string {
  return COMMUNITY_ORIGIN;
}

export function getCommunityDisconnectUrl(accountId: string, deviceId: string): string {
  const parameters = new URLSearchParams({ account: accountId, device: deviceId });
  return `${COMMUNITY_ORIGIN}/auth/disconnect?${parameters.toString()}`;
}

export function getCommunityEntityUrl(uri: string): string | null {
  const match = uri.match(SPOTIFY_URI);
  if (!match) return null;
  return `${COMMUNITY_ORIGIN}/entity/${match[1] as CommunityEntityKind}/${match[2]}`;
}

export function openCommunityUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
