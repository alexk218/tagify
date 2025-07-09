import React, { useState, useRef } from "react";
import styles from "./DataManager.module.css";
import "../styles/globals.css";
import { TagDataStructure } from "../hooks/useTagData";
import { fullRefreshPlaylistCache, incrementalRefreshPlaylistCache } from "../utils/PlaylistCache";
import PlaylistSettingsModal from "./PlaylistSettings";
import RefreshModal from "./RefreshModal";

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

  // MODIFIED: Handle full refresh from modal
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

  // MODIFIED: Handle quick refresh from modal
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

        // More thorough validation of the data structure
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
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h3 className={styles.title}>Data Management</h3>
          {lastSaved && (
            <div className={styles.lastSaved}>Last saved: {lastSaved.toLocaleString()}</div>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.actionButton} onClick={onExportBackup}>
          Export Backup File
        </button>

        <button className={styles.actionButton} onClick={handleImportClick} disabled={isImporting}>
          {isImporting ? "Importing..." : "Import Backup File"}
        </button>

        <button
          className={styles.actionButton}
          onClick={() => setShowRefreshModal(true)}
          disabled={isRefreshing}
        >
          {isRefreshing
            ? `${refreshType === "quick" ? "Quick" : "Full"} Refreshing...`
            : "Refresh Playlist Data"}
        </button>

        <button className={styles.actionButton} onClick={() => setShowPlaylistSettings(true)}>
          Playlist Settings
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

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

      <div className={styles.info}>
        <p>
          Backup your tag data regularly to prevent data loss. Your data is currently stored in the
          browser's localStorage.
        </p>
        <p>
          <strong>Export</strong> a backup file to keep your tag data safe. You can{" "}
          <strong>import</strong> this file later to restore your data.
        </p>
        <p>
          Use <strong>Refresh Playlist Data</strong> to update which playlists contain your tracks.
          Choose Quick Refresh for regular updates or Full Refresh for complete rebuilds.
        </p>
      </div>
    </div>
  );
};

export default DataManager;
