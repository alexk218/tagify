import { useEffect, useState } from "react";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { isOnboardingPreviewActive } from "./onboardingPreview";

/**
 * Spotify accounts that may start the onboarding preview: the Tagify team only. Each entry is the
 * account's usage digest (SHA-256 of "tagify-usage-account-v1:" + Spotify username), never the
 * username itself.
 */
const ONBOARDING_PREVIEW_ACCOUNT_DIGESTS = new Set([
  "f4e49fd5b8f792647ef7054a3bbf85c88d9002875d6f7d65c77be364304565ec",
]);

export async function canUseOnboardingPreview(
  digest: () => Promise<string | null> = getUsageAccountDigest,
): Promise<boolean> {
  if (isOnboardingPreviewActive()) return true;
  const account = await digest();
  return account !== null && ONBOARDING_PREVIEW_ACCOUNT_DIGESTS.has(account);
}

/** Whether this Spotify account sees the onboarding preview controls. False until confirmed. */
export function useOnboardingPreviewAccess(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void canUseOnboardingPreview().then((result) => { if (!cancelled) setAllowed(result); });
    return () => { cancelled = true; };
  }, []);
  return allowed;
}
