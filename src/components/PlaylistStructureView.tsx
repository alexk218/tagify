import React, { useState, useEffect } from "react";
import styles from "./PlaylistStructureView.module.css";

interface PlaylistStructureViewProps {
  serverUrl: string;
  playlistsDir: string;
  masterTracksDir: string;
  onRefresh?: (forceRefresh?: boolean) => Promise<any>;
}

const PlaylistStructureView: React.FC<PlaylistStructureViewProps> = ({
  serverUrl,
  playlistsDir,
  masterTracksDir,
  onRefresh,
}) => {
  const [playlistOrganization, setPlaylistOrganization] = useState<any>(null);
  const [isLoadingOrganization, setIsLoadingOrganization] = useState(false);
  const [organizationModified, setOrganizationModified] = useState(false);
  const [previewChanges, setPreviewChanges] = useState<any>(null);
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);
  const [draggedItem, setDraggedItem] = useState<any>(null);
  const [draggedOver, setDraggedOver] = useState<string | null>(null);
  const [organizationStructure, setOrganizationStructure] = useState<any>({
    folders: {},
    root_playlists: [],
  });

  useEffect(() => {
    fetchPlaylistOrganization();
  }, []);

  useEffect(() => {
    if (playlistOrganization?.playlists) {
      // Initialize with all playlists in root by default
      setOrganizationStructure({
        folders: {},
        root_playlists: playlistOrganization.playlists.map((p: any) => p.name),
      });
    }
  }, [playlistOrganization]);

  const fetchPlaylistOrganization = async () => {
    setIsLoadingOrganization(true);
    try {
      // Get exclusion settings from localStorage
      const exclusionSettings = JSON.parse(
        localStorage.getItem("tagify:playlistSettings") ||
          '{"excludeNonOwnedPlaylists":true,"excludedKeywords":[],"excludedPlaylistIds":[],"excludeByDescription":[]}'
      );

      const queryParams = new URLSearchParams({
        exclusionSettings: JSON.stringify(exclusionSettings),
      });

      const response = await fetch(
        `${serverUrl}/api/validation/playlist-organization?${queryParams}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setPlaylistOrganization(data);
        setOrganizationModified(false);
      } else {
        const error = await response.json();
        console.error("Error fetching playlist organization:", error);
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error fetching playlist organization:", error);
      Spicetify.showNotification("Error fetching playlist organization", true);
    } finally {
      setIsLoadingOrganization(false);
    }
  };

  const previewOrganizationChanges = async (newStructure: any) => {
    try {
      const response = await fetch(`${serverUrl}/api/validation/playlist-organization/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playlistsDir: playlistsDir,
          newStructure: newStructure,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setPreviewChanges(data);
      } else {
        const error = await response.json();
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error previewing changes:", error);
      Spicetify.showNotification("Error previewing changes", true);
    }
  };

  const applyOrganizationChanges = async (newStructure: any, createBackup: boolean = true) => {
    setIsApplyingChanges(true);
    try {
      const response = await fetch(`${serverUrl}/api/validation/playlist-organization/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playlistsDir: playlistsDir,
          masterTracksDir: masterTracksDir,
          newStructure: newStructure,
          createBackup: createBackup,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.errors && data.errors.length > 0) {
          Spicetify.showNotification(
            `Organization applied with ${data.errors.length} errors. Check console for details.`,
            true
          );
          console.error("Organization errors:", data.errors);
        } else {
          Spicetify.showNotification(
            `Organization applied successfully! Created ${data.files_created} files, removed ${data.files_removed} files.`
          );
        }
        setOrganizationModified(false);
        setPreviewChanges(null);

        // Optionally refresh playlist validation
        if (onRefresh) {
          setTimeout(() => onRefresh(true), 1000);
        }
      } else {
        const error = await response.json();
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error applying organization:", error);
      Spicetify.showNotification("Error applying organization", true);
    } finally {
      setIsApplyingChanges(false);
    }
  };

  const handleDragStart = (
    e: React.DragEvent,
    item: any,
    type: "folder" | "playlist",
    source: string = ""
  ) => {
    setDraggedItem({ ...item, type, source });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDraggedOver(targetPath);
  };

  const handleDragLeave = () => {
    setDraggedOver(null);
  };

  const handleDrop = (
    e: React.DragEvent,
    targetPath: string,
    dropType: "folder" | "playlist-area"
  ) => {
    e.preventDefault();
    setDraggedOver(null);

    if (!draggedItem) return;

    const newStructure = { ...organizationStructure };

    if (draggedItem.type === "playlist") {
      // Remove from current location
      if (draggedItem.source === "root") {
        newStructure.root_playlists = newStructure.root_playlists.filter(
          (name: string) => name !== draggedItem.name
        );
      } else {
        if (newStructure.folders[draggedItem.source]) {
          newStructure.folders[draggedItem.source].playlists = newStructure.folders[
            draggedItem.source
          ].playlists.filter((name: string) => name !== draggedItem.name);
        }
      }

      // Add to new location
      if (targetPath === "root") {
        if (!newStructure.root_playlists.includes(draggedItem.name)) {
          newStructure.root_playlists.push(draggedItem.name);
        }
      } else {
        if (!newStructure.folders[targetPath]) {
          newStructure.folders[targetPath] = { playlists: [] };
        }
        if (!newStructure.folders[targetPath].playlists.includes(draggedItem.name)) {
          newStructure.folders[targetPath].playlists.push(draggedItem.name);
        }
      }
    }

    setOrganizationStructure(newStructure);
    setOrganizationModified(true);
    setDraggedItem(null);
  };

  const createNewFolder = () => {
    const folderName = prompt("Enter folder name:");
    if (folderName && folderName.trim()) {
      const newStructure = { ...organizationStructure };
      newStructure.folders[folderName.trim()] = { playlists: [] };
      setOrganizationStructure(newStructure);
      setOrganizationModified(true);
    }
  };

  const deleteFolder = (folderPath: string) => {
    if (!confirm(`Delete folder "${folderPath}" and move its playlists to root?`)) return;

    const newStructure = { ...organizationStructure };
    const folderData = newStructure.folders[folderPath];

    if (folderData?.playlists) {
      // Move playlists to root
      newStructure.root_playlists.push(...folderData.playlists);
    }

    delete newStructure.folders[folderPath];
    setOrganizationStructure(newStructure);
    setOrganizationModified(true);
  };

  const handlePreview = async () => {
    await previewOrganizationChanges(organizationStructure);
  };

  const handleApply = async () => {
    await applyOrganizationChanges(organizationStructure);
  };

  if (isLoadingOrganization) {
    return <div className={styles.loading}>Loading playlists for organization...</div>;
  }

  if (!playlistOrganization) {
    return <div className={styles.noData}>No playlist data available</div>;
  }

  return (
    <div className={styles.playlistStructureContainer}>
      <div className={styles.structureHeader}>
        <h3>Playlist Structure</h3>
        <div className={styles.structureActions}>
          <button className={styles.secondaryButton} onClick={createNewFolder}>
            Create Folder
          </button>
          <button
            className={styles.primaryButton}
            onClick={handlePreview}
            disabled={!organizationModified}
          >
            Preview Changes
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleApply}
            disabled={!organizationModified || isApplyingChanges}
          >
            {isApplyingChanges ? "Applying..." : "Apply Changes"}
          </button>
        </div>
      </div>

      <div className={styles.structureInfo}>
        <p>Total playlists: {playlistOrganization.total_playlists}</p>
        <p>Drag playlists into folders to organize your M3U directory structure.</p>
      </div>

      <div className={styles.structureContent}>
        {/* Root Playlists Area */}
        <div
          className={`${styles.rootPlaylistsArea} ${draggedOver === "root" ? styles.dragOver : ""}`}
          onDragOver={(e) => handleDragOver(e, "root")}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, "root", "playlist-area")}
        >
          <h4>Root Playlists ({organizationStructure.root_playlists.length})</h4>
          <div className={styles.playlistGrid}>
            {organizationStructure.root_playlists.map((playlistName: string) => {
              const playlistData = playlistOrganization.playlists.find(
                (p: any) => p.name === playlistName
              );
              return (
                <div
                  key={playlistName}
                  className={`${styles.playlistCard} ${styles.draggable}`}
                  draggable
                  onDragStart={(e) =>
                    handleDragStart(e, { name: playlistName }, "playlist", "root")
                  }
                >
                  <span className={styles.playlistIcon}>🎵</span>
                  <span className={styles.playlistName}>{playlistName}</span>
                  <span className={styles.playlistCount}>
                    ({playlistData?.track_count || 0} tracks)
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Folders */}
        <div className={styles.foldersContainer}>
          <h4>Folders ({Object.keys(organizationStructure.folders).length})</h4>
          {Object.entries(organizationStructure.folders).map(
            ([folderPath, folderData]: [string, any]) => (
              <div key={folderPath} className={styles.folderContainer}>
                <div className={styles.folderHeader}>
                  <span className={styles.folderIcon}>📁</span>
                  <span className={styles.folderName}>{folderPath}</span>
                  <span className={styles.folderCount}>
                    ({folderData.playlists.length} playlists)
                  </span>
                  <button
                    className={styles.deleteButton}
                    onClick={() => deleteFolder(folderPath)}
                    title="Delete folder"
                  >
                    ×
                  </button>
                </div>
                <div
                  className={`${styles.folderPlaylistsArea} ${
                    draggedOver === folderPath ? styles.dragOver : ""
                  }`}
                  onDragOver={(e) => handleDragOver(e, folderPath)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, folderPath, "playlist-area")}
                >
                  {folderData.playlists.length === 0 ? (
                    <div className={styles.emptyFolder}>Drop playlists here</div>
                  ) : (
                    <div className={styles.playlistGrid}>
                      {folderData.playlists.map((playlistName: string) => {
                        const playlistData = playlistOrganization.playlists.find(
                          (p: any) => p.name === playlistName
                        );
                        return (
                          <div
                            key={playlistName}
                            className={`${styles.playlistCard} ${styles.draggable}`}
                            draggable
                            onDragStart={(e) =>
                              handleDragStart(e, { name: playlistName }, "playlist", folderPath)
                            }
                          >
                            <span className={styles.playlistIcon}>🎵</span>
                            <span className={styles.playlistName}>{playlistName}</span>
                            <span className={styles.playlistCount}>
                              ({playlistData?.track_count || 0} tracks)
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {organizationModified && (
        <div className={styles.modifiedWarning}>
          ⚠️ Structure has been modified. Preview or apply changes to update your M3U directory.
        </div>
      )}

      {previewChanges && (
        <div className={styles.previewModal}>
          <div className={styles.previewContent}>
            <h3>Preview Changes</h3>
            <div className={styles.previewSummary}>
              <p>
                <strong>Folders to create:</strong> {previewChanges.folders_to_create.length}
              </p>
              <p>
                <strong>Files to create:</strong> {previewChanges.files_to_create.length}
              </p>
              <p>
                <strong>Files to move:</strong> {previewChanges.files_to_move.length}
              </p>
              <p>
                <strong>Files to remove:</strong> {previewChanges.files_to_remove.length}
              </p>
              {previewChanges.backup_location && (
                <p>
                  <strong>Backup will be created at:</strong> {previewChanges.backup_location}
                </p>
              )}
            </div>
            <div className={styles.previewActions}>
              <button className={styles.primaryButton} onClick={handleApply}>
                Apply Changes
              </button>
              <button className={styles.secondaryButton} onClick={() => setPreviewChanges(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlaylistStructureView;
