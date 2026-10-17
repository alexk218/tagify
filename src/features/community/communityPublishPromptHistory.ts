import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";

/**
 * Remembers, per Spotify account, how often Tagify invited a connected member
 * to publish and whether they have since chosen. Like the connect invitation,
 * it stays on this device (see communityConnectPromptHistory.ts).
 */
export const COMMUNITY_PUBLISH_PROMPT_PREFIX = "tagify:community-publish-prompt:v1:";
/** One invitation and one reminder, then never again. */
export const COMMUNITY_PUBLISH_PROMPT_MAX_ASKS = 2;
export const COMMUNITY_PUBLISH_PROMPT_REMINDER_DAYS = 14;

export interface CommunityPublishPromptHistory {
  asks: number;
  lastAskedAt?: string;
  decided?: boolean;
}

export function readCommunityPublishPromptHistory(accountDigest: string): CommunityPublishPromptHistory {
  try {
    const value = JSON.parse(localStorage.getItem(`${COMMUNITY_PUBLISH_PROMPT_PREFIX}${accountDigest}`) || "null");
    if (!value || typeof value !== "object") return { asks: 0 };
    return {
      asks: Number.isSafeInteger(value.asks) && value.asks > 0 ? value.asks : 0,
      lastAskedAt: typeof value.lastAskedAt === "string" ? value.lastAskedAt : undefined,
      decided: value.decided === true || undefined,
    };
  } catch { return { asks: 0 }; }
}

function write(accountDigest: string, history: CommunityPublishPromptHistory): void {
  try { localStorage.setItem(`${COMMUNITY_PUBLISH_PROMPT_PREFIX}${accountDigest}`, JSON.stringify(history)); }
  catch { /* The invitation still stays hidden for the rest of this session. */ }
}

export function canAskToPublish(history: CommunityPublishPromptHistory, now = Date.now()): boolean {
  if (history.decided || history.asks >= COMMUNITY_PUBLISH_PROMPT_MAX_ASKS) return false;
  if (history.asks === 0) return true;
  const lastAsked = Date.parse(history.lastAskedAt || "");
  // A missing or future date can't prove the reminder is due, so wait rather than ask early.
  if (!Number.isFinite(lastAsked) || lastAsked > now) return false;
  return now - lastAsked >= COMMUNITY_PUBLISH_PROMPT_REMINDER_DAYS * 86_400_000;
}

/** Returns the updated history; `asks` is 1 for the first invitation and 2 for the reminder. */
export function recordCommunityPublishPromptAsk(accountDigest: string, now = Date.now()): CommunityPublishPromptHistory {
  const current = readCommunityPublishPromptHistory(accountDigest);
  const next = { ...current, asks: current.asks + 1, lastAskedAt: new Date(now).toISOString() };
  write(accountDigest, next);
  return next;
}

export function markCommunityPublishPromptDecidedFor(accountDigest: string): void {
  write(accountDigest, { ...readCommunityPublishPromptHistory(accountDigest), decided: true });
}

/** Publishing or keeping tags private, from anywhere in Tagify, ends the invitations. */
export function markCommunityPublishPromptDecided(): void {
  void getUsageAccountDigest().then((digest) => {
    if (digest) markCommunityPublishPromptDecidedFor(digest);
  }).catch(() => { /* The server state still stops the invitation next time it is checked. */ });
}
