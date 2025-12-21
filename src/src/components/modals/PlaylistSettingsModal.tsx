import React, { useState } from "react";
import {
  getPlaylistSettings,
  PlaylistSettings,
  resetToDefaultSettings,
  savePlaylistSettings,
} from "@/utils/PlaylistSettings";
import Portal from "@/components/ui/Portal";

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

  // Handle resetting to defaults with confirmation
  const handleResetDefaults = () => {
    const confirmed = window.confirm(
      "Are you sure you want to reset all playlist settings to their default values? This action cannot be undone."
    );

    if (confirmed) {
      resetToDefaultSettings();
      setSettings(getPlaylistSettings());
      Spicetify.showNotification("Settings reset to defaults");
    }
  };

  return (
    <Portal>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="modal-title">Playlist Cache Settings</h2>
            <button className="modal-close-button" onClick={onClose}>
              ×
            </button>
          </div>

          <div className="modal-body">
            <div className="container">
              <div className="form-field">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.excludeNonOwnedPlaylists}
                    onChange={handleToggleExcludeNonOwned}
                    className="form-checkbox"
                  />
                  Exclude playlists not created by me
                </label>
              </div>

              <div className="container">
                <h3 className="section-title">Exclude Playlists Containing Keywords</h3>
                <div className="form-row">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    className="form-input"
                    placeholder="Enter keyword..."
                    onKeyDown={(e) => e.key === "Enter" && handleAddKeyword()}
                  />
                  <button className="btn" onClick={handleAddKeyword}>
                    Add
                  </button>
                </div>

                <div className="tag-list">
                  {settings.excludedPlaylistKeywords.map((keyword) => (
                    <div key={keyword} className="tag-item">
                      <span className="tag-name">{keyword}</span>
                      <button className="tag-remove" onClick={() => handleRemoveKeyword(keyword)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="container">
                <h3 className="section-title">Exclude by Description</h3>
                <div className="form-row">
                  <input
                    type="text"
                    value={descriptionTermInput}
                    onChange={(e) => setDescriptionTermInput(e.target.value)}
                    className="form-input"
                    placeholder="Enter term to find in description..."
                    onKeyDown={(e) => e.key === "Enter" && handleAddDescriptionTerm()}
                  />
                  <button className="btn" onClick={handleAddDescriptionTerm}>
                    Add
                  </button>
                </div>

                <div className="tag-list">
                  {settings.excludeByDescription.map((term) => (
                    <div key={term} className="tag-item">
                      <span className="tag-name">{term}</span>
                      <button
                        className="tag-remove"
                        onClick={() => handleRemoveDescriptionTerm(term)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn--danger" onClick={handleResetDefaults}>
              Reset to Defaults
            </button>
            <button className="btn btn--primary" onClick={handleSaveSettings}>
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default PlaylistSettingsModal;
