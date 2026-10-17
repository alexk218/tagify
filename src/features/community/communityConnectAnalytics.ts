import { recordProductInteraction, type ProductEventDetails } from "@/features/product-analytics/productAnalytics";
import type { PairingRelationship } from "@/services/sync/SyncPairingService";

/** Where the member chose to connect from: the invitation banner, the Community screen or the Sync dialog. */
export type CommunityConnectEntry = NonNullable<ProductEventDetails["entry"]>;

const PROMPT_SHOWN_PREFIX = "tagify:community-connect-prompt-shown:";
/** The attempt in progress. Approval happens in the browser, so it can finish in a later Tagify session. */
const ATTEMPT_KEY = "tagify:community-connect-attempt:v1";
const ENTRIES: readonly CommunityConnectEntry[] = ["prompt", "community", "sync"];
const RELATIONSHIPS: Record<PairingRelationship, NonNullable<ProductEventDetails["relationship"]>> = {
  "first-link": "first_link",
  reconnect: "reconnect",
  "account-switch": "account_switch",
};

interface Attempt { entry: CommunityConnectEntry; finishFailed?: true }
let untrackedFinishFailed = false;

function readAttempt(): Attempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(ATTEMPT_KEY) || "null");
    return value && ENTRIES.includes(value.entry) ? { entry: value.entry, ...(value.finishFailed === true ? { finishFailed: true } : {}) } : null;
  } catch { return null; }
}

function writeAttempt(attempt: Attempt | null): void {
  try {
    if (attempt) localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
    else localStorage.removeItem(ATTEMPT_KEY);
  } catch { /* Losing the attempt only attributes its outcome to the current screen. */ }
}

/** The banner reappears on every Tagify open until answered, so it is reported at most once a day per account. */
export function recordCommunityConnectPromptShown(accountDigest: string, now = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(PROMPT_SHOWN_PREFIX + accountDigest) === day) return;
    localStorage.setItem(PROMPT_SHOWN_PREFIX + accountDigest, day);
  } catch { /* Reporting without the reminder only risks a repeat count. */ }
  recordProductInteraction("community_connect_prompt_shown");
}

export const recordCommunityConnectPromptDismissed = () => recordProductInteraction("community_connect_prompt_dismissed");

export const recordCommunitySetupOpened = (entry: CommunityConnectEntry) => recordProductInteraction("community_setup_opened", { entry });

/** Community issued an approval code, so the member was sent to the browser to approve it. */
export function recordCommunityConnectStarted(entry: CommunityConnectEntry): void {
  untrackedFinishFailed = false;
  writeAttempt({ entry });
  recordProductInteraction("community_connect_started", { entry });
}

export function recordCommunityConnectStartFailed(entry: CommunityConnectEntry): void {
  recordProductInteraction("community_connect_failed", { entry, stage: "start" });
}

/** Checking the approval can fail on every poll, so a failure is reported once per attempt. */
export function recordCommunityConnectFinishFailed(entry: CommunityConnectEntry): void {
  const attempt = readAttempt();
  if (attempt ? attempt.finishFailed : untrackedFinishFailed) return;
  if (attempt) writeAttempt({ ...attempt, finishFailed: true });
  else untrackedFinishFailed = true;
  recordProductInteraction("community_connect_failed", { entry: attempt?.entry ?? entry, stage: "finish" });
}

/** The connection is saved on this device. Credited to the screen where the attempt started. */
export function recordCommunityConnectCompleted(entry: CommunityConnectEntry, relationship: PairingRelationship): void {
  const attempt = readAttempt();
  writeAttempt(null);
  untrackedFinishFailed = false;
  recordProductInteraction("community_connect_completed", { entry: attempt?.entry ?? entry, relationship: RELATIONSHIPS[relationship] });
}
