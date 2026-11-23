import React, { useEffect, useState } from "react";
import { CheckCircle2, Cloud, ExternalLink, Link2, RefreshCw, ShieldAlert, UserCircle2, X } from "lucide-react";
import { COMMUNITY_PAGES_ORIGIN, openCommunityUrl } from "./communityLinks";
import { hydrateSyncProfile } from "./communityDevice";
import { getDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { currentSpotifyLibrarySend, SPOTIFY_LIBRARY_SEND_EVENT, type SpotifySendProgress, type SpotifySendSnapshot } from "@/services/sync/SpotifyLibrarySender";
import { Portal } from "@/components/ui";
import { InitialLibraryMergeReview } from "./InitialLibraryMergeReview";
import { ReconnectionPanel, useReconnectionState } from "./ReconnectionApproval";
import { backupNotices, communityErrorMessage, communitySyncStatusLabel, savedSettingsLabel } from "./communitySyncCopy";
import { SHARING_STATE_LABELS } from "./communityPublication";
import type { CommunitySharing } from "./useCommunitySharing";
import type { DurableAppStateDomain } from "@tagify/sync-contracts";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the onboarding and library-review dialogs
import styles from "./CloudSyncModal.module.css";


/**
 * How the backup stands on this computer. Connecting and reconnecting go through the same Tagify
 * account setup as every other way in (`onConnect`), so there is one way to sign in.
 */
export function CloudSyncModal({ sharing, onOpenSharing, onConnect, onClose }: { sharing: CommunitySharing; onOpenSharing: () => void; onConnect: () => void; onClose: () => void }) {
  const [configuration, setConfiguration] = useState(() => getDesktopSyncConfiguration());
  const [status, setStatus] = useState(() => activeSyncRuntime().getStatus());
  const [mergePreview, setMergePreview] = useState(() => activeSyncRuntime().getInitialMergePreview());
  const [backupHealth, setBackupHealth] = useState(() => activeSyncRuntime().getBackupHealth());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reconnection = useReconnectionState();
  useEffect(() => {
    // An approved reconnection connected this computer while the dialog was open.
    if (!reconnection && !configuration) {
      const stored = getDesktopSyncConfiguration();
      if (stored) setConfiguration(stored);
    }
  }, [reconnection, configuration]);
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
    if (!configuration?.accessToken || configuration.profile?.handle) return;
    void hydrateSyncProfile(configuration).then((next) => {
      if (next) setConfiguration(next);
    });
  }, [configuration]);

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

  const close = onClose;

  return <Portal><div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="cloud-sync-title">
    <section className={styles.modal}>
      <header><div><h2 id="cloud-sync-title"><Cloud size={20} /> Cloud Sync</h2></div><button type="button" aria-label="Close cloud sync" onClick={close}><X /></button></header>
      <div className={styles.body}>
        {!configuration && reconnection ? <ReconnectionPanel state={reconnection} busy={busy} onLinkWithNewCode={onConnect} />
        : configuration && status === "reauthorize" ? <>
          <div className={styles.reconnectRequired}><ShieldAlert /><div><strong>Device revoked</strong><span>Reconnect required</span></div></div>
          <div className={styles.accountCard}>
            <UserCircle2 size={18} />
            <div>
              <strong>{profileLabel(configuration)}</strong>
              <span>{configuration.profile?.handle ? `@${configuration.profile.handle}` : "Previously connected Tagify account"}</span>
            </div>
          </div>
          <p>Cloud backup stopped on this device. Your local Tagify library is still here.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={onConnect}><Link2 size={16} /> Reconnect device</button>
            <button type="button" onClick={() => openCommunityUrl(`${COMMUNITY_PAGES_ORIGIN}/settings/devices`)}><ExternalLink size={15} /> Linked devices</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void keepLocalOnly()}>Keep data on this device only</button>
          </div>
        </> : configuration ? <>
          <div className={styles.connected}><CheckCircle2 /><div><strong>Connected</strong><span>{communitySyncStatusLabel(status, settingsChoices.length > 0)}</span></div></div>
          <div className={styles.accountCard}>
            <UserCircle2 size={18} />
            <div>
              <strong>{profileLabel(configuration)}</strong>
              <span>{configuration.profile?.handle ? `@${configuration.profile.handle}` : "Tagify account connected"}</span>
            </div>
          </div>
          <p>Tagify backs up this computer&apos;s library to your Tagify account as you tag.</p>
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
          {status === "snapshot-required" ? <div className={styles.warning}><ShieldAlert /><span>Your changes are still on this device. Try Sync now again. If it keeps stopping, download a Tagify backup and contact support.</span></div> : null}
          {showingMergeReview && mergePreview ? <InitialLibraryMergeReview review={mergePreview} onCommit={(resolutions) => activeSyncRuntime().commitInitialMerge(resolutions)} onDownloadBackup={() => activeSyncRuntime().downloadInitialMergeBackup()} /> : null}
          {!showingMergeReview ? <div className={styles.actions}><button type="button" onClick={() => void activeSyncRuntime().syncNow()} disabled={busy || syncing || status === "idle" || status === "publishing"}><RefreshCw size={15} /> {syncing ? "Syncing…" : "Sync now"}</button><button type="button" onClick={() => openCommunityUrl(`${COMMUNITY_PAGES_ORIGIN}/settings/devices`)}><ExternalLink size={15} /> Linked devices</button></div> : null}
        </> : <>
          <p>Back up your tags, ratings and Smart Playlists, and use them on your phone. Everything you&apos;ve tagged here comes with you. Nothing is public unless you choose.</p>
          <div className={styles.actions}><button type="button" className={styles.primary} onClick={onConnect}><UserCircle2 size={16} /> Create account or sign in</button></div>
        </>}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
      </div>
    </section>
  </div></Portal>;
}

function activeSyncRuntime() { return window.TagifySync || syncRuntime; }
function profileLabel(configuration: DesktopSyncConfiguration) { return configuration.profile?.displayName || (configuration.profile?.handle ? `@${configuration.profile.handle}` : `Tagify account …${configuration.accountId.slice(-6)}`); }

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
