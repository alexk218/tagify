import React, { useEffect, useState } from "react";
import { AlertTriangle, CloudDownload, Database, ShieldCheck, X } from "lucide-react";
import { syncRuntime, type RecoveryPreview } from "@/services/sync/SyncRuntime";
import { Portal } from "@/components/ui";
import styles from "./CloudRecoveryModal.module.css";
import { communityErrorMessage } from "./communitySyncCopy";

type RecoveryStatus = ReturnType<typeof syncRuntime.getStatus>;

export function isCloudRecoveryStatus(status: string | undefined): boolean {
  return status === "recovery-available" || status === "restoring" || status === "restore-failed";
}

export function CloudRecoveryModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<RecoveryStatus>(() => activeRuntime().getStatus());
  const [preview, setPreview] = useState<RecoveryPreview | null>(() => activeRuntime().getRecoveryPreview());
  const [error, setError] = useState("");

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const runtime = activeRuntime();
      const next = (event as CustomEvent<{ status?: RecoveryStatus }>).detail?.status || runtime.getStatus();
      const nextPreview = runtime.getRecoveryPreview();
      setStatus(next);
      setPreview(nextPreview);
      if (next === "idle" && !nextPreview) onClose();
    };
    window.addEventListener("tagify:syncStatus", handleStatus);
    return () => window.removeEventListener("tagify:syncStatus", handleStatus);
  }, [onClose]);

  const restore = async () => {
    setError("");
    try {
      await activeRuntime().restoreFromCloud();
      const recovered = activeRuntime().getLastRecovered();
      if (recovered) {
        const playlistSummary = recovered.smartPlaylists === null
          ? ""
          : ` and ${recovered.smartPlaylists.toLocaleString()} smart playlist${recovered.smartPlaylists === 1 ? "" : "s"}`;
        Spicetify.showNotification(
          `Restored ${recovered.annotations.toLocaleString()} tagged items, ${recovered.taxonomyNodes.toLocaleString()} tags and groups${playlistSummary} from Community`,
        );
      }
      onClose();
    } catch (nextError) {
      setError(communityErrorMessage(nextError, "Couldn't restore your library yet. Your Community backup is still safe. Please try again."));
    }
  };

  const restoring = status === "restoring";
  const lastBackup = preview?.lastBackupAt
    ? new Date(preview.lastBackupAt).toLocaleString()
    : "Latest synced Community copy";

  return <Portal><div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="cloud-recovery-title">
    <section className={styles.modal}>
      <header>
        <div><p>Local data recovery</p><h2 id="cloud-recovery-title"><CloudDownload size={21} /> Recover Tagify data</h2></div>
        <button type="button" aria-label="Close recovery" onClick={onClose}><X /></button>
      </header>

      <div className={styles.body}>
        <div className={styles.hero}>
          <AlertTriangle size={25} />
          <div><h3>Your local Tagify library appears to be missing</h3><p>Spotify may have cleared Tagify&apos;s storage on this device. Syncing and local saves are paused, so the empty library cannot replace your Community copy.</p></div>
        </div>

        <div className={styles.safe}><ShieldCheck size={18} /><span><strong>Your Community copy is still available.</strong> Your tags, ratings, Smart Playlists, and settings can be restored onto this device.</span></div>

        {preview ? <div className={styles.stats}>
          <article><strong>{preview.annotations.toLocaleString()}</strong><span>tagged items</span></article>
          <article><strong>{preview.taxonomyNodes.toLocaleString()}</strong><span>tags and groups</span></article>
          <article><strong>{preview.appStateDocuments.toLocaleString()}</strong><span>{preview.protectedDomains.includes("smart-playlists") ? "settings + smart playlists" : "saved settings"}</span></article>
        </div> : <div className={styles.checking}><Database size={18} /><span>Checking your Community library…</span></div>}

        <p className={styles.timestamp}><strong>Cloud copy:</strong> {lastBackup}</p>
        <p className={styles.disclosure}>Tags and ratings for music files on this computer need a backup saved from Tagify. Track names may take a little time to reappear.</p>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!preview || restoring} onClick={() => void restore()}>
            <CloudDownload size={17} /> {restoring ? "Restoring from Community…" : "Restore from Community"}
          </button>
          <button type="button" className={styles.secondary} disabled={restoring} onClick={onClose}>Not now</button>
        </div>
      </div>
    </section>
  </div></Portal>;
}

function activeRuntime() { return window.TagifySync || syncRuntime; }
