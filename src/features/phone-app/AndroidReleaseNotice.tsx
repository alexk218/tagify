import React from "react";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the Community invitations
import promptStyles from "../community/CommunityConnectPrompt.module.css";
import { ANDROID_APP_QR } from "./phoneAppLinks";
import { PhoneAppQr } from "./PhoneAppPanel";

/** Shown once to people who asked to hear when the Android app is out. */
interface AndroidReleaseNoticeProps {
  /** Whether this computer is connected to a Tagify account, which the app signs in with. */
  connected: boolean;
  onConnect: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}

export function AndroidReleaseNotice({ connected, onConnect, onOpen, onDismiss }: AndroidReleaseNoticeProps) {
  return (
    <section className={`${promptStyles.prompt} ${promptStyles.connect}`} aria-labelledby="android-notice-title" aria-describedby="android-notice-description">
      <PhoneAppQr code={ANDROID_APP_QR} label="QR code for Tagify on Google Play" size={88} />
      <div className={promptStyles.text}>
        <h2 id="android-notice-title" className={promptStyles.title}>The Tagify Android app is out</h2>
        <p id="android-notice-description" className={promptStyles.description}>
          {connected
            ? "You asked us to tell you. Point your phone camera at the code, or open Google Play, and sign in with the same Tagify account as this computer."
            : "You asked us to tell you. The app works with your Tagify account, so connect this computer first, then point your phone camera at the code."}
        </p>
      </div>
      <div className={promptStyles.actions}>
        <button type="button" className={promptStyles.secondary} onClick={onDismiss}>Close</button>
        {connected ? (
          <button type="button" className={promptStyles.primary} onClick={onOpen}>Open Google Play</button>
        ) : (
          <>
            <button type="button" className={promptStyles.secondary} onClick={onOpen}>Open Google Play</button>
            <button type="button" className={promptStyles.primary} onClick={onConnect}>Connect this computer</button>
          </>
        )}
      </div>
    </section>
  );
}
