import React from "react";
import styles from "./MainSettingsModal.module.css";
import Portal from "@/components/ui/Portal";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { keyboardShortcutService } from "@/services/KeyboardShortcutService";

interface MainSettingsModalProps {
  onClose: () => void;
  showSupportButtons: boolean;
  onToggleSupportButtons: (showSupportButtons: boolean) => void;
}

const MainSettingsModal: React.FC<MainSettingsModalProps> = ({
  onClose,
  showSupportButtons,
  onToggleSupportButtons,
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

  const updateKeyboardShortcutSettings = (enabled: boolean) => {
    setKeyboardShortcutSettings({ enabled });

    // Dispatch event to keyboard service
    window.dispatchEvent(
      new CustomEvent("tagify:keyboardSettingsChanged", {
        detail: { enableKeyboardShortcuts: enabled },
      })
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
              <div className={styles.toggleItem}>
                <div className={styles.toggleInfo}>
                  <label className={styles.toggleLabel}>
                    Keyboard Shortcuts
                  </label>
                  <span className={styles.toggleDescription}>
                    Use number keys to set ratings (1-0 for stars, Shift+1-0 for
                    energy)
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
                        e.target.checked
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
                        e.target.checked
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
                    Show 'Feedback' and 'Support' buttons in top menu
                  </span>
                </div>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={showSupportButtons}
                    onChange={(e) => onToggleSupportButtons(e.target.checked)}
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
