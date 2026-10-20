import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Cloud, ExternalLink, Link2, RefreshCw, ShieldAlert, UserCircle2, X } from "lucide-react";
import { openCommunityUrl } from "./communityLinks";
import { fetchCommunityProfile, hydrateSyncProfile } from "./communityDevice";
import { getDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncPairingService, type ApprovedPairing } from "@/services/sync/SyncPairingService";
import { clearRecoveryUnavailable } from "@/services/sync/SyncInstallRecovery";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { currentSpotifyLibrarySend, SPOTIFY_LIBRARY_SEND_EVENT, type SpotifySendProgress, type SpotifySendSnapshot } from "@/services/sync/SpotifyLibrarySender";
import { Portal } from "@/components/ui";
import { InitialLibraryMergeReview } from "./InitialLibraryMergeReview";
import { backupNotices, communityErrorMessage, communitySyncStatusLabel, savedSettingsLabel } from "./communitySyncCopy";
import { SHARING_STATE_LABELS } from "./communityPublication";
import type { CommunitySharing } from "./useCommunitySharing";
import type { DurableAppStateDomain } from "@tagify/sync-contracts";
import {
  recordCommunityConnectCompleted,
  recordCommunityConnectFinishFailed,
  recordCommunityConnectStarted,
  recordCommunityConnectStartFailed,
  recordCommunitySetupOpened,
} from "./communityConnectAnalytics";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the onboarding and library-review dialogs
import styles from "./CloudSyncModal.module.css";

const COMMUNITY_URL = "https://community.tagify.fm";

