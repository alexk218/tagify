import { useCallback, useState } from "react";
import packageJson from "@/package";
import { isUpgradedSince } from "@/features/onboarding/installedVersion";

const SEEN_PREFIX = "tagify:new-feature-seen:";

function hasSeen(feature: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + feature) !== null;
  } catch {
    // Without storage the highlight would come back every time, so it isn't shown at all.
    return true;
  }
}

/**
 * A one-time highlight on a new feature people would otherwise miss. It shows only to people who
 * used Tagify before `arrivedIn` (the version that brought the feature; for a new user everything
 * is new), only while `eligible` (the member can use the feature), and goes away for good once
 * dismissed on this computer.
 */
export function useNewFeatureHighlight(feature: string, eligible: boolean, arrivedIn: string): { show: boolean; dismiss: () => void } {
  const [seen, setSeen] = useState(() => hasSeen(feature) || !isUpgradedSince(arrivedIn, packageJson.version));
  const dismiss = useCallback(() => {
    setSeen(true);
    try {
      localStorage.setItem(SEEN_PREFIX + feature, new Date().toISOString());
    } catch {
      // Storage is unavailable; the highlight stays hidden for this session.
    }
  }, [feature]);
  return { show: eligible && !seen, dismiss };
}
