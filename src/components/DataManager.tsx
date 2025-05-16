import React, { useState, useRef } from "react";
import styles from "./DataManager.module.css";
import { TagDataStructure } from "../hooks/useTagData";
import { syncAllTaggedTracks } from "../utils/PlaylistManager";
import { refreshPlaylistCache } from "../utils/PlaylistCache";
import PlaylistSettingsModal from "./PlaylistSettings";

interface DataManagerProps {
  onExportBackup: () => void;
  onImportBackup: (data: TagDataStructure) => void;
  onExportRekordbox: () => void;
  lastSaved: Date | null;
  taggedTracks: Record<string, any>;
  onBackfillBPM?: () => void;
  showMissingTracks: boolean;
  showActions: boolean;
}

const DataManager: React.FC<DataManagerProps> = ({
  onExportBackup,
  onImportBackup,
  onExportRekordbox,
  lastSaved,
  taggedTracks,
  onBackfillBPM,
  showMissingTracks,
  showActions,
}) => {
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshingPlaylists, setIsRefreshingPlaylists] = useState(false);
  const [showPlaylistSettings, setShowPlaylistSettings] = useState(false);
  const [isBackfillingBPM, setIsBackfillingBPM] = useState(false);

  const handleBackfillBPM = async () => {
    if (!onBackfillBPM) return;

    setIsBackfillingBPM(true);
    try {
      await onBackfillBPM();
      Spicetify.showNotification("BPM data updated for all tracks!");
    } catch (error) {
      console.error("Error backfilling BPM data:", error);
      Spicetify.showNotification("Error updating BPM data", true);
    } finally {
      setIsBackfillingBPM(false);
    }
  };

  const handlePlaylistSettingsSaved = async () => {
    // When settings change, we should refresh the cache
    setIsRefreshingPlaylists(true);
    try {
      await refreshPlaylistCache();
    } finally {
      setIsRefreshingPlaylists(false);
    }
  };

  const handleRefreshPlaylists = async () => {
    setIsRefreshingPlaylists(true);
    try {
      await refreshPlaylistCache();
    } finally {
      setIsRefreshingPlaylists(false);
    }
  };

  const handleSyncToPlaylist = async () => {
    setIsSyncing(true);
    try {
      await syncAllTaggedTracks(taggedTracks);
    } finally {
      setIsSyncing(false);
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
        <h3 className={styles.title}>Data Management</h3>
        <div className={styles.headerButtons}>
          <button
            className={`${styles.actionButton} ${showMissingTracks ? styles.activeButton : ""}`}
            onClick={() => {
              // Get current state and toggle it
              const currentState = localStorage.getItem("tagify:activePanel") === "missingTracks";
              const newState = !currentState;

              // Save new state to localStorage
              localStorage.setItem("tagify:activePanel", newState ? "missingTracks" : "main");

              // Trigger app state change via custom event
              window.dispatchEvent(
                new CustomEvent("tagify:toggleMissingTracks", { detail: { show: newState } })
              );

              // Reset actions panel if we're showing missing tracks
              if (newState) {
                localStorage.setItem("tagify:showActions", "false");
                window.dispatchEvent(
                  new CustomEvent("tagify:toggleActions", { detail: { show: false } })
                );
              }
            }}
          >
            {localStorage.getItem("tagify:activePanel") === "missingTracks"
              ? "Hide Missing Tracks"
              : "Show Missing Tracks"}
          </button>
          <button
            className={`${styles.actionButton} ${showActions ? styles.activeButton : ""}`}
            onClick={() => {
              // Get current state and toggle it
              const currentState = localStorage.getItem("tagify:showActions") === "true";
              const newState = !currentState;

              // Save new state to localStorage
              localStorage.setItem("tagify:showActions", newState ? "true" : "false");

              // Trigger app state change via custom event
              window.dispatchEvent(
                new CustomEvent("tagify:toggleActions", { detail: { show: newState } })
              );

              // Reset missing tracks panel if we're showing actions
              if (newState) {
                localStorage.setItem("tagify:activePanel", "main");
                window.dispatchEvent(
                  new CustomEvent("tagify:toggleMissingTracks", { detail: { show: false } })
                );
              }
            }}
          >
            {localStorage.getItem("tagify:showActions") === "true" ? "Hide Actions" : "Actions"}
          </button>
          <button
            className={`${styles.actionButton} ${styles.rekordboxButton}`}
            onClick={onExportRekordbox}
          >
            Export for rekordbox
          </button>
        </div>
      </div>

      {lastSaved && (
        <div className={styles.lastSaved}>Last saved: {lastSaved.toLocaleString()}</div>
      )}

      <div className={styles.actions}>
        <button className={styles.actionButton} onClick={onExportBackup}>
          Export Backup File
        </button>

        <button className={styles.actionButton} onClick={handleImportClick} disabled={isImporting}>
          {isImporting ? "Importing..." : "Import Backup File"}
        </button>

        <button
          className={styles.actionButton}
          onClick={handleSyncToPlaylist}
          disabled={isSyncing || Object.keys(taggedTracks).length === 0}
        >
          {isSyncing ? "Syncing..." : "Sync to TAGGED Playlist"}
        </button>

        <button
          className={styles.actionButton}
          onClick={handleRefreshPlaylists}
          disabled={isRefreshingPlaylists}
        >
          {isRefreshingPlaylists ? "Refreshing..." : "Refresh Playlist Data"}
        </button>

        {onBackfillBPM && (
          <button
            className={styles.actionButton}
            onClick={handleBackfillBPM}
            disabled={isBackfillingBPM}
          >
            {isBackfillingBPM ? "Updating BPMs..." : "Update Track BPMs"}
          </button>
        )}

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

      <div className={styles.info}>
        <p>
          Backup your tag data regularly to prevent data loss. Your data is currently stored in the
          browser's localStorage.
        </p>
        <p>
          Export a backup file to keep your tag data safe. You can import this file later to restore
          your data.
        </p>
      </div>
    </div>
  );
};

export default DataManager;
