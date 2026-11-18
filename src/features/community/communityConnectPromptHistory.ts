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

/** A lost connection matters more, so "Not now" only pauses that reminder for a week. */
export const COMMUNITY_RECONNECT_PROMPT_PREFIX = "tagify:community-reconnect-prompt:snoozed-until:v1:";
export const COMMUNITY_RECONNECT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export function isCommunityReconnectPromptSnoozed(accountDigest: string, now = Date.now()): boolean {
  try {
    const until = Number(localStorage.getItem(`${COMMUNITY_RECONNECT_PROMPT_PREFIX}${accountDigest}`));
    return Number.isFinite(until) && until > now;
  } catch { return false; }
}

export function snoozeCommunityReconnectPrompt(accountDigest: string, now = Date.now()): void {
  try { localStorage.setItem(`${COMMUNITY_RECONNECT_PROMPT_PREFIX}${accountDigest}`, String(now + COMMUNITY_RECONNECT_SNOOZE_MS)); }
  catch { /* The reminder still stays hidden for the rest of this session. */ }
}