export function CloudSyncModal({ sharing, onOpenSharing, onClose }: { sharing: CommunitySharing; onOpenSharing: () => void; onClose: () => void }) {
  const [configuration, setConfiguration] = useState(() => getDesktopSyncConfiguration());
  const [pending, setPending] = useState(() => syncPairingService.getPending());
  const [approvedPairing, setApprovedPairing] = useState<ApprovedPairing | null>(null);
  const [status, setStatus] = useState(() => activeSyncRuntime().getStatus());
  const [mergePreview, setMergePreview] = useState(() => activeSyncRuntime().getInitialMergePreview());
  const [backupHealth, setBackupHealth] = useState(() => activeSyncRuntime().getBackupHealth());
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const polling = useRef(false);
  const [error, setError] = useState("");
  const [requiresReload, setRequiresReload] = useState(false);
  const syncing = status === "syncing";
  const settingsChoices = backupHealth?.needsChoice ?? [];
  const smartPlaylistsDeviceOnly = backupHealth?.notBackedUp?.includes("smart-playlists") ?? false;
  const showingMergeReview = Boolean(mergePreview && (status === "merge-required" || status === "syncing" || status === "error"));

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const runtime = activeSyncRuntime();
      const detail = (event as CustomEvent<{ status?: ReturnType<typeof syncRuntime.getStatus> }>).detail;
      setStatus(detail?.status || runtime.getStatus());
      setMergePreview(runtime.getInitialMergePreview());
      setBackupHealth(runtime.getBackupHealth());
    };
    window.addEventListener("tagify:syncStatus", handleStatus);
    handleStatus(new CustomEvent("tagify:syncStatus", { detail: { status: activeSyncRuntime().getStatus() } }));
    return () => window.removeEventListener("tagify:syncStatus", handleStatus);
  }, []);

  // Your Spotify lists on their way to Community, when you asked for them there.
  const [spotifySend, setSpotifySend] = useState<SpotifySendSnapshot>(() => currentSpotifyLibrarySend());
  useEffect(() => {
    const handleSend = (event: Event) => setSpotifySend((event as CustomEvent<SpotifySendSnapshot>).detail ?? null);
    window.addEventListener(SPOTIFY_LIBRARY_SEND_EVENT, handleSend);
    return () => window.removeEventListener(SPOTIFY_LIBRARY_SEND_EVENT, handleSend);
  }, []);

  useEffect(() => {
    // Opening the connection screen re-enables automatic reconnection checks on the next start.
    if (!getDesktopSyncConfiguration()) {
      clearRecoveryUnavailable();
      recordCommunitySetupOpened("sync");
    }
  }, []);

  useEffect(() => {
    if (!configuration?.accessToken || configuration.profile?.handle) return;
    void hydrateSyncProfile(configuration).then((next) => {
      if (next) setConfiguration(next);
    });
  }, [configuration]);

  const begin = async () => {
    setBusy(true); setError("");
    try {
      const next = await syncPairingService.begin(COMMUNITY_URL, deviceName(), navigator.platform || "Spotify desktop");
      setApprovedPairing(null); setPending(next); recordCommunityConnectStarted("sync"); openCommunityUrl(next.verificationUri);
    } catch (nextError) { recordCommunityConnectStartFailed("sync"); setError(communityErrorMessage(nextError, "Couldn't start connecting. Please try again.")); }
    setBusy(false);
  };

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    let completingApproval = false;
    setBusy(true); setError("");
    try {
      const result = await syncPairingService.poll();
      if (result.status === "approved") {
        const profile = await fetchCommunityProfile(result.approval.configuration.accessToken);
        const approval = profile ? {
          ...result.approval,
          configuration: { ...result.approval.configuration, profile },
        } : result.approval;
        completingApproval = true;
        setApprovedPairing(approval);
        setPending(null);
        const connection = await syncPairingService.complete(approval, {
          confirmedAccountSwitch: approval.relationship === "account-switch",
        });
        recordCommunityConnectCompleted("sync", approval.relationship);
        setConfiguration(connection.configuration); setApprovedPairing(null); setRequiresReload(connection.requiresReload);
        if (!connection.requiresReload) await activeSyncRuntime().activateCurrentAccount();
      } else setPending(syncPairingService.getPending());
    } catch (nextError) {
      // An expired code is an unfinished approval, not a failure.
      if (completingApproval || syncPairingService.getPending()) recordCommunityConnectFinishFailed("sync");
      setError(communityErrorMessage(nextError, "Couldn't finish connecting. Please try again.")); if (!completingApproval) setPending(syncPairingService.getPending());
    }
    polling.current = false;
    setBusy(false);
  }, []);

  const cancelPairing = () => {
    syncPairingService.cancelPending();
    setPending(null); setApprovedPairing(null); setError("");
  };

  const keepLocalOnly = async () => {
    setBusy(true); setError("");
    try {
      await activeSyncRuntime().unlinkLocal();
      setConfiguration(null);
      setStatus("unlinked");
      setBackupHealth(null);
    } catch (nextError) {
      setError(communityErrorMessage(nextError, "Couldn't disconnect safely. Please try again."));
    }
    setBusy(false);
  };

  const keepSettings = async (domain: DurableAppStateDomain, keep: "device" | "cloud") => {
    setBusy(true); setError("");
    try {
      await activeSyncRuntime().resolveSettingsChoice(domain, keep);
      setBackupHealth(activeSyncRuntime().getBackupHealth());
    } catch (nextError) {
      setError(communityErrorMessage(nextError, "Couldn't save your choice. Please try again."));
    }
    setBusy(false);
  };

  const close = () => {
    if (pending || approvedPairing) syncPairingService.cancelPending();
    onClose();
  };

  useEffect(() => {
    if (!pending) return;
    const hiddenDelay = document.visibilityState === "hidden" ? 15_000 : 0;
    const jitter = Math.floor(Math.random() * 1_500);
    const timer = window.setTimeout(() => void poll(), pending.interval * 1000 + hiddenDelay + jitter);
    return () => window.clearTimeout(timer);
  }, [pending, poll]);

  return <Portal><div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="cloud-sync-title">
    <section className={styles.modal}>
      <header><div><p>Tagify 3.0</p><h2 id="cloud-sync-title"><Cloud size={20} /> Cloud Sync</h2></div><button type="button" aria-label="Close cloud sync" onClick={close}><X /></button></header>
      <div className={styles.body}>
        {pending ? <>
          <div className={styles.code}><span>Enter this code in Community</span><strong>{pending.userCode}</strong></div>
          <p>The code expires shortly. Approve only the Spotify installation showing this same code. After approval, Tagify starts the first sync automatically.</p>
          <div className={styles.actions}><button type="button" onClick={() => openCommunityUrl(pending.verificationUri)}><ExternalLink size={15} /> Open approval page</button><button type="button" onClick={() => void poll()} disabled={busy}><RefreshCw size={15} /> {busy ? "Checking…" : "I've approved it"}</button><button type="button" onClick={cancelPairing} className={styles.secondary}>Cancel linking</button></div>
        </> : approvedPairing ? <>
          <div className={styles.accountCard} role="status"><UserCircle2 size={18} /><div><strong>{busy ? `Connecting as ${profileLabel(approvedPairing.configuration)}…` : `Ready to connect as ${profileLabel(approvedPairing.configuration)}`}</strong><span>{busy ? "Finishing your Community connection." : "Your browser approval is saved. Try connecting again."}</span></div></div>
          {!busy ? <div className={styles.actions}><button type="button" onClick={cancelPairing} className={styles.secondary}>Cancel</button><button type="button" className={styles.primary} onClick={() => void poll()}><RefreshCw size={16} /> Try again</button></div> : null}
        </> : configuration && status === "reauthorize" ? <>
          <div className={styles.reconnectRequired}><ShieldAlert /><div><strong>Device revoked</strong><span>Reconnect required</span></div></div>
          <div className={styles.accountCard}>
            <UserCircle2 size={18} />
            <div>
              <strong>{profileLabel(configuration)}</strong>
              <span>{configuration.profile?.handle ? `@${configuration.profile.handle}` : "Previously connected Community account"}</span>
            </div>
          </div>
          <p>Cloud backup stopped on this device. Your local Tagify library is still here.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void begin()}><Link2 size={16} /> {busy ? "Creating code…" : "Reconnect device"}</button>
            <button type="button" onClick={() => openCommunityUrl(`${COMMUNITY_URL}/settings/devices`)}><ExternalLink size={15} /> Linked devices</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void keepLocalOnly()}>Keep data on this device only</button>
          </div>
        </> : configuration ? <>
          <div className={styles.connected}><CheckCircle2 /><div><strong>Connected</strong><span>{communitySyncStatusLabel(status, settingsChoices.length > 0)}</span></div></div>
          <div className={styles.accountCard}>
            <UserCircle2 size={18} />
            <div>
              <strong>{profileLabel(configuration)}</strong>
              <span>{configuration.profile?.handle ? `@${configuration.profile.handle}` : "Community Sync connected"}</span>
            </div>
          </div>
          <p>Tagify is syncing this desktop library directly to Community.</p>
          {spotifySend ? <p role="status"><strong>Sending your Spotify lists to Community:</strong> {spotifySendLine(spotifySend.progress)}</p> : null}
          {backupHealth ? <p><strong>Latest cloud backup:</strong> {backupHealth.lastBackupAt ? new Date(backupHealth.lastBackupAt).toLocaleString() : "Waiting for the first successful backup"} · {backupHealth.annotations.toLocaleString()} tagged items · {backupHealth.taxonomyNodes.toLocaleString()} tags and groups · {smartPlaylistsDeviceOnly ? "Smart Playlists saved on this device only" : backupHealth.appStateDocuments > 0 ? "Smart Playlists protected" : "Smart Playlists pending"}</p> : null}
          {settingsChoices.length ? <div className={styles.choice} role="group" aria-labelledby="cloud-sync-settings-choice">
            <div><strong id="cloud-sync-settings-choice">Your saved settings changed on another device too</strong><span>Choose which copy to keep. The other copy is replaced on your devices.</span></div>
            {settingsChoices.map((domain) => <div className={styles.choiceRow} key={domain}>
              <span>{savedSettingsLabel(domain)}</span>
              <div className={styles.choiceActions}>
                <button type="button" disabled={busy} onClick={() => void keepSettings(domain, "device")}>Keep this device's</button>
                <button type="button" disabled={busy} onClick={() => void keepSettings(domain, "cloud")}>Use the other device's</button>
              </div>
            </div>)}
          </div> : null}
          {backupNotices(backupHealth).map((notice) => <div className={styles.warning} key={notice}><ShieldAlert /><span>{notice}</span></div>)}
          {!showingMergeReview ? <SharingRow sharing={sharing} onOpen={onOpenSharing} /> : null}
          {requiresReload ? <div className={styles.warning}><ShieldAlert /><span>Reload Spotify to finish switching accounts. Your library from the previous account will stay on this device.</span></div> : null}
          {status === "snapshot-required" ? <div className={styles.warning}><ShieldAlert /><span>Your changes are still on this device. Try Sync now again. If it keeps stopping, download a Tagify backup and contact support.</span></div> : null}
          {showingMergeReview && mergePreview ? <InitialLibraryMergeReview review={mergePreview} onCommit={(resolutions) => activeSyncRuntime().commitInitialMerge(resolutions)} onDownloadBackup={() => activeSyncRuntime().downloadInitialMergeBackup()} /> : null}
          {!showingMergeReview ? <div className={styles.actions}><button type="button" onClick={() => void activeSyncRuntime().syncNow()} disabled={busy || requiresReload || syncing || status === "idle" || status === "publishing"}><RefreshCw size={15} /> {syncing ? "Syncing…" : "Sync now"}</button><button type="button" onClick={() => openCommunityUrl(`${COMMUNITY_URL}/settings/devices`)}><ExternalLink size={15} /> Linked devices</button></div> : null}
        </> : <>
          <p>Back up your tags, ratings, and Smart Playlists. Your Tagify settings stay on this device. You choose what appears on your public profile.</p>
          <label className={styles.consent}><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span>I understand my Tagify library will be saved to Community and have reviewed the privacy terms.</span></label>
          <button type="button" className={styles.primary} disabled={!consented || busy} onClick={() => void begin()}><Link2 size={16} /> {busy ? "Creating code…" : "Link Community account"}</button>
        </>}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
      </div>
    </section>
  </div></Portal>;
}

