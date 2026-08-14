import React from "react";
import styles from "./MainSettingsModal.module.css";
import { Portal } from "@/components/ui";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import {
  migrationOrchestrator,
  type OrchestratorResult,
} from "@/services/MigrationOrchestrator";
import {
  AUTO_FILE_BACKUP_FREQUENCY_OPTIONS,
  AutoFileBackupFrequency,
  DEFAULT_AUTO_FILE_BACKUP_FREQUENCY,
  isAutoFileBackupFrequency,
  TAG_DATA_AUTO_FILE_BACKUP_FREQUENCY_KEY,
} from "../utils/tagData.backup";

interface MainSettingsModalProps {
  onClose: () => void;
  showSupportButtons: boolean;
  onToggleSupportButtons: (showSupportButtons: boolean) => void;
  showUpdateProtectionButton: boolean;
  onToggleUpdateProtectionButton: (showUpdateProtectionButton: boolean) => void;
  onOpenInfoModal?: (section: string) => void;
  onRetryMigration?: () => Promise<OrchestratorResult>;
  onResetTagifyData?: () => Promise<void>;
}

const MainSettingsModal: React.FC<MainSettingsModalProps> = ({
  onClose,
  showSupportButtons,
  onToggleSupportButtons,
  showUpdateProtectionButton,
  onToggleUpdateProtectionButton,
  onOpenInfoModal,
  onRetryMigration,
  onResetTagifyData,
}) => {
  const [extensionSettings, setExtensionSettings] = useLocalStorage<{
    enableTracklistEnhancer: boolean;
    enablePlaybarEnhancer: boolean;
  }>("tagify:extensionSettings", {
    enableTracklistEnhancer: true,
    enablePlaybarEnhancer: true,
  });
  const [keyboardShortcutSettings, setKeyboardShortcutSettings] =
    useLocalStorage<{
      enabled: boolean;
    }>("tagify:keyboardShortcutSettings", {
      enabled: true,
    });
  const [autoBackupFrequency, setAutoBackupFrequency] =
    useLocalStorage<AutoFileBackupFrequency>(
      TAG_DATA_AUTO_FILE_BACKUP_FREQUENCY_KEY,
      DEFAULT_AUTO_FILE_BACKUP_FREQUENCY,
    );

  const [isRetryingMigration, setIsRetryingMigration] = React.useState(false);
  const [isResettingData, setIsResettingData] = React.useState(false);
  const isInFallbackMode = migrationOrchestrator.isFallbackMode();
  const resolvedAutoBackupFrequency = isAutoFileBackupFrequency(autoBackupFrequency)
    ? autoBackupFrequency
    : DEFAULT_AUTO_FILE_BACKUP_FREQUENCY;
  const selectedAutoBackupOption =
    AUTO_FILE_BACKUP_FREQUENCY_OPTIONS.find(
      (option) => option.value === resolvedAutoBackupFrequency,
    ) || AUTO_FILE_BACKUP_FREQUENCY_OPTIONS[0];

  const handleRetryMigration = async () => {
    if (!onRetryMigration) return;
    setIsRetryingMigration(true);
    try {
      const result = await onRetryMigration();
      if (result.success && !result.fallbackMode) {
        Spicetify.showNotification("Storage upgrade successful!", false);
      }
    } catch {
      Spicetify.showNotification("Storage upgrade failed", true);
    } finally {
      setIsRetryingMigration(false);
    }
  };

  const handleResetTagifyData = async () => {
    if (!onResetTagifyData || isResettingData) return;

    const confirmed = window.confirm(
      "Reset Tagify data to defaults? This removes all tagged tracks, tagged playlists, tagged artists, and smart playlists.",
    );
    if (!confirmed) {
      return;
    }

    setIsResettingData(true);
    try {
      await onResetTagifyData();
      Spicetify.showNotification("Tagify data reset to defaults", false);
      onClose();
    } catch (error) {
      console.error("Failed to reset Tagify data:", error);
      Spicetify.showNotification("Failed to reset Tagify data", true);
    } finally {
      setIsResettingData(false);
    }
  };

  const updateExtensionSettings = (key: string, value: boolean) => {
    const newSettings = { ...extensionSettings, [key]: value };
    setExtensionSettings(newSettings);

    // Dispatch event to extension
    window.dispatchEvent(
      new CustomEvent("tagify:settingsChanged", {
        detail: newSettings,
      }),
    );
  };

  const updateKeyboardShortcutSettings = (enabled: boolean) => {
    setKeyboardShortcutSettings({ enabled });

    // Dispatch event to keyboard service
    window.dispatchEvent(
      new CustomEvent("tagify:keyboardSettingsChanged", {
        detail: { enableKeyboardShortcuts: enabled },
      }),
    );
  };

  const handleShortcutsLinkClick = () => {
    onClose();
    onOpenInfoModal?.("shortcuts");
  };

  const handleAutoBackupFrequencyChange = (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextFrequency = event.target.value;
    setAutoBackupFrequency(
      isAutoFileBackupFrequency(nextFrequency)
        ? nextFrequency
        : DEFAULT_AUTO_FILE_BACKUP_FREQUENCY,
    );
  };

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Settings</h2>
            <button className="modal-close-button" onClick={onClose}>
              ×
            </button>
          </div>

          <div className={styles.modalBodyExtensions}>
            <div className={styles.toggleGroup}>
              <div className={`${styles.toggleItem} ${styles.backupSettingItem}`}>
                <div className={styles.toggleInfo}>
                  <label
                    className={styles.toggleLabel}
                    htmlFor="tagify-auto-backup-frequency"
                  >
                    Automatic Backups
                  </label>
                  <span className={styles.toggleDescription}>
                    Download a JSON backup of your tracks, albums/playlists,
                    artists, and tag library when Tagify data changes.
                  </span>
                  <span className={styles.backupFrequencyDescription}>
                    {selectedAutoBackupOption.description}
                  </span>
                  {resolvedAutoBackupFrequency === "never" ? (
                    <span className={styles.backupWarning}>
                      Automatic backups are off. Manual exports are strongly
                      recommended.
                    </span>
                  ) : null}
                </div>
                <select
                  id="tagify-auto-backup-frequency"
                  className={styles.settingsSelect}
                  value={resolvedAutoBackupFrequency}
                  onChange={handleAutoBackupFrequencyChange}
                  aria-label="Automatic backup frequency"
                >
                  {AUTO_FILE_BACKUP_FREQUENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {isInFallbackMode && (
                <div className={styles.toggleItem}>
                  <div className={styles.toggleInfo}>
                    <label className={styles.toggleLabel}>
                      Storage Upgrade
                    </label>
                    <span className={styles.toggleDescription}>
                      Upgrade to IndexedDB storage (removes ~10,000 track limit
                      & speeds up performance)
                    </span>
                  </div>
                  <button
                    className={styles.retryButton}
                    onClick={handleRetryMigration}
                    disabled={isRetryingMigration}
                  >
                    {isRetryingMigration ? "Upgrading..." : "Retry Upgrade"}
                  </button>
                </div>
              )}

              <div className={styles.toggleItem}>
                <div className={styles.toggleInfo}>
                  <label className={styles.toggleLabel}>
                    Keyboard Shortcuts
                  </label>
                  <span className={styles.toggleDescription}>
                    Use number keys to set ratings (1-0 for stars, Shift+1-0 for
                    energy) and more.{" "}
                    <button
                      className={styles.inlineLink}
                      onClick={handleShortcutsLinkClick}
                    >
                      View all shortcuts
                    </button>
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={keyboardShortcutSettings.enabled}
                    onChange={(e) =>
                      updateKeyboardShortcutSettings(e.target.checked)
                    }
                  />
                  <span className={styles.slider}></span>
                </label>
              </div>

              <div className={styles.toggleItem}>
                <div className={styles.toggleInfo}>
                  <label className={styles.toggleLabel}>
                    Tracklist Enhancer
                  </label>
                  <span className={styles.toggleDescription}>
                    Show 'Tagify' column in your playlists
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={extensionSettings.enableTracklistEnhancer}
                    onChange={(e) =>
                      updateExtensionSettings(
                        "enableTracklistEnhancer",
                        e.target.checked,
                      )
                    }
                  />
                  <span className={styles.slider}></span>
                </label>
              </div>

              <div className={styles.toggleItem}>
                <div className={styles.toggleInfo}>
                  <label className={styles.toggleLabel}>Playbar Enhancer</label>
                  <span className={styles.toggleDescription}>
                    Show tag info in Now Playing bar
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={extensionSettings.enablePlaybarEnhancer}
                    onChange={(e) =>
                      updateExtensionSettings(
                        "enablePlaybarEnhancer",
                        e.target.checked,
                      )
                    }
                  />
                  <span className={styles.slider}></span>
                </label>
              </div>

              <div className={styles.toggleItem}>
                <div className={styles.toggleInfo}>
                  <label className={styles.toggleLabel}>Support Buttons</label>
                  <span className={styles.toggleDescription}>
                    Show Feedback and Support buttons in the top menu
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    aria-label="Show support buttons"
                    type="checkbox"
                    checked={showSupportButtons}
                    onChange={(e) => onToggleSupportButtons(e.target.checked)}
                  />
                  <span className={styles.slider}></span>
                </label>
              </div>

              <div className={styles.toggleItem}>
                <div className={styles.toggleInfo}>
                  <label className={styles.toggleLabel}>
                    Update Protection Button
                  </label>
                  <span className={styles.toggleDescription}>
                    Show Spotify update-protection help in the top menu
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    aria-label="Show update protection button"
                    type="checkbox"
                    checked={showUpdateProtectionButton}
                    onChange={(e) =>
                      onToggleUpdateProtectionButton(e.target.checked)
                    }
                  />
                  <span className={styles.slider}></span>
                </label>
              </div>

              <div className={styles.toggleItem}>
                <div className={styles.toggleInfo}>
                  <label className={styles.toggleLabel}>
                    Reset Tagify Data
                  </label>
                  <span className={styles.toggleDescription}>
                    Restore default categories and clear tagged tracks,
                    albums/playlists, artists, and smart playlists
                  </span>
                </div>
                <button
                  className={`${styles.actionButton} ${styles.resetButton}`}
                  onClick={handleResetTagifyData}
                  disabled={isResettingData}
                >
                  {isResettingData ? "Resetting..." : "Reset"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default MainSettingsModal;
