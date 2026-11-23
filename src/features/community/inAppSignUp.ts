import { isOnboardingPreviewActive } from "@/features/onboarding/preview/onboardingPreview";

/**
 * Client switch for signing in or creating a Tagify account inside Tagify (email + 6-digit code)
 * instead of on the browser page. On since Community's in-app sign-in routes reached production (2026-11-19);
 * `localStorage["tagify:switch:in-app-sign-up"] = "off"` turns it off on one computer.
 */
export const IN_APP_SIGN_UP_SWITCH_KEY = "tagify:switch:in-app-sign-up";
const IN_APP_SIGN_UP_DEFAULT = true;

export function isInAppSignUpEnabled(): boolean {
  // The onboarding preview always shows sign-up inside Tagify, the way new members see it.
  if (isOnboardingPreviewActive()) return true;
  try {
    const override = localStorage.getItem(IN_APP_SIGN_UP_SWITCH_KEY);
    if (override === "on") return true;
    if (override === "off") return false;
  } catch {
    // Storage unavailable: fall back to the default.
  }
  return IN_APP_SIGN_UP_DEFAULT;
}
