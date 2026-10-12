/**
 * Remembers, per Spotify account, that the Community connection invitation was
 * declined. It stays on this device: Community's prompt-history endpoint only
 * accepts the prompts it already knows, so sending another one would fail the
 * whole request and stop the other prompts from being recovered.
 */
export const COMMUNITY_CONNECT_PROMPT_PREFIX = "tagify:community-connect-prompt:dismissed:v1:";

export function isCommunityConnectPromptDismissed(accountDigest: string): boolean {
  try { return localStorage.getItem(`${COMMUNITY_CONNECT_PROMPT_PREFIX}${accountDigest}`) === "1"; }
  catch { return false; }
}

export function dismissCommunityConnectPrompt(accountDigest: string): void {
  try { localStorage.setItem(`${COMMUNITY_CONNECT_PROMPT_PREFIX}${accountDigest}`, "1"); }
  catch { /* The invitation still stays hidden for the rest of this session. */ }
}
