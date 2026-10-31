export type CommunityEntityKind = "track" | "album" | "artist";

/**
 * Where the app talks to Community. Installed apps key their device secrets by this address, so it
 * stays community.tagify.fm, which keeps answering /api/** after Community moved to tagify.fm.
 */
export const COMMUNITY_ORIGIN = "https://community.tagify.fm";
/** Where Community's pages live: every link the app opens in a browser. */
export const COMMUNITY_PAGES_ORIGIN = "https://tagify.fm";
const SPOTIFY_URI = /^spotify:(track|album|artist):([A-Za-z0-9]{10,64})$/;

export function getCommunityHomeUrl(): string {
  return COMMUNITY_PAGES_ORIGIN;
}

export function getCommunityDisconnectUrl(accountId: string, deviceId: string): string {
  const parameters = new URLSearchParams({ account: accountId, device: deviceId });
  return `${COMMUNITY_PAGES_ORIGIN}/auth/disconnect?${parameters.toString()}`;
}

export function getCommunityEntityUrl(uri: string): string | null {
  const match = uri.match(SPOTIFY_URI);
  if (!match) return null;
  return `${COMMUNITY_PAGES_ORIGIN}/entity/${match[1] as CommunityEntityKind}/${match[2]}`;
}

export function openCommunityUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
