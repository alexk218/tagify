import React, { useState } from "react";
import {
  getPlaylistSettings,
  PlaylistSettings,
  resetToDefaultSettings,
  savePlaylistSettings,
} from "../utils/PlaylistSettings";
import styles from "./PlaylistSettings.module.css";

interface PlaylistSettingsModalProps {
  onClose: () => void;
  onSettingsSaved: () => void;
}

const PlaylistSettingsModal: React.FC<PlaylistSettingsModalProps> = ({
  onClose,
  onSettingsSaved,
}) => {
  const [settings, setSettings] = useState<PlaylistSettings>(getPlaylistSettings());
  const [keywordInput, setKeywordInput] = useState("");
  const [descriptionTermInput, setDescriptionTermInput] = useState("");

  // Handle toggle for excluding non-owned playlists
  const handleToggleExcludeNonOwned = () => {
    setSettings({
      ...settings,
      excludeNonOwnedPlaylists: !settings.excludeNonOwnedPlaylists,
    });
  };

  // Handle adding a keyword
  const handleAddKeyword = () => {
    if (keywordInput.trim() && !settings.excludedPlaylistKeywords.includes(keywordInput.trim())) {
      setSettings({
        ...settings,
        excludedPlaylistKeywords: [...settings.excludedPlaylistKeywords, keywordInput.trim()],
      });
      setKeywordInput("");
    }
  };

  // Handle removing a keyword
  const handleRemoveKeyword = (keyword: string) => {
    setSettings({
      ...settings,
      excludedPlaylistKeywords: settings.excludedPlaylistKeywords.filter((k) => k !== keyword),
    });
  };

  // Handle adding a description term
  const handleAddDescriptionTerm = () => {
    if (
      descriptionTermInput.trim() &&
      !settings.excludeByDescription.includes(descriptionTermInput.trim())
    ) {
      setSettings({
        ...settings,
        excludeByDescription: [...settings.excludeByDescription, descriptionTermInput.trim()],
      });
      setDescriptionTermInput("");
    }
  };

  // Handle removing a description term
  const handleRemoveDescriptionTerm = (term: string) => {
    setSettings({
      ...settings,
      excludeByDescription: settings.excludeByDescription.filter((t) => t !== term),
    });
  };

  // Handle saving settings
  const handleSaveSettings = () => {
    savePlaylistSettings(settings);
    onSettingsSaved();
    onClose();
  };

  // Handle resetting to defaults
  const handleResetDefaults = () => {
    resetToDefaultSettings();
    setSettings(getPlaylistSettings());
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Playlist Cache Settings</h2>
          <button className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.settingSection}>
            <div className={styles.settingRow}>
              <label className={styles.settingLabel}>
                <input
                  type="checkbox"
                  checked={settings.excludeNonOwnedPlaylists}
                  onChange={handleToggleExcludeNonOwned}
                  className={styles.checkbox}
                />
                Exclude playlists not created by me
              </label>
            </div>

            <div className={styles.settingSection}>
              <h3 className={styles.sectionTitle}>Exclude Playlists Containing Keywords</h3>
              <div className={styles.inputRow}>
                <input
                  type="text"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  className={styles.input}
                  placeholder="Enter keyword..."
                  onKeyDown={(e) => e.key === "Enter" && handleAddKeyword()}
                />
                <button className={styles.addButton} onClick={handleAddKeyword}>
                  Add
                </button>
              </div>

              <div className={styles.tagList}>
                {settings.excludedPlaylistKeywords.map((keyword) => (
                  <div key={keyword} className={styles.tag}>
                    <span className={styles.tagName}>{keyword}</span>
                    <button
                      className={styles.removeTag}
                      onClick={() => handleRemoveKeyword(keyword)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.settingSection}>
              <h3 className={styles.sectionTitle}>Exclude by Description</h3>
              <div className={styles.inputRow}>
                <input
                  type="text"
                  value={descriptionTermInput}
                  onChange={(e) => setDescriptionTermInput(e.target.value)}
                  className={styles.input}
                  placeholder="Enter term to find in description..."
                  onKeyDown={(e) => e.key === "Enter" && handleAddDescriptionTerm()}
                />
                <button className={styles.addButton} onClick={handleAddDescriptionTerm}>
                  Add
                </button>
              </div>

              <div className={styles.tagList}>
                {settings.excludeByDescription.map((term) => (
                  <div key={term} className={styles.tag}>
                    <span className={styles.tagName}>{term}</span>
                    <button
                      className={styles.removeTag}
                      onClick={() => handleRemoveDescriptionTerm(term)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.actionButtons}>
            <button
              className={`${styles.actionButton} ${styles.dangerButton}`}
              onClick={handleResetDefaults}
            >
              Reset to Defaults
            </button>
            <button
              className={`${styles.actionButton} ${styles.primaryButton}`}
              onClick={handleSaveSettings}
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaylistSettingsModal;
