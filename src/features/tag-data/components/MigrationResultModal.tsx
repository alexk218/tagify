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
                    ? "Storage Upgrade Incomplete"
                    : "Migration Issue"}
                </h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  {result.success
                    ? "Tagify is working, but couldn't upgrade to the new storage system. You can continue using Tagify normally, but the ~10,000 track limit will still apply."
                    : "There was a problem during the migration. Don't worry — your data should still be intact."}
                </p>

                {(result.error || result.fallbackReason) && (
                  <div className={styles.errorBox}>
                    <strong>Reason:</strong>{" "}
                    {result.fallbackReason || result.error}
                  </div>
                )}

                <div className={styles.fallbackInfo}>
                  <h3>What this means</h3>
                  <ul>
                    <li>Your data is safe and Tagify will continue working</li>
                    <li>
                      You're using localStorage (limited to ~10,000 tracks)
                    </li>
                    <li>You can retry the upgrade anytime from Settings</li>
                  </ul>
                </div>

                <p className={styles.helpText}>
                  Common fixes: Clear browser cache, ensure sufficient storage
                  space, or try a different browser. If issues persist, export a
                  backup from Settings.
                </p>
              </div>

              <div className={styles.footer}>
                {onRetry && (
                  <button
                    className={styles.secondaryButton}
                    onClick={handleRetry}
                    disabled={isRetrying}
                  >
                    {isRetrying ? "Retrying..." : "Retry Upgrade"}
                  </button>
                )}
                <button className={styles.primaryButton} onClick={onClose}>
                  Continue Anyway
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.header}>
                <span className={styles.successIcon}>✓</span>
                <h2 className={styles.title}>
                  {didStorageMigration
                    ? "Storage Upgrade Complete"
                    : "Migration Complete"}
                </h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  {didStorageMigration
                    ? "Tagify has upgraded to a new storage system that supports virtually unlimited tracks. Your existing data has been safely migrated."
                    : "Your tag data has been updated to the latest format."}
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
                            No more song limit - tag your entire library
                          </span>
                        </li>
                        <li>
                          <span className={styles.benefitIcon}>⚡</span>
                          <span>Faster loading and searching</span>
                        </li>
                        <li>
                          <span className={styles.benefitIcon}>💾</span>
                          <span>More reliable data persistence</span>
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
