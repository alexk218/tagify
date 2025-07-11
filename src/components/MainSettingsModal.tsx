import React from "react";
import styles from "./RefreshModal.module.css";
import Portal from "../utils/Portal";
import { useLocalStorage } from "../hooks/useLocalStorage";

interface MainSettingsModalProps {
  onClose: () => void;
}

const MainSettingsModal: React.FC<MainSettingsModalProps> = ({ onClose }) => {
  const [extensionSettings, setExtensionSettings] = useLocalStorage<{
    enableTracklistEnhancer: boolean;
    enablePlaybarEnhancer: boolean;
  }>("tagify:extensionSettings", { enableTracklistEnhancer: true, enablePlaybarEnhancer: true });

  const updateExtensionSettings = (key: string, value: boolean) => {
    const newSettings = { ...extensionSettings, [key]: value };
    setExtensionSettings(newSettings);

    // Dispatch event to extension
    window.dispatchEvent(
      new CustomEvent("tagify:settingsChanged", {
        detail: newSettings,
      })
    );
  };

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Extension Settings</h2>
            <button className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>

          <div className={styles.modalBodyExtensions}>
            <div className={styles.toggleGroup}>
              <div className={styles.toggleItem}>
                <div className={styles.toggleInfo}>
                  <label className={styles.toggleLabel}>Tracklist Enhancer</label>
                  <span className={styles.toggleDescription}>Show 'Tagify' column in your playlists</span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={extensionSettings.enableTracklistEnhancer}
                    onChange={(e) =>
                      updateExtensionSettings("enableTracklistEnhancer", e.target.checked)
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
                      updateExtensionSettings("enablePlaybarEnhancer", e.target.checked)
                    }
                  />
                  <span className={styles.slider}></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default MainSettingsModal;
