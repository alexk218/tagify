// src/components/ValidationPanel.tsx
import React, { useState, useEffect } from "react";
import styles from "./ValidationPanel.module.css";

interface PotentialMismatch {
  file: string;
  track_id: string;
  embedded_artist_title: string;
  filename: string;
  confidence: number;
  full_path: string;
  reason?: string;
}

interface DuplicateTrackId {
  track_id: string;
  files: string[];
}

interface TrackValidationResult {
  success: boolean;
  summary: {
    total_files: number;
    files_with_track_id: number;
    files_without_track_id: number;
    potential_mismatches: number;
    duplicate_track_ids: number;
  };
  potential_mismatches: PotentialMismatch[];
  duplicate_track_ids: Record<string, string[]>;
}

interface PlaylistIssue {
  unidentified_discrepancy: number;
  tracks_with_local_files: number;
  total_discrepancy: number;
  total_associations: number;
  name: string;
  id: string;
  has_m3u: boolean;
  needs_update: boolean;
  expected_track_count: number;
  m3u_track_count: number;
  tracks_missing_from_m3u: any[];
  unexpected_tracks_in_m3u: any[];
  expected_with_local_files: number;
  count_discrepancy: number;
  not_downloaded_tracks: any[];
}

interface PlaylistValidationResult {
  success: boolean;
  summary: {
    total_playlists: number;
    playlists_needing_update: number;
    missing_m3u_files: number;
  };
  playlist_analysis: PlaylistIssue[];
}

interface ValidationPanelProps {
  serverUrl: string;
  masterTracksDir: string;
  playlistsDir: string;
  onClose: () => void;
}

