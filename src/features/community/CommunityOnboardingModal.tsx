import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck, UserCircle2, X } from "lucide-react";
import { COMMUNITY_HANDLE_CHANGED_EVENT, hydrateSyncProfile } from "./communityDevice";
import { openCommunityUrl } from "./communityLinks";
import { REWIND_URL, REWIND_YEAR } from "@/features/rewind/rewindPromptRules";
import { CommunitySharePanel, communityProfileUrl } from "./CommunityShareDialog";
import type { CommunitySharing } from "./useCommunitySharing";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { getDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { IPHONE_APP_URL } from "@/features/phone-app/phoneAppLinks";
import { clearRecoveryUnavailable } from "@/services/sync/SyncInstallRecovery";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { Portal } from "@/components/ui";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the sync and library-review dialogs
import styles from "./CloudSyncModal.module.css";
import { InitialLibraryMergeReview } from "./InitialLibraryMergeReview";
import { communitySyncStatusLabel } from "./communitySyncCopy";
import { recordCommunitySetupOpened, type CommunityConnectEntry } from "./communityConnectAnalytics";
import { communityPairing, useCommunityPairing } from "./communityPairing";
import { CommunityConnectWaiting } from "./CommunityConnectWaiting";
import { CommunityEmailSignIn } from "./CommunityEmailSignIn";
import { isInAppSignUpEnabled } from "./inAppSignUp";
import { openCommunityUrlSignedIn } from "./communityWebsiteLink";

export function CommunityOnboardingModal({
  entry,
  sharing,
  tracks,
  taxonomy,
  onClose,
}: {
  entry: CommunityConnectEntry;
  sharing: CommunitySharing;
  tracks: Record<string, TrackData>;
  taxonomy: TagTaxonomy;
  onClose: () => void;
}) {
  const [configuration, setConfiguration] = useState(() => getDesktopSyncConfiguration());
  // A computer Community stopped accepting keeps its old connection until it reconnects, so setup
  // signs in again exactly as it would for a new member.
  const [reconnecting, setReconnecting] = useState(() => Boolean(getDesktopSyncConfiguration()) && activeSyncRuntime().getStatus() === "reauthorize");
  const linked = configuration && !reconnecting ? configuration : null;
  const pairing = useCommunityPairing();
  const { approvedPairing } = pairing;
  const busy = pairing.starting || pairing.checking;
  const error = pairing.error;
  const [status, setStatus] = useState(() => activeSyncRuntime().getStatus());
  const [mergePreview, setMergePreview] = useState(() => activeSyncRuntime().getInitialMergePreview());
  const showingMergeReview = Boolean(mergePreview && (status === "merge-required" || status === "syncing" || status === "error"));
  const [finished, setFinished] = useState(false);
  const [finishedPrivately, setFinishedPrivately] = useState(false);
  const [requiresReload, setRequiresReload] = useState(() => communityPairing.getState().connection?.requiresReload ?? false);
  const autoStarted = useRef(false);
  // Signing in inside Tagify, unless the member chose Apple or their browser (the website's page).
  const [inApp] = useState(() => isInAppSignUpEnabled());
  const [browserMethod, setBrowserMethod] = useState<"apple" | "browser" | null>(null);

  // Signing in inside Tagify (email or code step); its close button stops the sign-in, as Cancel did.
  const signingInHere = !linked && !approvedPairing && inApp && !browserMethod;
  const signingIn = !linked && !approvedPairing;

  // Closing the browser step keeps a waiting code: Tagify keeps checking until it expires and finishes by itself.
  const close = () => {
    if (approvedPairing || signingInHere) communityPairing.cancel();
    onClose();
  };

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const runtime = activeSyncRuntime();
      const detail = (event as CustomEvent<{ status?: ReturnType<typeof syncRuntime.getStatus> }>).detail;
      setStatus(detail?.status || runtime.getStatus());
      setMergePreview(runtime.getInitialMergePreview());
    };
    window.addEventListener("tagify:syncStatus", handleStatus);
    handleStatus(new CustomEvent("tagify:syncStatus", { detail: { status: activeSyncRuntime().getStatus() } }));
    return () => window.removeEventListener("tagify:syncStatus", handleStatus);
  }, []);

  useEffect(() => {
    const htmlOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
    };
  }, []);

  useEffect(() => {
    // Opening the connection screen re-enables automatic reconnection checks on the next start.
    if (!getDesktopSyncConfiguration()) {
      clearRecoveryUnavailable();
      recordCommunitySetupOpened(entry);
    }
  }, [entry]);

  // While setup is open, an expired code is replaced with a new one.
  useEffect(() => {
    if (getDesktopSyncConfiguration() && !reconnecting) return;
    communityPairing.adopt(entry);
    const unwatch = communityPairing.watch();
    // Opening setup is the click on Connect: it asks Community for a code and opens the browser at once.
    if (!autoStarted.current && !communityPairing.getState().pending && !communityPairing.getState().approvedPairing) {
      autoStarted.current = true;
      void communityPairing.start(entry, { inApp });
    }
    return unwatch;
    // Only the state setup opened in decides whether it signs in.
  }, [entry]);

  useEffect(() => {
    if (!pairing.connection) return;
    setConfiguration(pairing.connection.configuration);
    setReconnecting(false);
    setRequiresReload(pairing.connection.requiresReload);
  }, [pairing.connection]);

  useEffect(() => {
    if (!configuration?.accessToken || configuration.profile?.handle) return;
    void hydrateSyncProfile(configuration).then((next) => {
      if (next) setConfiguration(next);
    });
  }, [configuration]);

  // A handle picked on the sharing step names the account here too.
  useEffect(() => {
    const picked = () => setConfiguration(getDesktopSyncConfiguration());
    window.addEventListener(COMMUNITY_HANDLE_CHANGED_EVENT, picked);
    return () => window.removeEventListener(COMMUNITY_HANDLE_CHANGED_EVENT, picked);
  }, []);

  const poll = () => communityPairing.check();
  const cancelPairing = () => communityPairing.cancel();

  // Once a sharing choice exists, set up or saved before, setup is done.
  useEffect(() => {
    if (!linked || finished || showingMergeReview || !sharing.state || sharing.state === "review") return;
    setFinishedPrivately(sharing.state === "private");
    setFinished(true);
  }, [linked, finished, showingMergeReview, sharing.state]);

  const rewindButton = <button type="button" onClick={() => void openCommunityUrlSignedIn(REWIND_URL)}><ExternalLink size={15} /> See your Rewind {REWIND_YEAR}</button>;
  const profileHref = communityProfileUrl(configuration?.profile?.handle || sharing.handle);

  return <Portal><div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Your Tagify account">
    <section className={`${styles.modal} ${styles.accountWindow}`} data-account-window="" data-account-step={signingIn ? "sign-in" : "account"}>
      <button type="button" className={styles.accountClose} aria-label="Close" onClick={close}><X size={20} /></button>
      <div className={`${styles.body} ${styles.accountBody}`}>
        {!linked && !approvedPairing && inApp && !browserMethod ? (
          <CommunityEmailSignIn
            pairing={pairing}
            heading={entry === "rewind" ? `See your Rewind ${REWIND_YEAR} on Community` : undefined}
            description={entry === "rewind" ? rewindDescription : undefined}
            onUseBrowser={(method) => {
              if (pairing.pending) openCommunityUrl(pairing.pending.verificationUri);
              setBrowserMethod(method);
            }}
          />
        ) : null}

        {!linked && !approvedPairing && (!inApp || browserMethod) ? (
          <CommunityConnectWaiting
            pairing={pairing}
            heading={entry === "rewind" && !browserMethod ? `See your Rewind ${REWIND_YEAR} on Community` : "Finish in your browser"}
            description={entry === "rewind" && !browserMethod ? rewindDescription : undefined}
            steps={browserMethod === "apple" ? ["Choose Continue with Apple on the page that opened", "Sign in with your Apple Account"] : undefined}
            cancelLabel={browserMethod ? "Back" : undefined}
            onCancel={browserMethod ? () => setBrowserMethod(null) : () => { communityPairing.cancel(); onClose(); }}
          />
        ) : null}

        {!linked && approvedPairing ? <>
          <div className={styles.connected} role="status">
            <UserCircle2 />
            <div>
              <strong>{busy ? `Connecting${asProfile(approvedPairing.configuration)}…` : `Ready to connect${asProfile(approvedPairing.configuration)}`}</strong>
              <span>{busy ? "Finishing your Tagify account connection." : "Your browser approval is saved. Try connecting again."}</span>
            </div>
          </div>
          {!busy ? <div className={styles.actions}>
            <button type="button" onClick={cancelPairing} className={styles.secondary}>Cancel</button>
            <button type="button" onClick={() => void poll()} className={styles.primary}><RefreshCw size={16} /> Try again</button>
          </div> : null}
        </> : null}

        {linked && !finished ? <>
          <div className={styles.connected}><CheckCircle2 /><div><strong>You&apos;re connected{asProfile(linked)}</strong><span>{communitySyncStatusLabel(status)}</span></div></div>
          {entry === "rewind" ? <div className={styles.actions}>{rewindButton}</div> : null}
          {requiresReload ? <div className={styles.warning}><ShieldCheck /><span>Reload Spotify to finish switching accounts before continuing setup.</span></div> : null}
          {status === "snapshot-required" ? <div className={styles.warning}><ShieldAlert /><span>Your library is still on this device. Try Sync now again. If it keeps stopping, save a Tagify backup and contact support.</span></div> : null}
          {showingMergeReview && mergePreview ? <InitialLibraryMergeReview review={mergePreview} onCommit={(resolutions) => activeSyncRuntime().commitInitialMerge(resolutions)} onDownloadBackup={() => activeSyncRuntime().downloadInitialMergeBackup()} /> : null}
          {!showingMergeReview && !requiresReload ? <CommunitySharePanel surface="onboarding" sharing={sharing} tracks={tracks} taxonomy={taxonomy} /> : null}
          {status === "snapshot-required" ? <div className={styles.actions}>
            <button type="button" onClick={() => void activeSyncRuntime().syncNow()} disabled={busy}><RefreshCw size={15} /> Sync now</button>
          </div> : null}
        </> : null}

        {linked && finished ? <>
          <div className={styles.onboardingHero}>
            <CheckCircle2 size={34} />
            <div>
              <h3>You&apos;re connected{asProfile(linked)}</h3>
              <p>{finishedPrivately
                ? "Tagify backs up your library automatically, and your tags stay private. You can publish them any time from Community in Tagify."
                : "Your tags appear on your profile within a minute, and Tagify keeps it up to date as you tag. You can change what's hidden any time from Community in Tagify."}</p>
              <p>Get the iPhone app: sign in with the same email. <button type="button" className={styles.inlineLink} onClick={() => openCommunityUrl(IPHONE_APP_URL)}>Get Tagify for iPhone</button></p>
            </div>
          </div>
          <div className={styles.actions}>
            {entry === "rewind" ? rewindButton : null}
            {!finishedPrivately ? <button type="button" onClick={() => void openCommunityUrlSignedIn(profileHref)}><ExternalLink size={15} /> View my profile</button> : null}
            <button type="button" className={styles.primary} onClick={close}>Done</button>
          </div>
        </> : null}

        {error && (linked || approvedPairing) ? <div className={styles.error} role="alert">{error}</div> : null}
      </div>
    </section>
  </div></Portal>;
}

const rewindDescription = "Your library is backed up on Community, and Rewind is put together from it. Your tags stay private unless you choose to publish them.";

function activeSyncRuntime() { return window.TagifySync || syncRuntime; }
// A member who connected before picking a handle has no name to show yet; say "You're connected" rather than an account number.
function asProfile(configuration: DesktopSyncConfiguration) { const name = configuration.profile?.displayName || (configuration.profile?.handle ? `@${configuration.profile.handle}` : ""); return name ? ` as ${name}` : ""; }
