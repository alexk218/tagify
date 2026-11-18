import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { REWIND_YEAR } from "./rewindPromptRules";

const SHOWN_PREFIX = `tagify:rewind-prompt:${REWIND_YEAR}:shown:`;

/** The prompt reappears on every Tagify open until answered, so it is reported at most once a day per account. */
export function recordRewindPromptShown(accountDigest: string, now = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(SHOWN_PREFIX + accountDigest) === day) return;
    localStorage.setItem(SHOWN_PREFIX + accountDigest, day);
  } catch { /* Reporting without the reminder only risks a repeat count. */ }
  recordProductInteraction("rewind_prompt_shown");
}

export const recordRewindPromptOpened = () => recordProductInteraction("rewind_prompt_opened");