const ValidationPanel: React.FC<ValidationPanelProps> = ({
  serverUrl,
  masterTracksDir,
  playlistsDir,
  onClose,
}) => {
  const [currentTab, setCurrentTab] = useState<"track" | "playlist">("track");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [trackValidationResult, setTrackValidationResult] = useState<TrackValidationResult | null>(
    null
  );
  const [playlistValidationResult, setPlaylistValidationResult] =
    useState<PlaylistValidationResult | null>(null);
  const [selectedMismatch, setSelectedMismatch] = useState<PotentialMismatch | null>(null);
  const [possibleMatches, setPossibleMatches] = useState<any[]>([]);
  const [isFetchingMatches, setIsFetchingMatches] = useState<boolean>(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.75);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [selectedDuplicateTrackId, setSelectedDuplicateTrackId] = useState<string | null>(null);

  const [ignoredTrackPaths, setIgnoredTrackPaths] = useState<Set<string>>(
    new Set(JSON.parse(localStorage.getItem("tagify:ignoredTrackPaths") || "[]"))
  );
  const [showIgnoredTracks, setShowIgnoredTracks] = useState<boolean>(false);
  const [filteredMismatches, setFilteredMismatches] = useState<PotentialMismatch[]>([]);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMoreItems, setHasMoreItems] = useState<boolean>(true);

  const [currentSection, setCurrentSection] = useState<
    "mismatches" | "ignored" | "missing" | "duplicates"
  >("mismatches");
  const [filesMissingTrackId, setFilesMissingTrackId] = useState<PotentialMismatch[]>([]);

  // Run validation when component mounts
  useEffect(() => {
    validateTrackMetadata();
  }, []);

  useEffect(() => {
    if (trackValidationResult) {
      updateFilteredMismatches(
        trackValidationResult.potential_mismatches,
        ignoredTrackPaths,
        showIgnoredTracks
      );
    }
  }, [trackValidationResult, ignoredTrackPaths, showIgnoredTracks]);

  useEffect(() => {
    // If we have a selected mismatch, check if it belongs to the current section
    if (selectedMismatch) {
      const isIgnored = ignoredTrackPaths.has(selectedMismatch.full_path);

      // If we're in the ignored section but the track isn't ignored
      // or if we're in the mismatches section but the track is ignored,
      // deselect it and select an appropriate one
      if (
        (currentSection === "ignored" && !isIgnored) ||
        (currentSection === "mismatches" && isIgnored)
      ) {
        setSelectedMismatch(null);

        // Select first appropriate item
        setTimeout(() => {
          if (filteredMismatches.length > 0) {
            handleSelectMismatch(filteredMismatches[0]);
          }
        }, 0);
      }
    }
  }, [currentSection, selectedMismatch, ignoredTrackPaths, filteredMismatches]);

  const validateTrackMetadata = async (resetPageToOne = true) => {
    if (resetPageToOne) {
      setPage(1);
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${serverUrl}/api/validate-track-metadata`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          masterTracksDir,
          confidence_threshold: confidenceThreshold,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTrackValidationResult(data);
        // Store the files missing TrackId
        setFilesMissingTrackId(data.files_missing_trackid || []);
        updateFilteredMismatches(
          data.potential_mismatches,
          ignoredTrackPaths,
          currentSection === "ignored"
        );
      } else {
        const error = await response.json();
        console.error("Error validating track metadata:", error);
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error validating track metadata:", error);
      Spicetify.showNotification("Error validating track metadata", true);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreItems = async () => {
    if (loadingMore || !hasMoreItems) return;

    setLoadingMore(true);
    setPage(page + 1);
    setLoadingMore(false);
  };

  const validatePlaylists = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${serverUrl}/api/validate-playlists`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          masterTracksDir,
          playlistsDir,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setPlaylistValidationResult(data);
        setCurrentTab("playlist");
      } else {
        const error = await response.json();
        console.error("Error validating playlists:", error);
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error validating playlists:", error);
      Spicetify.showNotification("Error validating playlists", true);
    } finally {
      setIsLoading(false);
    }
  };

  const findPossibleMatches = async (filename: string) => {
    setIsFetchingMatches(true);
    try {
      const response = await fetch(`${serverUrl}/api/fuzzy-match-track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: filename,
          masterTracksDir,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.matches) {
          setPossibleMatches(data.matches);
        } else {
          setPossibleMatches([]);
        }
      } else {
        setPossibleMatches([]);
        const error = await response.json();
        console.error("Error finding matches:", error);
      }
    } catch (error) {
      console.error("Error finding matches:", error);
      setPossibleMatches([]);
    } finally {
      setIsFetchingMatches(false);
    }
  };

  const correctTrackId = async (filePath: string, newTrackId: string) => {
    try {
      const response = await fetch(`${serverUrl}/api/correct-track-id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file_path: filePath,
          new_track_id: newTrackId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          Spicetify.showNotification("TrackId updated successfully");
          // Refresh validation after correction
          setSelectedMismatch(null);
          setPossibleMatches([]);
          validateTrackMetadata();
        } else {
          Spicetify.showNotification(`Error: ${data.message}`, true);
        }
      } else {
        const error = await response.json();
        console.error("Error correcting track ID:", error);
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error correcting track ID:", error);
      Spicetify.showNotification("Error correcting track ID", true);
    }
  };

  const regeneratePlaylist = async (playlistId: string) => {
    try {
      setIsLoading(true);
      console.log(`Regenerating playlist ${playlistId}`);

      const response = await fetch(`${serverUrl}/api/regenerate-playlist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          masterTracksDir,
          playlistsDir,
          playlist_id: playlistId,
          extended: true,
          overwrite: true,
          force: true, // Add force parameter to ensure regeneration
        }),
      });

      const data = await response.json();
      console.log("Regeneration response:", data);

      if (response.ok && data.success) {
        Spicetify.showNotification(`Playlist regenerated successfully: ${data.message}`);
        // Refresh playlist validation after a short delay to ensure file system updates
        setTimeout(() => validatePlaylists(), 1000);
      } else {
        console.error("Error regenerating playlist:", data);
        Spicetify.showNotification(`Error: ${data.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error regenerating playlist:", error);
      Spicetify.showNotification("Error regenerating playlist", true);
    } finally {
      setIsLoading(false);
    }
  };

  const regenerateAllPlaylists = async () => {
    try {
      const response = await fetch(`${serverUrl}/api/generate-m3u`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          masterTracksDir,
          playlistsDir,
          extended: true,
          overwrite: true,
        }),
      });

      if (response.ok) {
        Spicetify.showNotification("All playlists regenerated successfully");
        // Refresh playlist validation
        validatePlaylists();
      } else {
        const error = await response.json();
        console.error("Error regenerating playlists:", error);
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error regenerating playlists:", error);
      Spicetify.showNotification("Error regenerating playlists", true);
    }
  };

  const handleSelectMismatch = (mismatch: PotentialMismatch) => {
    setSelectedMismatch(mismatch);
    findPossibleMatches(mismatch.file);
  };

  const getDuplicateTrackIds = () => {
    if (!trackValidationResult) return {};
    return trackValidationResult.duplicate_track_ids;
  };

  const ignoreTrack = (filePath: string) => {
    const newIgnoredPaths = new Set(ignoredTrackPaths);
    newIgnoredPaths.add(filePath);
    setIgnoredTrackPaths(newIgnoredPaths);
    localStorage.setItem("tagify:ignoredTrackPaths", JSON.stringify([...newIgnoredPaths]));

    // Update filtered mismatches
    updateFilteredMismatches(
      trackValidationResult?.potential_mismatches || [],
      newIgnoredPaths,
      showIgnoredTracks
    );

    // Close the selection panel
    setSelectedMismatch(null);
    setPossibleMatches([]);

    Spicetify.showNotification("Track marked as correctly embedded");
  };

  const removeTrackId = async (filePath: string) => {
    try {
      const response = await fetch(`${serverUrl}/api/remove-track-id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file_path: filePath,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          Spicetify.showNotification("TrackId removed successfully");
          // Refresh validation after removal
          setSelectedMismatch(null);
          setPossibleMatches([]);
          validateTrackMetadata();
        } else {
          Spicetify.showNotification(`Error: ${data.message}`, true);
        }
      } else {
        const error = await response.json();
        console.error("Error removing track ID:", error);
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error removing track ID:", error);
      Spicetify.showNotification("Error removing track ID", true);
    }
  };

  const updateFilteredMismatches = (
    mismatches: PotentialMismatch[],
    ignored: Set<string>,
    showIgnored: boolean
  ) => {
    const filtered = mismatches.filter((mismatch) => {
      const isIgnored = ignored.has(mismatch.full_path);
      return showIgnored ? isIgnored : !isIgnored;
    });
    setFilteredMismatches(filtered);
    setHasMoreItems(filtered.length > pageSize * page);

    // Select first item if none is selected and there are items to select
    if (!selectedMismatch && filtered.length > 0) {
      handleSelectMismatch(filtered[0]);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Track & Playlist Validation</h2>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${currentTab === "track" ? styles.active : ""}`}
            onClick={() => setCurrentTab("track")}
          >
            Track Metadata
          </button>
          <button
            className={`${styles.tab} ${currentTab === "playlist" ? styles.active : ""}`}
            onClick={() => {
              if (!playlistValidationResult) {
                validatePlaylists();
              } else {
                setCurrentTab("playlist");
              }
            }}
          >
            Playlist Integrity
          </button>
        </div>
        <button className={styles.closeButton} onClick={onClose}>
          Close
        </button>
      </div>

      {isLoading ? (
        <div className={styles.loading}>Loading validation results...</div>
      ) : (
        <>
          {currentTab === "track" && trackValidationResult && (
            <div className={styles.trackValidation}>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Total Files:</span>
                  <span className={styles.value}>{trackValidationResult.summary.total_files}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Files with TrackId:</span>
                  <span className={styles.value}>
                    {trackValidationResult.summary.files_with_track_id}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Files without TrackId:</span>
                  <span className={styles.value}>
                    {trackValidationResult.summary.files_without_track_id}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Potential Mismatches:</span>
                  <span
                    className={`${styles.value} ${
                      trackValidationResult.summary.potential_mismatches > 0 ? styles.warning : ""
                    }`}
                  >
                    {trackValidationResult.summary.potential_mismatches}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Duplicate TrackIds:</span>
                  <span
                    className={`${styles.value} ${
                      trackValidationResult.summary.duplicate_track_ids > 0 ? styles.warning : ""
                    }`}
                  >
                    {trackValidationResult.summary.duplicate_track_ids}
                  </span>
                </div>
              </div>

              <div className={styles.tabs}>
                <button
                  className={`${styles.tab} ${
                    currentSection === "mismatches" ? styles.active : ""
                  }`}
                  onClick={() => {
                    setCurrentSection("mismatches");
                    setSelectedDuplicateTrackId(null);
                    setSelectedMismatch(null); // Reset selection

                    // Select first item if available
                    if (trackValidationResult?.potential_mismatches.length > 0) {
                      // Create filtered list first
                      const filtered = trackValidationResult.potential_mismatches.filter(
                        (mismatch) => !ignoredTrackPaths.has(mismatch.full_path)
                      );
                      if (filtered.length > 0) {
                        handleSelectMismatch(filtered[0]);
                      }
                    }

                    updateFilteredMismatches(
                      trackValidationResult?.potential_mismatches || [],
                      ignoredTrackPaths,
                      false
                    );
                  }}
                >
                  Potential Mismatches ({trackValidationResult?.summary.potential_mismatches || 0})
                </button>
                <button
                  className={`${styles.tab} ${currentSection === "missing" ? styles.active : ""}`}
                  onClick={() => {
                    setCurrentSection("missing");
                    setSelectedDuplicateTrackId(null);
                    setSelectedMismatch(null);

                    // Select first item if available
                    if (filesMissingTrackId.length > 0) {
                      handleSelectMismatch(filesMissingTrackId[0]);
                    }
                  }}
                >
                  Missing TrackId ({trackValidationResult?.summary.files_without_track_id || 0})
                </button>
                <button
                  className={`${styles.tab} ${currentSection === "ignored" ? styles.active : ""}`}
                  onClick={() => {
                    setCurrentSection("ignored");
                    setSelectedDuplicateTrackId(null);
                    setSelectedMismatch(null);

                    updateFilteredMismatches(
                      trackValidationResult?.potential_mismatches || [],
                      ignoredTrackPaths,
                      true
                    );

                    // Select first item after filteredMismatches has been updated
                    setTimeout(() => {
                      if (filteredMismatches.length > 0) {
                        handleSelectMismatch(filteredMismatches[0]);
                      }
                    }, 0);
                  }}
                >
                  Ignored Tracks ({ignoredTrackPaths.size})
                </button>
                <button
                  className={`${styles.tab} ${
                    currentSection === "duplicates" ? styles.active : ""
                  }`}
                  onClick={() => {
                    setCurrentSection("duplicates");
                    setSelectedMismatch(null);
                    setSelectedDuplicateTrackId(Object.keys(getDuplicateTrackIds())[0] || null);
                  }}
                  disabled={trackValidationResult?.summary.duplicate_track_ids === 0}
                >
                  Duplicate TrackIds ({trackValidationResult?.summary.duplicate_track_ids || 0})
                </button>
              </div>

              {selectedDuplicateTrackId || currentSection === "duplicates" ? (
                // Show duplicate track IDs
                <div className={styles.duplicatesContainer}>
                  <h3>Duplicate TrackIds</h3>
                  {Object.keys(getDuplicateTrackIds()).length > 0 ? (
                    <div className={styles.splitView}>
                      <div className={styles.duplicatesList}>
                        {Object.entries(getDuplicateTrackIds()).map(([trackId, files], index) => (
                          <div
                            key={index}
                            className={`${styles.duplicateItem} ${
                              selectedDuplicateTrackId === trackId ? styles.selected : ""
                            }`}
                            onClick={() => setSelectedDuplicateTrackId(trackId)}
                          >
                            <div className={styles.duplicateTrackId}>{trackId}</div>
                            <div className={styles.duplicateCount}>{files.length} files</div>
                          </div>
                        ))}
                      </div>

                      <div className={styles.duplicateDetail}>
                        {selectedDuplicateTrackId && (
                          <>
                            <h3>Files with TrackId: {selectedDuplicateTrackId}</h3>
                            <div className={styles.filesList}>
                              {getDuplicateTrackIds()[selectedDuplicateTrackId].map(
                                (file, index) => (
                                  <div key={index} className={styles.fileItem}>
                                    {file}
                                  </div>
                                )
                              )}
                            </div>
                            <div className={styles.duplicateWarning}>
                              <p>
                                Having multiple files with the same TrackId may cause inconsistent
                                playlist behavior. Consider reassigning the correct TrackId to each
                                file.
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.noIssues}>
                      No duplicate TrackIds found! Each TrackId is assigned to only one file.
                    </div>
                  )}
                </div>
              ) : currentSection === "missing" ? (
                // Missing TrackId section
                <div className={styles.mismatchesContainer}>
                  <div className={styles.filterContainer}>
                    <label>
                      Confidence Threshold:
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                      />
                      <span>{confidenceThreshold.toFixed(2)}</span>
                    </label>
                    <button onClick={() => validateTrackMetadata(true)} disabled={isLoading}>
                      Refresh Analysis
                    </button>
                  </div>

                  <h3>Files Missing TrackId</h3>

                  {filesMissingTrackId.length > 0 ? (
                    <div className={styles.splitView}>
                      <div className={styles.mismatchList}>
                        {filesMissingTrackId.slice(0, page * pageSize).map((file, index) => (
                          <div
                            key={index}
                            className={`${styles.mismatchItem} ${
                              selectedMismatch && selectedMismatch.file === file.file
                                ? styles.selected
                                : ""
                            }`}
                            onClick={() => handleSelectMismatch(file)}
                          >
                            <div className={styles.mismatchFile}>{file.file}</div>
                            <div className={styles.mismatchDetails}>
                              <div>
                                <strong>Reason:</strong>{" "}
                                {file.reason === "missing_track_id"
                                  ? "No TrackId embedded"
                                  : file.reason === "error_reading_tags"
                                  ? "Error reading tags"
                                  : file.reason}
                              </div>
                              <div>
                                <strong>Filename:</strong> {file.filename}
                              </div>
                            </div>
                          </div>
                        ))}

                        {filesMissingTrackId.length > page * pageSize && (
                          <div className={styles.loadMoreContainer}>
                            <button
                              className={styles.loadMoreButton}
                              onClick={loadMoreItems}
                              disabled={loadingMore}
                            >
                              {loadingMore ? "Loading..." : "Load More"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className={styles.matchPanel}>
                        {selectedMismatch ? (
                          <>
                            <h3>Options for: {selectedMismatch.file}</h3>
                            {isFetchingMatches ? (
                              <div className={styles.loading}>Finding potential matches...</div>
                            ) : (
                              <>
                                <div className={styles.currentInfo}>
                                  <div>
                                    <strong>Filename:</strong> {selectedMismatch.filename}
                                  </div>
                                  <div>
                                    <strong>Full Path:</strong> {selectedMismatch.full_path}
                                  </div>
                                  <div>
                                    <strong>Reason:</strong>{" "}
                                    {selectedMismatch.reason === "missing_track_id"
                                      ? "No TrackId embedded"
                                      : selectedMismatch.reason === "error_reading_tags"
                                      ? "Error reading tags"
                                      : selectedMismatch.reason}
                                  </div>
                                </div>

                                <h4>Possible Matches:</h4>
                                {possibleMatches.length > 0 ? (
                                  <div className={styles.matchesList}>
                                    {possibleMatches.map((match, index) => (
                                      <div key={index} className={styles.matchOption}>
                                        <div className={styles.matchDetails}>
                                          <div className={styles.matchTitle}>
                                            {match.artist} - {match.title}
                                          </div>
                                          <div className={styles.matchTrackId}>
                                            {match.track_id}
                                          </div>
                                          <div className={styles.matchConfidence}>
                                            Confidence: {(match.ratio * 100).toFixed(2)}%
                                          </div>
                                        </div>
                                        <button
                                          className={styles.applyButton}
                                          onClick={() =>
                                            correctTrackId(
                                              selectedMismatch.full_path,
                                              match.track_id
                                            )
                                          }
                                        >
                                          Apply
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className={styles.noMatches}>
                                    No potential matches found. Try manual search by artist/title in
                                    the search bar.
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        ) : (
                          <div className={styles.noSelection}>
                            Select a file missing TrackId from the list to see options for adding a
                            TrackId.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.noIssues}>
                      No files missing TrackId found! All files have a TrackId embedded.
                    </div>
                  )}
                </div>
              ) : currentSection === "ignored" ? (
                // Ignored Tracks section
                <div className={styles.mismatchesContainer}>
                  <div className={styles.filterContainer}>
                    <label>
                      Confidence Threshold:
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                      />
                      <span>{confidenceThreshold.toFixed(2)}</span>
                    </label>
                    <button onClick={() => validateTrackMetadata(true)} disabled={isLoading}>
                      Refresh Analysis
                    </button>
                  </div>

                  {filteredMismatches.length > 0 ? (
                    <div className={styles.splitView}>
                      <div className={styles.mismatchList}>
                        {filteredMismatches.slice(0, page * pageSize).map((mismatch, index) => (
                          <div
                            key={index}
                            className={`${styles.mismatchItem} ${
                              selectedMismatch && selectedMismatch.file === mismatch.file
                                ? styles.selected
                                : ""
                            }`}
                            onClick={() => handleSelectMismatch(mismatch)}
                          >
                            <div className={styles.mismatchFile}>{mismatch.file}</div>
                            <div className={styles.mismatchDetails}>
                              <div>
                                <strong>Embedded:</strong> {mismatch.embedded_artist_title}
                              </div>
                              <div>
                                <strong>Filename:</strong> {mismatch.filename}
                              </div>
                              <div className={styles.confidenceBar}>
                                <div
                                  className={styles.confidenceFill}
                                  style={{ width: `${mismatch.confidence * 100}%` }}
                                ></div>
                                <span>{(mismatch.confidence * 100).toFixed(0)}%</span>
                              </div>
                            </div>
                          </div>
                        ))}

                        {hasMoreItems && (
                          <div className={styles.loadMoreContainer}>
                            <button
                              className={styles.loadMoreButton}
                              onClick={loadMoreItems}
                              disabled={loadingMore}
                            >
                              {loadingMore ? "Loading..." : "Load More"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className={styles.matchPanel}>
                        {selectedMismatch ? (
                          <>
                            <h3>Ignored Track: {selectedMismatch.file}</h3>
                            <div className={styles.currentInfo}>
                              <div>
                                <strong>Current TrackId:</strong> {selectedMismatch.track_id}
                              </div>
                              <div>
                                <strong>Embedded as:</strong>{" "}
                                {selectedMismatch.embedded_artist_title}
                              </div>
                              <div>
                                <strong>Filename:</strong> {selectedMismatch.filename}
                              </div>
                            </div>

                            <div className={styles.actionButtons}>
                              <button
                                className={styles.removeButton}
                                onClick={() => {
                                  // Remove from ignored tracks and refresh
                                  const newIgnoredPaths = new Set(ignoredTrackPaths);
                                  newIgnoredPaths.delete(selectedMismatch.full_path);
                                  setIgnoredTrackPaths(newIgnoredPaths);
                                  localStorage.setItem(
                                    "tagify:ignoredTrackPaths",
                                    JSON.stringify([...newIgnoredPaths])
                                  );
                                  updateFilteredMismatches(
                                    trackValidationResult?.potential_mismatches || [],
                                    newIgnoredPaths,
                                    true
                                  );
                                  setSelectedMismatch(null);
                                  Spicetify.showNotification("Removed from ignored tracks");
                                }}
                              >
                                Remove from Ignored
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className={styles.noSelection}>
                            Select an ignored track from the list to see details and options.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.noIssues}>
                      No ignored tracks found. Mark tracks as correctly embedded to see them here.
                    </div>
                  )}
                </div>
              ) : (
                // Default section - Potential Mismatches
                <>
                  <div className={styles.filterContainer}>
                    <label>
                      Confidence Threshold:
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                      />
                      <span>{confidenceThreshold.toFixed(2)}</span>
                    </label>
                    <button onClick={() => validateTrackMetadata(true)} disabled={isLoading}>
                      Refresh Analysis
                    </button>
                  </div>

                  <div className={styles.mismatchesContainer}>
                    {filteredMismatches.length > 0 ? (
                      <div className={styles.splitView}>
                        <div className={styles.mismatchList}>
                          {filteredMismatches.slice(0, page * pageSize).map((mismatch, index) => (
                            <div
                              key={index}
                              className={`${styles.mismatchItem} ${
                                selectedMismatch && selectedMismatch.file === mismatch.file
                                  ? styles.selected
                                  : ""
                              }`}
                              onClick={() => handleSelectMismatch(mismatch)}
                            >
                              <div className={styles.mismatchFile}>{mismatch.file}</div>
                              <div className={styles.mismatchDetails}>
                                <div>
                                  <strong>Embedded:</strong> {mismatch.embedded_artist_title}
                                </div>
                                <div>
                                  <strong>Filename:</strong> {mismatch.filename}
                                </div>
                                <div className={styles.confidenceBar}>
                                  <div
                                    className={styles.confidenceFill}
                                    style={{ width: `${mismatch.confidence * 100}%` }}
                                  ></div>
                                  <span>{(mismatch.confidence * 100).toFixed(0)}%</span>
                                </div>
                              </div>
                            </div>
                          ))}

                          {hasMoreItems && (
                            <div className={styles.loadMoreContainer}>
                              <button
                                className={styles.loadMoreButton}
                                onClick={loadMoreItems}
                                disabled={loadingMore}
                              >
                                {loadingMore ? "Loading..." : "Load More"}
                              </button>
                            </div>
                          )}
                        </div>

                        <div className={styles.matchPanel}>
                          {selectedMismatch ? (
                            <>
                              <h3>Options for: {selectedMismatch.file}</h3>
                              {isFetchingMatches ? (
                                <div className={styles.loading}>Finding potential matches...</div>
                              ) : (
                                <>
                                  <div className={styles.currentInfo}>
                                    <div>
                                      <strong>Current TrackId:</strong> {selectedMismatch.track_id}
                                    </div>
                                    <div>
                                      <strong>Embedded as:</strong>{" "}
                                      {selectedMismatch.embedded_artist_title}
                                    </div>
                                    <div>
                                      <strong>Filename:</strong> {selectedMismatch.filename}
                                    </div>
                                    <div>
                                      <strong>Confidence:</strong>{" "}
                                      {(selectedMismatch.confidence * 100).toFixed(2)}%
                                    </div>
                                  </div>

                                  <div className={styles.actionButtons}>
                                    {currentSection === "mismatches" ? (
                                      <>
                                        <button
                                          className={styles.acceptButton}
                                          onClick={() => ignoreTrack(selectedMismatch.full_path)}
                                        >
                                          Mark as Correctly Embedded
                                        </button>
                                        <button
                                          className={styles.removeButton}
                                          onClick={() => removeTrackId(selectedMismatch.full_path)}
                                        >
                                          Remove TrackId
                                        </button>
                                      </>
                                    ) : currentSection === "ignored" ? (
                                      <button
                                        className={styles.removeButton}
                                        onClick={() => {
                                          // Remove from ignored tracks and refresh
                                          const newIgnoredPaths = new Set(ignoredTrackPaths);
                                          newIgnoredPaths.delete(selectedMismatch.full_path);
                                          setIgnoredTrackPaths(newIgnoredPaths);
                                          localStorage.setItem(
                                            "tagify:ignoredTrackPaths",
                                            JSON.stringify([...newIgnoredPaths])
                                          );
                                          updateFilteredMismatches(
                                            trackValidationResult?.potential_mismatches || [],
                                            newIgnoredPaths,
                                            true
                                          );
                                          setSelectedMismatch(null);
                                          Spicetify.showNotification("Removed from ignored tracks");
                                        }}
                                      >
                                        Remove from Ignored
                                      </button>
                                    ) : currentSection === "missing" ? (
                                      <button
                                        className={styles.removeButton}
                                        onClick={() => removeTrackId(selectedMismatch.full_path)}
                                      >
                                        Remove TrackId
                                      </button>
                                    ) : null}
                                  </div>
                                  <h4>Possible Matches:</h4>
                                  {possibleMatches.length > 0 ? (
                                    <div className={styles.matchesList}>
                                      {possibleMatches.map((match, index) => (
                                        <div key={index} className={styles.matchOption}>
                                          <div className={styles.matchDetails}>
                                            <div className={styles.matchTitle}>
                                              {match.artist} - {match.title}
                                            </div>
                                            <div className={styles.matchTrackId}>
                                              {match.track_id}
                                            </div>
                                            <div className={styles.matchConfidence}>
                                              Confidence: {(match.ratio * 100).toFixed(2)}%
                                            </div>
                                          </div>
                                          <button
                                            className={styles.applyButton}
                                            onClick={() =>
                                              correctTrackId(
                                                selectedMismatch.full_path,
                                                match.track_id
                                              )
                                            }
                                          >
                                            Apply
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className={styles.noMatches}>
                                      No potential matches found. Try manual search by artist/title
                                      in the search bar.
                                    </div>
                                  )}
                                </>
                              )}
                            </>
                          ) : (
                            <div className={styles.noSelection}>
                              Select a {showIgnoredTracks ? "ignored track" : "potential mismatch"}{" "}
                              from the list to see options for correction.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.noIssues}>
                        {showIgnoredTracks
                          ? "No ignored tracks found. Mark tracks as correctly embedded to see them here."
                          : "No potential mismatches found! All track metadata appears to be correct."}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {currentTab === "playlist" && playlistValidationResult && (
            <div className={styles.playlistValidation}>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Total Playlists:</span>
                  <span className={styles.value}>
                    {playlistValidationResult.summary.total_playlists}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Playlists Needing Update:</span>
                  <span
                    className={`${styles.value} ${
                      playlistValidationResult.summary.playlists_needing_update > 0
                        ? styles.warning
                        : ""
                    }`}
                  >
                    {playlistValidationResult.summary.playlists_needing_update}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Missing M3U Files:</span>
                  <span
                    className={`${styles.value} ${
                      playlistValidationResult.summary.missing_m3u_files > 0 ? styles.warning : ""
                    }`}
                  >
                    {playlistValidationResult.summary.missing_m3u_files}
                  </span>
                </div>
              </div>

              <div className={styles.actionButtons}>
                <button onClick={validatePlaylists} disabled={isLoading}>
                  Refresh Analysis
                </button>
                <button
                  onClick={regenerateAllPlaylists}
                  disabled={playlistValidationResult.summary.playlists_needing_update === 0}
                  className={styles.primaryButton}
                >
                  Regenerate All Playlists
                </button>
              </div>

              <div className={styles.playlistsContainer}>
                <h3>Playlist Issues</h3>
                {playlistValidationResult.playlist_analysis.length > 0 ? (
                  <div className={styles.playlistList}>
                    {playlistValidationResult.playlist_analysis
                      .filter(
                        (playlist) =>
                          // A playlist needs updating if:
                          playlist.needs_update ||
                          // The number of tracks in M3U doesn't match database associations
                          (playlist.has_m3u &&
                            playlist.m3u_track_count !== playlist.total_associations) ||
                          // Or if the M3U is missing but should exist (playlist has associations)
                          (!playlist.has_m3u && playlist.total_associations > 0)
                      )
                      .map((playlist, index) => (
                        <div key={index} className={styles.playlistItem}>
                          <div className={styles.playlistHeader}>
                            <div className={styles.playlistName}>{playlist.name}</div>
                            <div className={styles.playlistStatus}>
                              {!playlist.has_m3u ? (
                                <span className={styles.missing}>Missing M3U File</span>
                              ) : (
                                <span className={styles.mismatch}>
                                  {playlist.tracks_missing_from_m3u.length} missing,{" "}
                                  {playlist.unexpected_tracks_in_m3u.length} unexpected
                                </span>
                              )}
                              <button
                                className={styles.regenerateButton}
                                onClick={() => regeneratePlaylist(playlist.id)}
                              >
                                Regenerate
                              </button>
                            </div>
                          </div>

                          {playlist.has_m3u && (
                            <div className={styles.playlistDetails}>
                              <div className={styles.trackCounts}>
                                <div>Total tracks in database: {playlist.total_associations}</div>
                                <div>
                                  Tracks with local files: {playlist.tracks_with_local_files}
                                </div>
                                <div>Current tracks in M3U: {playlist.m3u_track_count}</div>

                                {playlist.total_discrepancy !== 0 && (
                                  <div
                                    className={`${styles.discrepancy} ${
                                      Math.abs(playlist.total_discrepancy) > 0 ? styles.warning : ""
                                    }`}
                                  >
                                    <strong>Track Count Discrepancy:</strong>{" "}
                                    {playlist.total_discrepancy > 0
                                      ? `${playlist.total_discrepancy} more tracks in database than in M3U file`
                                      : `${Math.abs(
                                          playlist.total_discrepancy
                                        )} more tracks in M3U file than in database`}
                                  </div>
                                )}
                              </div>

                              {playlist.tracks_missing_from_m3u.length > 0 && (
                                <div className={styles.missingTracks}>
                                  <h4>
                                    Tracks missing from M3U (
                                    {playlist.tracks_missing_from_m3u.length}):
                                  </h4>
                                  <ul>
                                    {playlist.tracks_missing_from_m3u
                                      .slice(0, 5)
                                      .map((track, idx) => (
                                        <li key={idx}>
                                          {track.artists} - {track.title}{" "}
                                          {track.is_local ? "(Local File)" : ""}
                                        </li>
                                      ))}
                                    {playlist.tracks_missing_from_m3u.length > 5 && (
                                      <li className={styles.moreItems}>
                                        ...and {playlist.tracks_missing_from_m3u.length - 5} more
                                      </li>
                                    )}
                                  </ul>
                                </div>
                              )}

                              {playlist.unexpected_tracks_in_m3u.length > 0 && (
                                <div className={styles.unexpectedTracks}>
                                  <h4>
                                    Unexpected tracks in M3U (
                                    {playlist.unexpected_tracks_in_m3u.length}):
                                  </h4>
                                  <ul>
                                    {playlist.unexpected_tracks_in_m3u
                                      .slice(0, 5)
                                      .map((track, idx) => (
                                        <li key={idx}>
                                          {track.artists} - {track.title}{" "}
                                          {track.is_local ? "(Local File)" : ""}
                                        </li>
                                      ))}
                                    {playlist.unexpected_tracks_in_m3u.length > 5 && (
                                      <li className={styles.moreItems}>
                                        ...and {playlist.unexpected_tracks_in_m3u.length - 5} more
                                      </li>
                                    )}
                                  </ul>
                                </div>
                              )}
                              {playlist.not_downloaded_tracks &&
                                playlist.not_downloaded_tracks.length > 0 && (
                                  <div className={styles.notDownloadedTracks}>
                                    <h4>
                                      Tracks in database but not downloaded (
                                      {playlist.not_downloaded_tracks.length}):
                                    </h4>
                                    <ul>
                                      {playlist.not_downloaded_tracks.map((track, idx) => (
                                        <li key={idx}>
                                          {track.artists} - {track.title}{" "}
                                          {track.is_local ? "(Local File)" : ""}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      ))}

                    {playlistValidationResult.playlist_analysis.filter((p) => p.needs_update)
                      .length === 0 && (
                      <div className={styles.noIssues}>
                        All playlists are up to date! No issues detected.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={styles.noIssues}>No playlists found to analyze.</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ValidationPanel;
