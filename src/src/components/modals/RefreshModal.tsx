import React from "react";
import styles from "./RefreshModal.module.css";
import Portal from "@/components/ui/Portal";

interface RefreshModalProps {
  onClose: () => void;
  onQuickRefresh: () => void;
  onFullRefresh: () => void;
  isRefreshing: boolean;
  refreshType: "quick" | "full" | null;
}

const RefreshModal: React.FC<RefreshModalProps> = ({
  onClose,
  onQuickRefresh,
  onFullRefresh,
  isRefreshing,
  refreshType,
}) => {
  const handleQuickRefresh = () => {
    onQuickRefresh();
    onClose();
  };

  const handleFullRefresh = () => {
    onFullRefresh();
    onClose();
  };

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Refresh Playlist Data</h2>
            <button className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>

          <div className={styles.modalBody}>
            <p className={styles.description}>
              Choose how you want to refresh your playlist cache. This data is used to show which
              playlists contain your tracks.
            </p>

            <div className={styles.optionsContainer}>
              {/* Quick Refresh Option */}
              <div className={styles.refreshOption}>
                <div className={styles.optionHeader}>
                  <div className={styles.optionIcon}>⚡</div>
                  <div className={styles.optionTitle}>Quick Refresh</div>
                  <div className={styles.optionTime}>~10-30 seconds</div>
                </div>

                <div className={styles.optionDescription}>
                  <p>
                    <strong>Recommended for regular updates</strong>
                  </p>
                  <ul>
                    <li>Only updates playlists that have changed since last refresh</li>
                    <li>Only checks for new liked songs (not all 9000+ songs)</li>
                    <li>Fast and efficient - uses playlist snapshots to detect changes</li>
                    <li>Perfect for daily use</li>
                    <li>Respects your exclusion settings</li>
                  </ul>
                </div>

                <button
                  className={`${styles.refreshButton} ${styles.quickButton}`}
                  onClick={handleQuickRefresh}
                  disabled={isRefreshing}
                >
                  {isRefreshing && refreshType === "quick"
                    ? "Running Quick Refresh..."
                    : "Start Quick Refresh"}
                </button>
              </div>

              {/* Full Refresh Option */}
              <div className={styles.refreshOption}>
                <div className={styles.optionHeader}>
                  <div className={styles.optionIcon}>🔄</div>
                  <div className={styles.optionTitle}>Full Refresh</div>
                  <div className={styles.optionTime}>~2-5 minutes</div>
                </div>

                <div className={styles.optionDescription}>
                  <p>
                    <strong>Complete rebuild from scratch</strong>
                  </p>
                  <ul>
                    <li>Rebuilds the entire playlist cache from zero</li>
                    <li>Processes all liked songs (full sync)</li>
                    <li>Slower but guarantees complete accuracy</li>
                    <li>Use when Quick Refresh isn't working properly</li>
                    <li>Use after changing exclusion settings</li>
                    <li>Use for first-time setup</li>
                  </ul>
                </div>

                <button
                  className={`${styles.refreshButton} ${styles.fullButton}`}
                  onClick={handleFullRefresh}
                  disabled={isRefreshing}
                >
                  {isRefreshing && refreshType === "full"
                    ? "Running Full Refresh..."
                    : "Start Full Refresh"}
                </button>
              </div>
            </div>

            <div className={styles.infoBox}>
              <div className={styles.infoIcon}>💡</div>
              <div className={styles.infoText}>
                <strong>Tip:</strong> Start with Quick Refresh. It only checks for new liked songs
                since your last sync, making it much faster even with thousands of liked songs.
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default RefreshModal;
