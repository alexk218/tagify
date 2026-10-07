import React from "react";
import styles from "./MigrationResultModal.module.css";
import { Portal } from "@/components/ui";
import { OrchestratorResult } from "@/services/MigrationOrchestrator";

interface MigrationResultModalProps {
  result: OrchestratorResult;
  onClose: () => void;
  onRetry?: () => Promise<OrchestratorResult>;
}

const MigrationResultModal: React.FC<MigrationResultModalProps> = ({
  result,
  onClose,
  onRetry,
}) => {
  const [isRetrying, setIsRetrying] = React.useState(false);

  const handleRetry = async () => {
    if (!onRetry) return;
    setIsRetrying(true);
    try {
      const newResult = await onRetry();
      if (newResult.success && !newResult.fallbackMode) {
        onClose();
      }
    } finally {
      setIsRetrying(false);
    }
  };

  const didStorageMigration =
    result.migrationsRun.includes("storageToIndexedDB");
  const isInFallbackMode = result.fallbackMode;
  const showErrorState = !result.success || isInFallbackMode;

  return (
    <Portal>
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          {showErrorState ? (
            <>
              <div className={styles.header}>
                <span className={styles.errorIcon}>⚠️</span>
                <h2 className={styles.title}>
                  {result.success
                    ? "Library update not finished"
                    : "Couldn't finish updating your library"}
                </h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  {result.success
                    ? "You can keep using Tagify. Your library is still saved the same way for now, so very large libraries may need more space."
                    : "Tagify couldn't finish opening your library. Your saved data has not been intentionally removed."}
                </p>

                <div className={styles.fallbackInfo}>
                  <h3>What you can do</h3>
                  <ul>
                    <li>Download a Tagify backup before making more changes</li>
                    <li>Check that this device has enough free space</li>
                    <li>Try again from Settings, or contact support if it keeps happening</li>
                  </ul>
                </div>

                <p className={styles.helpText}>
                  Do not clear Spotify&apos;s saved data while this is unresolved.
                </p>
              </div>

              <div className={styles.footer}>
                {onRetry && (
                  <button
                    className={styles.secondaryButton}
                    onClick={handleRetry}
                    disabled={isRetrying}
                  >
                    {isRetrying ? "Trying again..." : "Try again"}
                  </button>
                )}
                <button className={styles.primaryButton} onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : result.restoredOlderCopy ? (
            <>
              <div className={styles.header}>
                <span className={styles.errorIcon}>⚠️</span>
                <h2 className={styles.title}>Tagify restored an older copy of your library</h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  Your saved library on this device was cleared, usually by a Spotify update. Tagify
                  restored the older copy it kept on this device and saved it to your Downloads folder.
                </p>

                <div className={styles.statsGrid}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>
                      {result.trackCount.toLocaleString()}
                    </span>
                    <span className={styles.statLabel}>Tracks</span>
                  </div>
                </div>

                <div className={styles.fallbackInfo}>
                  <h3>Get your latest changes back</h3>
                  <ul>
                    <li>Look in your Downloads folder for the newest file named tagify-auto-backup or tagify-backup</li>
                    <li>Choose Import in Tagify and select that file</li>
                    <li>If you use Cloud Sync, reconnect it to restore your library from Community</li>
                  </ul>
                </div>
              </div>

              <div className={styles.footer}>
                <button className={styles.primaryButton} onClick={onClose}>
                  Got it
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.header}>
                <span className={styles.successIcon}>✓</span>
                <h2 className={styles.title}>
                  {didStorageMigration
                    ? "Your library is ready"
                    : "Your library is up to date"}
                </h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  {didStorageMigration
                    ? "Tagify can now make room for larger libraries. Your existing tags and ratings are still here."
                    : "Your tags and ratings are ready to use."}
                </p>

                <div className={styles.statsGrid}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>
                      {result.trackCount.toLocaleString()}
                    </span>
                    <span className={styles.statLabel}>Tracks</span>
                  </div>
                </div>

                {didStorageMigration && (
                  <>
                    <div className={styles.backupNotice}>
                      <span className={styles.backupIcon}>📁</span>
                      <div>
                        <strong>Backup Created</strong>
                        <p>
                          A backup of your data was saved to your Downloads
                          folder.
                        </p>
                      </div>
                    </div>

                    <div className={styles.benefits}>
                      <h3>What's New</h3>
                      <ul>
                        <li>
                          <span className={styles.benefitIcon}>🚀</span>
                          <span>
                            More room for songs in your library
                          </span>
                        </li>
                        <li>
                          <span className={styles.benefitIcon}>⚡</span>
                          <span>Faster loading and searching</span>
                        </li>
                        <li>
                          <span className={styles.benefitIcon}>💾</span>
                          <span>More reliable saving</span>
                        </li>
                      </ul>
                    </div>
                  </>
                )}

                {!didStorageMigration && result.migrationsRun.length > 0 && (
                  <div className={styles.migrationsList}>
                    <h3>Updates Applied</h3>
                    <ul>
                      {result.migrationsRun.map((migration) => (
                        <li key={migration}>
                          {migration === "cleanupEmptyTracks" &&
                            "Cleaned up empty track entries"}
                          {migration === "cleanupInlineEditorEmptyTracks" &&
                            "Removed stale tracks with no ratings, energy, or tags"}
                          {migration === "addTrackMetadata" &&
                            "Added track metadata (names, artists, BPM)"}
                          {migration === "removeTrackInfoCache" &&
                            "Optimized data storage"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className={styles.footer}>
                <button className={styles.primaryButton} onClick={onClose}>
                  Got it
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
};

export default MigrationResultModal;
