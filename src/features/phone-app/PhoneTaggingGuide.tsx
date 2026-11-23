import React from "react";
import { IPHONE_APP_QR } from "./phoneAppLinks";
import { PhoneAppQr, openPhoneStore } from "./PhoneAppPanel";
import { requestConnectForPhone, usePhoneConnection } from "./phoneConnection";
import { PHONE_TAGGING_STEPS } from "./phoneTaggingSteps";
import styles from "./PhoneTaggingGuide.module.css";

/** "Phone Tagging" in the Tagify Guide: the iPhone steps for tagging a Spotify song, and how to get the app. */
export function PhoneTaggingGuide({ onConnect }: { onConnect: () => void }) {
  const { connected, accountLabel } = usePhoneConnection();

  const getApp = (
    <div className={styles.getApp}>
      <PhoneAppQr code={IPHONE_APP_QR} label="QR code for Tagify on the App Store" size={88} />
      <div className={styles.getAppText}>
        <p className={styles.getAppLead}>
          {connected
            ? <>Sign in on your iPhone with the Tagify account this computer uses{accountLabel ? <> (<strong>{accountLabel}</strong>)</> : null}, and your tags show up in both places.</>
            : "The iPhone app works with your Tagify account, so connect this computer first. Then sign in on your iPhone with the same account."}
        </p>
        <div className={styles.actions}>
          {connected ? null : (
            <button type="button" className={styles.primary} onClick={() => { onConnect(); requestConnectForPhone(); }}>
              Connect this computer
            </button>
          )}
          <button type="button" className={styles.secondary} onClick={() => openPhoneStore("app_store")}>
            Open the App Store page
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <p className={styles.lead}>
        Playing something on Spotify on your iPhone? Tag it in a few taps, and your tags show up here too.
      </p>
      {getApp}
      <ol className={styles.row}>
        {PHONE_TAGGING_STEPS.map(({ image, caption, alt }, index) => (
          <li key={caption} className={styles.rowStep}>
            <img src={image} alt={alt} className={styles.shot} width={200} height={434} />
            <span className={styles.caption}><span className={styles.number}>{index + 1}.</span> {caption}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
