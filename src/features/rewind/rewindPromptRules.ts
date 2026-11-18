import { COMMUNITY_PAGES_ORIGIN } from "@/features/community/communityLinks";

export const REWIND_YEAR = 2026;
/** A smaller year gets no prompt: Community shows it one short card, which isn't worth an interruption. */
export const REWIND_MIN_SONGS = 20;
/** Noon UTC on December 8: the first moment it is December 8 everywhere, and when Community opens Rewind. */
export const REWIND_PROMPT_OPENS_AT = Date.UTC(REWIND_YEAR, 11, 8, 12);
/** `from` tells Community's own Rewind measurement that the visit came from this prompt. */
export const REWIND_URL = `${COMMUNITY_PAGES_ORIGIN}/library/rewind?from=desktop_prompt`;

/** From noon UTC on December 8 until December 31 ends on this device's clock. */
export function isRewindPromptSeason(now: number): boolean {
  return now >= REWIND_PROMPT_OPENS_AT && now < new Date(REWIND_YEAR + 1, 0, 1).getTime();
}

/**
 * Remembers, per Spotify account on this device, that the Rewind prompt was answered: "Not now"
 * or the button. Either one ends it for the year; it is never shown again.
 */
export const REWIND_PROMPT_ANSWERED_PREFIX = `tagify:rewind-prompt:${REWIND_YEAR}:answered:v1:`;

export function isRewindPromptAnswered(accountDigest: string): boolean {
  try { return localStorage.getItem(`${REWIND_PROMPT_ANSWERED_PREFIX}${accountDigest}`) === "1"; }
  catch { return false; }
}

export function answerRewindPrompt(accountDigest: string): void {
  try { localStorage.setItem(`${REWIND_PROMPT_ANSWERED_PREFIX}${accountDigest}`, "1"); }
  catch { /* The prompt still stays hidden for the rest of this session. */ }
}
