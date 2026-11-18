import React from "react";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the Community invitations
import promptStyles from "../community/CommunityConnectPrompt.module.css";
import { ANDROID_APP_QR } from "./phoneAppLinks";
import { PhoneAppQr } from "./PhoneAppPanel";

/** Shown once to people who asked to hear when the Android app is out. */
export function AndroidReleaseNotice({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <section className={`${promptStyles.prompt} ${promptStyles.connect}`} aria-labelledby="android-notice-title" aria-describedby="android-notice-description">
      <PhoneAppQr code={ANDROID_APP_QR} label="QR code for Tagify on Google Play" size={88} />
      <div className={promptStyles.text}>
        <h2 id="android-notice-title" className={promptStyles.title}>The Tagify Android app is out</h2>
        <p id="android-notice-description" className={promptStyles.description}>
          You asked us to tell you. Point your phone camera at the code, or open Google Play.
        </p>
      </div>
      <div className={promptStyles.actions}>
        <button type="button" className={promptStyles.secondary} onClick={onDismiss}>Close</button>
        <button type="button" className={promptStyles.primary} onClick={onOpen}>Open Google Play</button>
      </div>
    </section>
  );
}
