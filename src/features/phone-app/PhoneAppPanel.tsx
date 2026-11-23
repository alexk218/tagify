import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAndroid, faApple } from "@fortawesome/free-brands-svg-icons";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { ANDROID_APP_QR, ANDROID_APP_URL, IPHONE_APP_QR, IPHONE_APP_URL, type QrCode } from "./phoneAppLinks";
// eslint-disable-next-line css-modules/no-unused-class -- shared between the panel and its popover
import styles from "./PhoneApp.module.css";

export type PhoneStore = "app_store" | "google_play";

export function openPhoneStore(store: PhoneStore): void {
  window.open(store === "app_store" ? IPHONE_APP_URL : ANDROID_APP_URL, "_blank", "noopener,noreferrer");
}

export function PhoneAppQr({ code, label, size = 112 }: { code: QrCode; label: string; size?: number }) {
  return (
    <svg
      className={styles.qr}
      width={size}
      height={size}
      viewBox={`-2 -2 ${code.size + 4} ${code.size + 4}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect x={-2} y={-2} width={code.size + 4} height={code.size + 4} fill="#fff" />
      <path stroke="#000" d={code.path} />
    </svg>
  );
}

interface PhoneAppPanelProps {
  /** Whether this computer is connected to a Tagify account, which the phone apps sign in with. */
  connected: boolean;
  accountLabel: string | null;
  onConnect: () => void;
  androidReleased: boolean;
  androidNotify: boolean;
  onStore: (store: PhoneStore) => void;
  onNotifyAndroid: () => void;
  onHide: () => void;
}

/** QR codes plus store links: people click on a computer but install on their phone. */
export function PhoneAppPanel({ connected, accountLabel, onConnect, androidReleased, androidNotify, onStore, onNotifyAndroid, onHide }: PhoneAppPanelProps) {
  return (
    <div className={styles.panel}>
      <h3 id="tagify-phone-title" className={styles.title}>Tagify on your phone</h3>
      {connected ? (
        <p className={styles.lead}>
          Tag the song that&apos;s playing from your phone. Sign in on your phone with the Tagify account this
          computer uses{accountLabel ? <> (<strong className={styles.account}>{accountLabel}</strong>)</> : null}, and your
          tags show up in both places.
        </p>
      ) : (
        <>
          <p className={styles.lead}>
            The phone app works with your Tagify account. Connect this computer first, so the songs you&apos;ve
            tagged here are on your phone and what you tag there comes back here.
          </p>
          <div className={styles.step}>
            <p className={styles.stepTitle}><span className={styles.stepNumber}>1.</span> Connect this computer to your Tagify account</p>
            <button type="button" className={styles.connectButton} onClick={onConnect}>
              Create account or sign in
            </button>
          </div>
          <p className={styles.stepTitle}><span className={styles.stepNumber}>2.</span> Get the app and sign in with the same account</p>
        </>
      )}

      <div className={styles.app}>
        <PhoneAppQr code={IPHONE_APP_QR} label="QR code for Tagify on the App Store" />
        <div className={styles.appCopy}>
          <p className={styles.appName}><FontAwesomeIcon icon={faApple} /> iPhone</p>
          <p className={styles.hint}>Point your iPhone camera at the code.</p>
          <button type="button" className={styles.storeLink} onClick={() => onStore("app_store")}>
            Open the App Store page
          </button>
        </div>
      </div>

      {androidReleased ? (
        <div className={styles.app}>
          <PhoneAppQr code={ANDROID_APP_QR} label="QR code for Tagify on Google Play" />
          <div className={styles.appCopy}>
            <p className={styles.appName}><FontAwesomeIcon icon={faAndroid} /> Android</p>
            <p className={styles.hint}>Point your phone camera at the code.</p>
            <button type="button" className={styles.storeLink} onClick={() => onStore("google_play")}>
              Open Google Play
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.android}>
          <p className={styles.appName}><FontAwesomeIcon icon={faAndroid} /> Android app coming soon</p>
          {androidNotify ? (
            <p className={styles.notified} role="status">
              <FontAwesomeIcon icon={faCheck} /> We&apos;ll tell you here in Tagify when it&apos;s out.
            </p>
          ) : (
            <button type="button" className={styles.storeLink} onClick={onNotifyAndroid}>
              Notify me when it&apos;s out
            </button>
          )}
        </div>
      )}

      <div className={styles.footer}>
        <button type="button" className={styles.hideLink} onClick={onHide}>Don&apos;t show this button again</button>
        <span>You can bring it back in Settings.</span>
      </div>
    </div>
  );
}