function deviceName() { return `Tagify on ${navigator.userAgent.includes("Mac") ? "Mac" : navigator.userAgent.includes("Windows") ? "Windows" : "desktop"}`; }
function activeSyncRuntime() { return window.TagifySync || syncRuntime; }
function profileLabel(configuration: DesktopSyncConfiguration) { return configuration.profile?.displayName || (configuration.profile?.handle ? `@${configuration.profile.handle}` : `Community account …${configuration.accountId.slice(-6)}`); }

/** Sharing lives in its own window; Sync shows where it stands in one line. */
function SharingRow({ sharing, onOpen }: { sharing: CommunitySharing; onOpen: () => void }) {
  const notPublic = sharing.state === "review" || sharing.state === "private";
  return <div className={styles.sharingRow}>
    <span>
      <strong>Your tags: {sharing.state ? SHARING_STATE_LABELS[sharing.state] : sharing.phase === "error" ? "Couldn't check" : "Checking…"}</strong>
      {notPublic ? <small>Publish them to show them on your Community profile.</small> : null}
    </span>
    <button type="button" className={notPublic ? styles.primary : styles.secondary} onClick={onOpen}>{notPublic ? "Publish my tags" : "Change"}</button>
  </div>;
}

function spotifySendLine(progress: SpotifySendProgress): string {
  if (progress.listsTotal === null) return "getting your playlists ready.";
  if (progress.listsDone === 0) return `reading Liked Songs (${progress.currentSongs.toLocaleString()} so far).`;
  return `${progress.listsDone.toLocaleString()} of ${progress.listsTotal.toLocaleString()} lists.`;
}
