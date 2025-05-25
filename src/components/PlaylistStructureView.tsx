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
  const [dragWithinFolder, setDragWithinFolder] = useState<{
    folderPath: string;
    dragIndex: number;
    hoverIndex: number;
  } | null>(null);
  const [initialOrganizationStructure, setInitialOrganizationStructure] = useState<any>(null);

  useEffect(() => {
    fetchPlaylistOrganization();
  }, []);

  useEffect(() => {
    if (playlistOrganization?.playlists && !playlistOrganization?.current_organization) {
      const initialStructure = {
        folders: {},
        root_playlists: playlistOrganization.playlists.map((p: any) => p.name),
      };
      setOrganizationStructure(initialStructure);
      setInitialOrganizationStructure(JSON.parse(JSON.stringify(initialStructure))); // Deep copy
    } else if (playlistOrganization?.current_organization) {
      setOrganizationStructure(playlistOrganization.current_organization);
      setInitialOrganizationStructure(
        JSON.parse(JSON.stringify(playlistOrganization.current_organization))
      ); // Deep copy
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
        playlistsDir: playlistsDir,
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

        // Set the current organization structure from the server response
        if (
          data.current_organization &&
          Object.keys(data.current_organization.folders || {}).length > 0
        ) {
          console.log("Loading existing structure:", data.current_organization);
          setOrganizationStructure(data.current_organization);
        } else {
          console.log("No existing structure found, initializing with all playlists in root");
          // Only set default structure if no existing structure was found
          setOrganizationStructure({
            folders: {},
            root_playlists: data.playlists.map((p: any) => p.name),
            structure_version: "1.0",
          });
        }
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

  const handlePlaylistDrop = (e: React.DragEvent, targetPath: string, playlistIndex: number) => {
    // Only handle drops for same-folder reordering
    if (draggedItem && draggedItem.type === "playlist" && draggedItem.source === targetPath) {
      e.preventDefault();
      e.stopPropagation();
      handleDrop(e, targetPath, "playlist-reorder", playlistIndex);
    }
    // For cross-folder operations, let the event bubble up to the folder
  };

  const getPlaylistDropIndicator = (
    folderPath: string,
    playlistIndex: number,
    dragIndex: number,
    hoverIndex: number
  ) => {
    if (
      !dragWithinFolder ||
      dragWithinFolder.folderPath !== folderPath ||
      dragWithinFolder.hoverIndex !== playlistIndex
    ) {
      return "";
    }

    // Show indicator above when dragging from lower to higher position
    if (dragIndex > hoverIndex) {
      return styles.dragOverPlaylistTop;
    }
    // Show indicator below when dragging from higher to lower position
    else {
      return styles.dragOverPlaylistBottom;
    }
  };

  const handleDragStart = (
    e: React.DragEvent,
    item: any,
    type: "folder" | "playlist",
    source: string = "",
    playlistIndex?: number
  ) => {
    setDraggedItem({ ...item, type, source, playlistIndex });
    setDragWithinFolder(null); // Clear any existing drag state
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ""); // For better browser compatibility
  };

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling
    e.dataTransfer.dropEffect = "move";
    setDraggedOver(targetPath);

    // Clear playlist reorder state when dragging over folder areas
    if (dragWithinFolder && dragWithinFolder.folderPath !== targetPath) {
      setDragWithinFolder(null);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only clear if we're actually leaving the target (not moving to a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDraggedOver(null);
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    // Clean up all drag states when drag operation ends
    setDraggedItem(null);
    setDraggedOver(null);
    setDragWithinFolder(null);
  };

  const handleCancel = () => {
    if (initialOrganizationStructure && organizationModified) {
      if (
        confirm("Are you sure you want to cancel all changes and revert to the original structure?")
      ) {
        setOrganizationStructure(JSON.parse(JSON.stringify(initialOrganizationStructure)));
        setOrganizationModified(false);
        setPreviewChanges(null);
      }
    }
  };

  const handleDrop = (
    e: React.DragEvent,
    targetPath: string,
    dropType: "folder" | "playlist-area" | "playlist-reorder",
    playlistIndex?: number
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Clear all drag states
    setDraggedOver(null);
    setDragWithinFolder(null);

    if (!draggedItem) return;

    if (dropType === "playlist-reorder" && playlistIndex !== undefined) {
      if (draggedItem.type === "playlist" && draggedItem.source === targetPath) {
        handlePlaylistReorder(targetPath, draggedItem.playlistIndex!, playlistIndex);
      }
      setDraggedItem(null);
      return;
    }

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

  const handlePlaylistReorder = (folderPath: string, dragIndex: number, hoverIndex: number) => {
    if (dragIndex === hoverIndex) return;

    const newStructure = { ...organizationStructure };

    if (folderPath === "root") {
      const draggedPlaylist = newStructure.root_playlists[dragIndex];
      const newRootPlaylists = [...newStructure.root_playlists];
      newRootPlaylists.splice(dragIndex, 1);
      newRootPlaylists.splice(hoverIndex, 0, draggedPlaylist);
      newStructure.root_playlists = newRootPlaylists;
    } else {
      if (newStructure.folders[folderPath]) {
        const draggedPlaylist = newStructure.folders[folderPath].playlists[dragIndex];
        const newPlaylists = [...newStructure.folders[folderPath].playlists];
        newPlaylists.splice(dragIndex, 1);
        newPlaylists.splice(hoverIndex, 0, draggedPlaylist);
        newStructure.folders[folderPath].playlists = newPlaylists;
      }
    }

    setOrganizationStructure(newStructure);
    setOrganizationModified(true);
  };

  const handlePlaylistDragOver = (
    e: React.DragEvent,
    folderPath: string,
    playlistIndex: number
  ) => {
    e.preventDefault();

    // Only handle reordering if we're dragging within the same folder
    if (draggedItem && draggedItem.type === "playlist" && draggedItem.source === folderPath) {
      e.stopPropagation(); // Only stop propagation for same-folder operations

      const dragIndex = draggedItem.playlistIndex;
      if (dragIndex !== undefined && dragIndex !== playlistIndex) {
        setDragWithinFolder({
          folderPath,
          dragIndex,
          hoverIndex: playlistIndex,
        });
        setDraggedOver(null); // Clear folder drag state
      }
    }
    // For cross-folder operations, let the event bubble up to the folder drop zone
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

  // Add this helper function at the top of the component
  const createNestedFolder = (basePath: string = "") => {
    const folderName = prompt("Enter folder name:");
    if (folderName && folderName.trim()) {
      const newStructure = { ...organizationStructure };
      const fullPath = basePath ? `${basePath}/${folderName.trim()}` : folderName.trim();
      newStructure.folders[fullPath] = { playlists: [] };
      setOrganizationStructure(newStructure);
      setOrganizationModified(true);
    }
  };

  // Replace the existing createNewFolder function
  const createNewFolder = () => createNestedFolder("");

  // Add this function to get folder hierarchy for better display
  const getFolderHierarchy = () => {
    const folders = organizationStructure.folders || {};
    const hierarchy: any = {};

    // Sort folders by depth (fewer slashes first)
    const sortedFolders = Object.keys(folders).sort((a, b) => {
      const aDepth = (a.match(/\//g) || []).length;
      const bDepth = (b.match(/\//g) || []).length;
      return aDepth - bDepth;
    });

    sortedFolders.forEach((folderPath) => {
      const parts = folderPath.split("/");
      const folderName = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join("/");

      hierarchy[folderPath] = {
        name: folderName,
        path: folderPath,
        parentPath: parentPath || null,
        playlists: folders[folderPath].playlists || [],
        children: [],
      };
    });

    // Build parent-child relationships
    Object.values(hierarchy).forEach((folder: any) => {
      if (folder.parentPath && hierarchy[folder.parentPath]) {
        hierarchy[folder.parentPath].children.push(folder);
      }
    });

    // Return only root level folders (no parent)
    return Object.values(hierarchy).filter((folder: any) => !folder.parentPath);
  };

  // Add this recursive component for rendering nested folders
  const renderFolder = (folder: any, level: number = 0) => (
    <div
      key={folder.path}
      className={styles.folderContainer}
      style={{ marginLeft: `${level * 20}px` }}
    >
      <div className={styles.folderHeader}>
        <span className={styles.folderIcon}>📁</span>
        <span className={styles.folderName}>{folder.name}</span>
        <span className={styles.folderCount}>({folder.playlists.length} playlists)</span>
        <button
          className={styles.createSubfolderButton}
          onClick={() => createNestedFolder(folder.path)}
          title="Create subfolder"
        >
          +
        </button>
        <button
          className={styles.deleteButton}
          onClick={() => deleteFolder(folder.path)}
          title="Delete folder"
        >
          ×
        </button>
      </div>
      <div
        className={`${styles.folderPlaylistsArea} ${
          draggedOver === folder.path ? styles.dragOver : ""
        }`}
        onDragOver={(e) => handleDragOver(e, folder.path)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, folder.path, "playlist-area")}
      >
        {folder.playlists.length === 0 ? (
          <div className={styles.emptyFolder}>Drop playlists here</div>
        ) : (
          <div className={styles.playlistList}>
            {folder.playlists.map((playlistName: string, index: number) => {
              const playlistData = playlistOrganization.playlists.find(
                (p: any) => p.name === playlistName
              );
              const isDraggedOver =
                dragWithinFolder?.folderPath === folder.path &&
                dragWithinFolder?.hoverIndex === index;

              return (
                <div
                  key={`${playlistName}-${index}`}
                  className={`${styles.playlistCard} ${styles.draggable} ${
                    dragWithinFolder?.folderPath === folder.path &&
                    dragWithinFolder?.hoverIndex === index
                      ? getPlaylistDropIndicator(
                          folder.path,
                          index,
                          dragWithinFolder.dragIndex,
                          dragWithinFolder.hoverIndex
                        )
                      : ""
                  }`}
                  draggable
                  onDragStart={(e) =>
                    handleDragStart(e, { name: playlistName }, "playlist", folder.path, index)
                  }
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handlePlaylistDragOver(e, folder.path, index)}
                  onDrop={(e) => handlePlaylistDrop(e, folder.path, index)}
                >
                  <span className={styles.dragHandle}>⋮⋮</span>
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

      {/* Render child folders recursively */}
      {folder.children &&
        folder.children.map((childFolder: any) => renderFolder(childFolder, level + 1))}
    </div>
  );

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
            className={styles.secondaryButton}
            onClick={handleCancel}
            disabled={!organizationModified}
          >
            Cancel Changes
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
        {/* ROOT PLAYLISTS SECTION */}
        <div
          className={`${styles.rootPlaylistsArea} ${draggedOver === "root" ? styles.dragOver : ""}`}
          onDragOver={(e) => handleDragOver(e, "root")}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, "root", "playlist-area")}
        >
          <h4>Root Playlists ({organizationStructure.root_playlists.length})</h4>
          <div className={styles.playlistList}>
            {organizationStructure.root_playlists.map((playlistName: string, index: number) => {
              const playlistData = playlistOrganization.playlists.find(
                (p: any) => p.name === playlistName
              );
              const isDraggedOver =
                dragWithinFolder?.folderPath === "root" && dragWithinFolder?.hoverIndex === index;

              return (
                <div
                  key={`${playlistName}-${index}`}
                  className={`${styles.playlistCard} ${styles.draggable} ${
                    dragWithinFolder?.folderPath === "root" &&
                    dragWithinFolder?.hoverIndex === index
                      ? getPlaylistDropIndicator(
                          "root",
                          index,
                          dragWithinFolder.dragIndex,
                          dragWithinFolder.hoverIndex
                        )
                      : ""
                  }`}
                  draggable
                  onDragStart={(e) =>
                    handleDragStart(e, { name: playlistName }, "playlist", "root", index)
                  }
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handlePlaylistDragOver(e, "root", index)}
                  onDrop={(e) => handlePlaylistDrop(e, "root", index)}
                >
                  <span className={styles.dragHandle}>⋮⋮</span>
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
          {getFolderHierarchy().map((folder: any) => renderFolder(folder))}
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
