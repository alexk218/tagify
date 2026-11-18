import React, { useState } from "react";
import styles from "./OnboardingPreviewBanner.module.css";
import { exitOnboardingPreview, isOnboardingPreviewActive, startOnboardingPreview } from "./onboardingPreview";

/** Shown at the top of Tagify for the whole onboarding preview, with the way back to the real library. */
export function OnboardingPreviewBanner() {
  const [busy, setBusy] = useState(false);
  if (!isOnboardingPreviewActive()) return null;
  return (
    <div className={styles.banner} role="status">
      <span className={styles.label}>Onboarding preview</span>
      <span className={styles.text}>
        You&apos;re seeing Tagify as a brand-new user. Nothing you do here changes your real library.
      </span>
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={busy}
          onClick={() => { setBusy(true); startOnboardingPreview(); }}
        >
          Start over
        </button>
        <button
          className={`${styles.button} ${styles.primary}`}
          disabled={busy}
          onClick={() => { setBusy(true); exitOnboardingPreview(); }}
        >
          Exit preview
        </button>
      </div>
    </div>
  );
}
