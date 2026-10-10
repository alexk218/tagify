import React from "react";
import styles from "./MigrationResultModal.module.css";
import { Portal } from "@/components/ui";
import type { OrchestratorOptions, OrchestratorResult } from "@/services/MigrationOrchestrator";

interface MigrationResultModalProps {
  result: OrchestratorResult;
  onClose: () => void;
  onRetry?: (options?: OrchestratorOptions) => Promise<OrchestratorResult>;
}

type OlderCopyChoice = NonNullable<OrchestratorOptions["olderCopy"]>;

const MigrationResultModal: React.FC<MigrationResultModalProps> = ({
  result,
  onClose,
  onRetry,
}) => {
  const [isRetrying, setIsRetrying] = React.useState(false);
  const [olderCopyChoice, setOlderCopyChoice] = React.useState<OlderCopyChoice | null>(null);

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

  const chooseOlderCopy = async (choice: OlderCopyChoice) => {
    if (!onRetry || olderCopyChoice) return;
    setOlderCopyChoice(choice);
    try {
      const newResult = await onRetry({ olderCopy: choice });
      // A restored copy stays open to explain how to get later changes back.
      if (newResult.success && !newResult.fallbackMode && !newResult.restoredOlderCopy && !newResult.olderCopyNotRestored) {
        onClose();
      }
    } finally {
      setOlderCopyChoice(null);
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
          {result.olderCopy ? (
            <>
              <div className={styles.header}>
                <span className={styles.errorIcon}>⚠️</span>
                <h2 className={styles.title}>Your library on this device is empty</h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  This usually happens after a Spotify update. Tagify kept an older copy of your
                  library on this device. Changes you make aren&apos;t saved until you choose what to do.
                </p>

                <div className={styles.statsGrid}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>
                      {result.olderCopy.trackCount.toLocaleString()}
                    </span>
                    <span className={styles.statLabel}>Tracks in the older copy</span>
                  </div>
                </div>

                <div className={styles.fallbackInfo}>
                  <h3>Your choices</h3>
                  <ul>
                    <li>
                      Restore the older copy to bring back these tracks and tags. Then import your
                      newest backup file to get later changes back.
                    </li>
                    <li>
                      Start fresh with an empty library. The older copy is saved to your Downloads
                      folder as a tagify-older-copy file.
                    </li>
                  </ul>
                </div>
              </div>

              <div className={styles.footer}>
                {onRetry ? (
                  <>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => void chooseOlderCopy("start-fresh")}
                      disabled={olderCopyChoice !== null}
                    >
                      {olderCopyChoice === "start-fresh" ? "Starting fresh..." : "Start fresh"}
                    </button>
                    <button
                      className={styles.primaryButton}
                      onClick={() => void chooseOlderCopy("restore")}
                      disabled={olderCopyChoice !== null}
                    >
                      {olderCopyChoice === "restore" ? "Restoring..." : "Restore older copy"}
                    </button>
                  </>
                ) : (
                  <button className={styles.primaryButton} onClick={onClose}>
                    Close
                  </button>
                )}
              </div>
            </>
          ) : showErrorState && result.fallbackReason === "VersionError" ? (
            <>
              {/* The browser refuses to open a library saved by a newer Tagify
                  with older code, so retrying here can never succeed. */}
              <div className={styles.header}>
                <span className={styles.errorIcon}>⚠️</span>
                <h2 className={styles.title}>Your library was saved by a newer Tagify</h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  This version of Tagify can&apos;t open it, so changes you make now won&apos;t be saved. Nothing has been lost: your tags are still on this device.
                </p>

                <div className={styles.fallbackInfo}>
                  <h3>What you can do</h3>
                  <ul>
                    <li>Install the latest Tagify release, then restart Spotify</li>
                    <li>If you were testing a newer Tagify, reinstall that version instead</li>
                  </ul>
                </div>

                <p className={styles.helpText}>
                  Do not clear Spotify&apos;s saved data while this is unresolved.
                </p>
              </div>

              <div className={styles.footer}>
                <button className={styles.primaryButton} onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          ) : showErrorState ? (
            <>
              <div className={styles.header}>
                <span className={styles.errorIcon}>⚠️</span>
                <h2 className={styles.title}>
                  {isInFallbackMode
                    ? "Tagify can't save changes right now"
                    : "Couldn't open your library"}
                </h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  {isInFallbackMode
                    ? "Tagify couldn't open your saved library on this device, so changes you make now won't be saved. Your saved tags haven't been removed."
                    : "Tagify couldn't finish opening your library. Your saved tags haven't been removed."}
                </p>

                <div className={styles.fallbackInfo}>
                  <h3>What you can do</h3>
                  <ul>
                    <li>Choose Try again. Restarting Spotify can also help.</li>
                    <li>Check that this device has enough free space</li>
                    <li>If it keeps happening, import your newest Tagify backup file or contact support</li>
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
          ) : result.olderCopyNotRestored ? (
            <>
              <div className={styles.header}>
                <span className={styles.errorIcon}>⚠️</span>
                <h2 className={styles.title}>Your newer changes were kept</h2>
              </div>

              <div className={styles.content}>
                <p className={styles.description}>
                  Changes were saved on this device before you chose, so Tagify kept them instead of
                  replacing them with the older copy. The older copy was saved to your Downloads folder
                  as a tagify-older-copy file.
                </p>

                <div className={styles.fallbackInfo}>
                  <h3>Bring back the older copy</h3>
                  <ul>
                    <li>Choose Import in Tagify and select the tagify-older-copy file</li>
                    <li>Tagify saves a copy of your current library to Downloads before importing</li>
                  </ul>
                </div>
              </div>

              <div className={styles.footer}>
                <button className={styles.primaryButton} onClick={onClose}>
                  Got it
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
                  restored the older copy it kept on this device and also saved it to your Downloads
                  folder as a tagify-older-copy file.
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
                    <li>
                      In your Downloads folder, find the newest file named tagify-auto-backup or
                      tagify-backup. Skip tagify-older-copy files: they hold the copy just restored.
                    </li>
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
