import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Cloud, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck, UserCircle2, X } from "lucide-react";
import { hydrateSyncProfile } from "./communityDevice";
import { openCommunityUrl } from "./communityLinks";
import { REWIND_URL, REWIND_YEAR } from "@/features/rewind/rewindPromptRules";
import { CommunitySharePanel, communityProfileUrl } from "./CommunityShareDialog";
import type { CommunitySharing } from "./useCommunitySharing";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { getDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
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

  // Closing keeps a waiting code: Tagify keeps checking until it expires and finishes by itself.
  const close = () => {
    if (approvedPairing) communityPairing.cancel();
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
    if (getDesktopSyncConfiguration()) return;
    communityPairing.adopt(entry);
    const unwatch = communityPairing.watch();
    // Opening setup is the click on Connect: it asks Community for a code and opens the browser at once.
    if (!autoStarted.current && !communityPairing.getState().pending && !communityPairing.getState().approvedPairing) {
      autoStarted.current = true;
      void communityPairing.start(entry);
    }
    return unwatch;
  }, [entry]);

  useEffect(() => {
    if (!pairing.connection) return;
    setConfiguration(pairing.connection.configuration);
    setRequiresReload(pairing.connection.requiresReload);
  }, [pairing.connection]);

  useEffect(() => {
    if (!configuration?.accessToken || configuration.profile?.handle) return;
    void hydrateSyncProfile(configuration).then((next) => {
      if (next) setConfiguration(next);
    });
  }, [configuration]);

  const poll = () => communityPairing.check();
  const cancelPairing = () => communityPairing.cancel();

  // Once a sharing choice exists, set up or saved before, setup is done.
  useEffect(() => {
    if (!configuration || finished || showingMergeReview || !sharing.state || sharing.state === "review") return;
    setFinishedPrivately(sharing.state === "private");
    setFinished(true);
  }, [configuration, finished, showingMergeReview, sharing.state]);

  const rewindButton = <button type="button" onClick={() => openCommunityUrl(REWIND_URL)}><ExternalLink size={15} /> See your Rewind {REWIND_YEAR}</button>;
  const profileHref = communityProfileUrl(configuration?.profile?.handle || sharing.handle);

  return <Portal><div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="community-onboarding-title">
    <section className={`${styles.modal} ${styles.onboardingModal}`}>
      <header>
        <div><h2 id="community-onboarding-title"><Cloud size={20} /> Community setup</h2></div>
        <button type="button" aria-label="Close Community setup" onClick={close}><X /></button>
      </header>
      <div className={styles.body}>
        {!configuration && !approvedPairing ? (
          <CommunityConnectWaiting
            pairing={pairing}
            heading={entry === "rewind" ? `See your Rewind ${REWIND_YEAR} on Community` : "Finish in your browser"}
            description={entry === "rewind" ? "Your library is backed up on Community, and Rewind is put together from it. Your tags stay private unless you choose to publish them." : undefined}
            onCancel={() => { communityPairing.cancel(); onClose(); }}
          />
        ) : null}

        {!configuration && approvedPairing ? <>
          <div className={styles.connected} role="status">
            <UserCircle2 />
            <div>
              <strong>{busy ? `Connecting as ${profileLabel(approvedPairing.configuration)}…` : `Ready to connect as ${profileLabel(approvedPairing.configuration)}`}</strong>
              <span>{busy ? "Finishing your Community connection." : "Your browser approval is saved. Try connecting again."}</span>
            </div>
          </div>
          {!busy ? <div className={styles.actions}>
            <button type="button" onClick={cancelPairing} className={styles.secondary}>Cancel</button>
            <button type="button" onClick={() => void poll()} className={styles.primary}><RefreshCw size={16} /> Try again</button>
          </div> : null}
        </> : null}

        {configuration && !finished ? <>
          <div className={styles.connected}><CheckCircle2 /><div><strong>Connected as {profileLabel(configuration)}</strong><span>{communitySyncStatusLabel(status)}</span></div></div>
          {entry === "rewind" ? <div className={styles.actions}>{rewindButton}</div> : null}
          {requiresReload ? <div className={styles.warning}><ShieldCheck /><span>Reload Spotify to finish switching accounts before continuing setup.</span></div> : null}
          {status === "snapshot-required" ? <div className={styles.warning}><ShieldAlert /><span>Your library is still on this device. Try Sync now again. If it keeps stopping, save a Tagify backup and contact support.</span></div> : null}
          {showingMergeReview && mergePreview ? <InitialLibraryMergeReview review={mergePreview} onCommit={(resolutions) => activeSyncRuntime().commitInitialMerge(resolutions)} onDownloadBackup={() => activeSyncRuntime().downloadInitialMergeBackup()} /> : null}
          {!showingMergeReview && !requiresReload ? <CommunitySharePanel surface="onboarding" sharing={sharing} tracks={tracks} taxonomy={taxonomy} /> : null}
          {status === "snapshot-required" ? <div className={styles.actions}>
            <button type="button" onClick={() => void activeSyncRuntime().syncNow()} disabled={busy}><RefreshCw size={15} /> Sync now</button>
          </div> : null}
        </> : null}

        {configuration && finished ? <>
          <div className={styles.onboardingHero}>
            <CheckCircle2 size={34} />
            <div>
              <h3>Your Community setup is ready.</h3>
              <p>{finishedPrivately
                ? "Tagify backs up your library automatically, and your tags stay private. You can publish them any time from Community in Tagify."
                : "Your tags appear on your profile within a minute, and Tagify keeps it up to date as you tag. You can change what's hidden any time from Community in Tagify."}</p>
            </div>
          </div>
          <div className={styles.actions}>
            {entry === "rewind" ? rewindButton : null}
            {!finishedPrivately ? <button type="button" onClick={() => openCommunityUrl(profileHref)}><ExternalLink size={15} /> View my profile</button> : null}
            <button type="button" className={styles.primary} onClick={close}>Done</button>
          </div>
        </> : null}

        {error && (configuration || approvedPairing) ? <div className={styles.error} role="alert">{error}</div> : null}
      </div>
    </section>
  </div></Portal>;
}

function activeSyncRuntime() { return window.TagifySync || syncRuntime; }
function profileLabel(configuration: DesktopSyncConfiguration) { return configuration.profile?.displayName || (configuration.profile?.handle ? `@${configuration.profile.handle}` : `Community account …${configuration.accountId.slice(-6)}`); }
