import React, { useState, useRef } from "react";
import styles from "./DataManager.module.css";
import "../styles/globals.css";
import { TagDataStructure } from "../hooks/useTagData";
import { fullRefreshPlaylistCache, incrementalRefreshPlaylistCache } from "../utils/PlaylistCache";
import PlaylistSettingsModal from "./PlaylistSettings";
import RefreshModal from "./RefreshModal";
import MainSettingsModal from "./MainSettingsModal";

interface DataManagerProps {
  onExportBackup: () => void;
  onImportBackup: (data: TagDataStructure) => void;
  lastSaved: Date | null;
  taggedTracks: Record<string, any>;
}

const DataManager: React.FC<DataManagerProps> = ({ onExportBackup, onImportBackup, lastSaved }) => {
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshType, setRefreshType] = useState<"quick" | "full" | null>(null);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const [showPlaylistSettings, setShowPlaylistSettings] = useState(false);
  const [showMainSettings, setShowMainSettings] = useState(false);

  const handlePlaylistSettingsSaved = async () => {
    // When settings change, we should do a full refresh to respect new exclusion rules
    setIsRefreshing(true);
    setRefreshType("full");
    try {
      await fullRefreshPlaylistCache();
    } finally {
      setIsRefreshing(false);
      setRefreshType(null);
    }
  };

  const handleFullRefresh = async () => {
    setIsRefreshing(true);
    setRefreshType("full");
    try {
      await fullRefreshPlaylistCache();
    } finally {
      setIsRefreshing(false);
      setRefreshType(null);
    }
  };

  const handleQuickRefresh = async () => {
    setIsRefreshing(true);
    setRefreshType("quick");
    try {
      await incrementalRefreshPlaylistCache();
    } finally {
      setIsRefreshing(false);
      setRefreshType(null);
    }
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    setIsImporting(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        if (
          data &&
          typeof data === "object" &&
          data.categories &&
          Array.isArray(data.categories) &&
          data.tracks &&
          typeof data.tracks === "object"
        ) {
          onImportBackup(data);
          Spicetify.showNotification("Data imported successfully!");
        } else {
          console.error("Invalid backup structure:", data);
          Spicetify.showNotification("Invalid backup file format", true);
        }
      } catch (error) {
        console.error("Error parsing backup file:", error);
        Spicetify.showNotification("Error importing backup", true);
      } finally {
        setIsImporting(false);
        // Reset the file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.onerror = () => {
      Spicetify.showNotification("Error reading backup file", true);
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  return (
    <div className={styles.container}>
      {/* Compact header with title and settings */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h3 className={styles.title}>Data Management</h3>
          {lastSaved && (
            <span className={styles.lastSaved}>Last saved: {lastSaved.toLocaleString()}</span>
          )}
        </div>
        <button
          className={styles.settingsButton}
          onClick={() => setShowMainSettings(true)}
          title="Extension Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Main content area with side-by-side layout */}
      <div className={styles.content}>
        {/* Left side - Action buttons */}
        <div className={styles.actionsPanel}>
          <div className={styles.actionGrid}>
            <button
              className={`${styles.actionButton} ${styles.exportButton}`}
              onClick={onExportBackup}
            >
              <span className={styles.buttonIcon}>📤</span>
              Export Backup
            </button>

            <button
              className={`${styles.actionButton} ${styles.importButton}`}
              onClick={handleImportClick}
              disabled={isImporting}
            >
              <span className={styles.buttonIcon}>📥</span>
              {isImporting ? "Importing..." : "Import Backup"}
            </button>
          </div>
        </div>

        {/* Right side - Information panel */}
        <div className={styles.infoPanel}>
          <div className={styles.infoContent}>
            <p>
              Your tag data is stored locally in your browser. Regular backups prevent data loss and
              enable cross-device syncing.
            </p>
            <div className={styles.infoTips}>
              <div className={styles.tip}>
                <strong>Export:</strong> Creates a downloadable JSON file with all your tags in your Downloads folder
              </div>
              <div className={styles.tip}>
                <strong>Import:</strong> Restores data from a previously exported backup file
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      {/* Modals */}
      {showPlaylistSettings && (
        <PlaylistSettingsModal
          onClose={() => setShowPlaylistSettings(false)}
          onSettingsSaved={handlePlaylistSettingsSaved}
        />
      )}

      {showRefreshModal && (
        <RefreshModal
          onClose={() => setShowRefreshModal(false)}
          onQuickRefresh={handleQuickRefresh}
          onFullRefresh={handleFullRefresh}
          isRefreshing={isRefreshing}
          refreshType={refreshType}
        />
      )}

      {showMainSettings && <MainSettingsModal onClose={() => setShowMainSettings(false)} />}
    </div>
  );
};

export default DataManager;
