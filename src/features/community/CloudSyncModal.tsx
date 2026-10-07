import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Cloud, ExternalLink, Link2, RefreshCw, ShieldAlert, UserCircle2, X } from "lucide-react";
import { openCommunityUrl } from "./communityLinks";
import { fetchCommunityProfile } from "./communityDevice";
import { getDesktopSyncConfiguration, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncPairingService, type ApprovedPairing } from "@/services/sync/SyncPairingService";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { CommunityVisibilityReview } from "./CommunityPublicVisibilityReview";
import { Portal } from "@/components/ui";
import { InitialLibraryMergeReview } from "./InitialLibraryMergeReview";
import { communityErrorMessage, communitySyncStatusLabel } from "./communitySyncCopy";
import styles from "./CloudSyncModal.module.css";

const COMMUNITY_URL = "https://community.tagify.fm";

export function CloudSyncModal({ onClose }: { onClose: () => void }) {
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
  const [visibilityReviewed, setVisibilityReviewed] = useState<boolean | null>(null);
  const syncing = status === "syncing";
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
      setApprovedPairing(null); setPending(next); openCommunityUrl(next.verificationUri);
    } catch (nextError) { setError(communityErrorMessage(nextError, "Couldn't start connecting. Please try again.")); }
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
        setConfiguration(connection.configuration); setApprovedPairing(null); setRequiresReload(connection.requiresReload);
        if (!connection.requiresReload) await activeSyncRuntime().activateCurrentAccount();
      } else setPending(syncPairingService.getPending());
    } catch (nextError) { setError(communityErrorMessage(nextError, "Couldn't finish connecting. Please try again.")); if (!completingApproval) setPending(syncPairingService.getPending()); }
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
          <div className={styles.connected}><CheckCircle2 /><div><strong>Connected</strong><span>{communitySyncStatusLabel(status, visibilityReviewed)}</span></div></div>
          <div className={styles.accountCard}>
            <UserCircle2 size={18} />
            <div>
              <strong>{profileLabel(configuration)}</strong>
              <span>{configuration.profile?.handle ? `@${configuration.profile.handle}` : "Community Sync connected"}</span>
            </div>
          </div>
          <p>Tagify is syncing this desktop library directly to Community.</p>
          {backupHealth ? <p><strong>Latest cloud backup:</strong> {backupHealth.lastBackupAt ? new Date(backupHealth.lastBackupAt).toLocaleString() : "Waiting for the first successful backup"} · {backupHealth.annotations.toLocaleString()} tagged items · {backupHealth.taxonomyNodes.toLocaleString()} tags and groups · {backupHealth.appStateDocuments > 0 ? "Smart Playlists protected" : "Smart Playlists pending"}</p> : null}
          {!showingMergeReview ? <CommunityVisibilityReview connected={Boolean(configuration)} onReviewStateChange={setVisibilityReviewed} /> : null}
          {requiresReload ? <div className={styles.warning}><ShieldAlert /><span>Reload Spotify to finish switching accounts. Your library from the previous account will stay on this device.</span></div> : null}
          {status === "snapshot-required" ? <div className={styles.warning}><ShieldAlert /><span>Your changes are still on this device. Try Sync now again. If it keeps stopping, download a Tagify backup and contact support.</span></div> : null}
          {showingMergeReview && mergePreview ? <InitialLibraryMergeReview review={mergePreview} onCommit={(resolutions) => activeSyncRuntime().commitInitialMerge(resolutions)} onDownloadBackup={() => activeSyncRuntime().downloadInitialMergeBackup()} /> : null}
          {!showingMergeReview ? <div className={styles.actions}><button type="button" onClick={() => void activeSyncRuntime().syncNow()} disabled={busy || requiresReload || syncing || status === "idle" || status === "publishing" || visibilityReviewed === false}><RefreshCw size={15} /> {syncing ? "Syncing…" : visibilityReviewed === false ? "Save visibility first" : "Sync now"}</button><button type="button" onClick={() => openCommunityUrl(`${COMMUNITY_URL}/settings/devices`)}><ExternalLink size={15} /> Linked devices</button></div> : null}
        </> : <>
          <p>Back up your tags, ratings, Smart Playlists, and preferences. You choose what appears on your public profile.</p>
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
async function hydrateSyncProfile(configuration: DesktopSyncConfiguration): Promise<DesktopSyncConfiguration | null> {
  const profile = await fetchCommunityProfile(configuration.accessToken);
  if (!profile?.handle) return null;
  const next = { ...configuration, profile };
  setDesktopSyncConfiguration(next);
  return next;
}
