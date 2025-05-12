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
  name: string;
  id: string;
  has_m3u: boolean;
  needs_update: boolean;
  expected_track_count: number;
  m3u_track_count: number;
  tracks_missing_from_m3u: any[];
  unexpected_tracks_in_m3u: any[];
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

  // Run validation when component mounts
  useEffect(() => {
    validateTrackMetadata();
  }, []);

  const validateTrackMetadata = async () => {
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
      const response = await fetch(`${serverUrl}/api/generate-m3u`, {
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
        }),
      });

      if (response.ok) {
        Spicetify.showNotification("Playlist regenerated successfully");
        // Refresh playlist validation
        validatePlaylists();
      } else {
        const error = await response.json();
        console.error("Error regenerating playlist:", error);
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error regenerating playlist:", error);
      Spicetify.showNotification("Error regenerating playlist", true);
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

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const getPageCount = () => {
    if (!trackValidationResult) return 1;
    return Math.ceil(trackValidationResult.potential_mismatches.length / pageSize);
  };

  const getPaginatedMismatches = () => {
    if (!trackValidationResult) return [];
    const start = (page - 1) * pageSize;
    return trackValidationResult.potential_mismatches.slice(start, start + pageSize);
  };

  const getDuplicateTrackIds = () => {
    if (!trackValidationResult) return {};
    return trackValidationResult.duplicate_track_ids;
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
                  className={`${styles.tab} ${!selectedDuplicateTrackId ? styles.active : ""}`}
                  onClick={() => setSelectedDuplicateTrackId(null)}
                >
                  Potential Mismatches ({trackValidationResult.summary.potential_mismatches})
                </button>
                <button
                  className={`${styles.tab} ${selectedDuplicateTrackId ? styles.active : ""}`}
                  onClick={() =>
                    setSelectedDuplicateTrackId(Object.keys(getDuplicateTrackIds())[0] || null)
                  }
                  disabled={trackValidationResult.summary.duplicate_track_ids === 0}
                >
                  Duplicate TrackIds ({trackValidationResult.summary.duplicate_track_ids})
                </button>
              </div>

              {!selectedDuplicateTrackId ? (
                // Show potential mismatches
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
                    <button onClick={validateTrackMetadata} disabled={isLoading}>
                      Refresh Analysis
                    </button>
                  </div>

                  <div className={styles.mismatchesContainer}>
                    <h3>Potential Mismatches</h3>
                    {trackValidationResult.potential_mismatches.length > 0 ? (
                      <div className={styles.splitView}>
                        <div className={styles.mismatchList}>
                          {getPaginatedMismatches().map((mismatch, index) => (
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
                          {trackValidationResult.potential_mismatches.length > pageSize && (
                            <div className={styles.pagination}>
                              <button
                                onClick={() => handlePageChange(page - 1)}
                                disabled={page === 1}
                              >
                                Previous
                              </button>
                              <span>
                                Page {page} of {getPageCount()}
                              </span>
                              <button
                                onClick={() => handlePageChange(page + 1)}
                                disabled={page === getPageCount()}
                              >
                                Next
                              </button>
                            </div>
                          )}
                        </div>

                        <div className={styles.matchPanel}>
                          {selectedMismatch ? (
                            <>
                              <h3>Possible Matches for: {selectedMismatch.file}</h3>
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

                                  {possibleMatches.length > 0 ? (
                                    <div className={styles.matchesList}>
                                      {possibleMatches.map((match, index) => (
                                        <div key={index} className={styles.matchOption}>
                                          <div className={styles.matchDetails}>
                                            <div className={styles.matchTitle}>
                                              {match.artist} - {match.title}
                                            </div>
                                            <div className={styles.matchAlbum}>{match.album}</div>
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
                              Select a potential mismatch from the list to see options for
                              correction.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.noIssues}>
                        No potential mismatches found! All track metadata appears to be correct.
                      </div>
                    )}
                  </div>
                </>
              ) : (
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
                      .filter((playlist) => playlist.needs_update)
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
                                <div>Expected tracks: {playlist.expected_track_count}</div>
                                <div>Current tracks in M3U: {playlist.m3u_track_count}</div>
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
                                          {track.artists} - {track.title}
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
                                          {track.artists} - {track.title}
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
