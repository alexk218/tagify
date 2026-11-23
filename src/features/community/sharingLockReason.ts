import { useSyncExternalStore } from "react";
import { publicTagSummary } from "./communityPublication";

/**
 * Why the give-to-get locks apply: "private" (tags not published) or "all-hidden" (published, but every
 * tag the member uses is hidden, which counts as private; Alex, 2026-11-23). app.tsx sets it; the locks
 * read it to say why they're locked without threading a prop through every list.
 */
export type SharingLockReason = "private" | "all-hidden";

let reason: SharingLockReason = "private";
const listeners = new Set<() => void>();

export function setSharingLockReason(next: SharingLockReason): void {
  if (next === reason) return;
  reason = next;
  listeners.forEach((listener) => listener());
}

export function useSharingLockReason(): SharingLockReason {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => reason, () => reason);
}

/** True when the member has tagged songs but their hidden choices hide every one of those tags. */
export function hidesEveryTag(
  tracks: Parameters<typeof publicTagSummary>[0],
  taxonomy: Parameters<typeof publicTagSummary>[1],
  policy: Parameters<typeof publicTagSummary>[2] | null,
): boolean {
  if (!policy || (!policy.hiddenTagIds.length && !policy.hiddenNodeIds.length)) return false;
  return publicTagSummary(tracks, taxonomy, policy).songs === 0 && publicTagSummary(tracks, taxonomy).songs > 0;
}

export const ALL_HIDDEN_LOCK = "All your tags are hidden, which counts as keeping them private.";
