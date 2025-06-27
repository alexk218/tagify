import React, { useState, useEffect } from "react";
import styles from "./DuplicateTracksPanel.module.css";

interface DuplicateTrack {
  title: string;
  artists: string;
  album: string;
  uri: string;
  track_id: string;
  duration_ms: number;
  duration_formatted: string;
  is_local: boolean;
  is_primary?: boolean;
}

interface DuplicateGroup {
  group_id: string;
  requires_user_selection: boolean;
  primary_track: DuplicateTrack;
  duplicates: DuplicateTrack[];
  playlists_affected: string[]; // Now contains playlist names instead of IDs
  playlists_affected_count: number;
  total_tracks_in_group: number;
  all_tracks?: DuplicateTrack[];
}

interface DuplicateTracksReport {
  success: boolean;
  message: string;
  duplicate_groups: DuplicateGroup[];
  total_groups: number;
  total_duplicates: number;
  requires_user_selection?: boolean;
  groups_requiring_selection?: number;
  groups_auto_resolved?: number;
}

interface DuplicateTracksPanelProps {
  serverUrl: string;
  onDetectDuplicates: () => void;
  onCleanupDuplicates: (dryRun: boolean) => void;
}

const DuplicateTracksPanel: React.FC<DuplicateTracksPanelProps> = ({
  serverUrl,
  onDetectDuplicates,
  onCleanupDuplicates,
}) => {
  const [duplicatesReport, setDuplicatesReport] = useState<DuplicateTracksReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const [userSelections, setUserSelections] = useState<Record<string, string>>({});

  const handleTrackSelection = (groupId: string, trackUri: string) => {
    setUserSelections((prev) => ({
      ...prev,
      [groupId]: trackUri,
    }));
  };

  const getSelectedTrackForGroup = (groupId: string): string | undefined => {
    return userSelections[groupId];
  };

  const hasAllRequiredSelections = (): boolean => {
    if (!duplicatesReport?.requires_user_selection) return true;

    const groupsRequiringSelection = duplicatesReport.duplicate_groups.filter(
      (g) => g.requires_user_selection
    );
    return groupsRequiringSelection.every((group) => userSelections[group.group_id]);
  };

  const detectDuplicates = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${serverUrl}/api/tracks/duplicates/detect`);
      const result = await response.json();

      if (result.success) {
        setDuplicatesReport(result);
        onDetectDuplicates();
        Spicetify.showNotification(result.message);
      } else {
        setError(result.message);
        Spicetify.showNotification(`Error: ${result.message}`, true);
      }
    } catch (err) {
      const errorMessage = `Failed to detect duplicates: ${err}`;
      setError(errorMessage);
      Spicetify.showNotification(errorMessage, true);
    } finally {
      setIsLoading(false);
    }
  };

  const cleanupDuplicates = async (dryRun: boolean = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const requestBody: any = { dry_run: dryRun };

      // Include user selections if any groups require manual selection
      if (duplicatesReport?.requires_user_selection && Object.keys(userSelections).length > 0) {
        requestBody.user_selections = userSelections;
      }

      const response = await fetch(`${serverUrl}/api/tracks/duplicates/cleanup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();
      if (result.success) {
        let message = result.message;

        // Add Spotify operations info if not dry run
        if (!dryRun && result.spotify_operations) {
          message += ` (${result.spotify_operations} Spotify playlist updates made)`;
        }

        onCleanupDuplicates(dryRun);
        Spicetify.showNotification(message);

        // Only refresh if dry run or if there might be more duplicates
        if (dryRun || (result.tracks_removed && result.tracks_removed > 0)) {
          try {
            await detectDuplicates();
          } catch (refreshError) {
            console.warn("Could not refresh duplicates after cleanup:", refreshError);
            // Don't show error to user since cleanup was successful
          }
        }
      } else {
        if (result.error === "MANUAL_SELECTION_REQUIRED") {
          Spicetify.showNotification("Manual selection required for some duplicates", true);
        } else {
          setError(result.message);
          Spicetify.showNotification(`Error: ${result.message}`, true);
        }
      }
    } catch (err) {
      const errorMessage = `Failed to cleanup duplicates: ${err}`;
      setError(errorMessage);
      Spicetify.showNotification(errorMessage, true);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleGroupExpansion = (groupIndex: number) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupIndex)) {
      newExpanded.delete(groupIndex);
    } else {
      newExpanded.add(groupIndex);
    }
    setExpandedGroups(newExpanded);
  };

  const formatDuration = (durationMs: number | null | undefined): string => {
    if (!durationMs) return "Unknown";
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const getDurationClass = (track: DuplicateTrack, isPrimary: boolean): string => {
    if (isPrimary) return styles.durationPrimary;
    return track.duration_ms && track.duration_ms > 0
      ? styles.durationSecondary
      : styles.durationUnknown;
  };

  return (
    <div className={styles.duplicateTracksPanel}>
      <div className={styles.panelHeader}>
        <h3>Duplicate Tracks Management</h3>
        <div className={styles.actionButtons}>
          <button onClick={detectDuplicates} disabled={isLoading} className={styles.detectButton}>
            {isLoading ? "Detecting..." : "Detect Duplicates"}
          </button>

          {duplicatesReport && duplicatesReport.total_duplicates > 0 && (
            <>
              <button
                onClick={() => cleanupDuplicates(true)}
                disabled={
                  isLoading ||
                  (duplicatesReport.requires_user_selection && !hasAllRequiredSelections())
                }
                className={styles.previewButton}
                title={
                  duplicatesReport.requires_user_selection && !hasAllRequiredSelections()
                    ? "Please make selections for all groups requiring manual selection"
                    : "Preview what will be cleaned up"
                }
              >
                🔍 Preview Cleanup
              </button>
              <button
                onClick={() => cleanupDuplicates(false)}
                disabled={
                  isLoading ||
                  (duplicatesReport.requires_user_selection && !hasAllRequiredSelections())
                }
                className={styles.cleanupButton}
                title={
                  duplicatesReport.requires_user_selection && !hasAllRequiredSelections()
                    ? "Please make selections for all groups requiring manual selection"
                    : "Permanently remove duplicate tracks"
                }
              >
                {isLoading ? "🔄 Cleaning..." : "🧹 Cleanup Duplicates"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className={styles.errorMessage}>
          <span>⚠️ {error}</span>
        </div>
      )}

      {duplicatesReport && (
        <div className={styles.duplicatesReport}>
          <div className={styles.reportSummary}>
            <h4>Duplicate Detection Results</h4>
            <div className={styles.summaryStats}>
              <span className={styles.stat}>
                <strong>{duplicatesReport.total_groups}</strong> duplicate groups found
              </span>
              <span className={styles.stat}>
                <strong>{duplicatesReport.total_duplicates}</strong> duplicate tracks to remove
              </span>
              {duplicatesReport.requires_user_selection && (
                <>
                  <span className={`${styles.stat} ${styles.manualRequired}`}>
                    <strong>{duplicatesReport.groups_requiring_selection}</strong> groups need
                    manual selection
                  </span>
                  <span className={`${styles.stat} ${styles.autoResolved}`}>
                    <strong>{duplicatesReport.groups_auto_resolved}</strong> groups auto-resolved
                  </span>
                </>
              )}
            </div>

            {duplicatesReport.requires_user_selection && (
              <div className={styles.manualSelectionNotice}>
                <div className={styles.noticeHeader}>⚠️ Manual Selection Required</div>
                <div className={styles.noticeText}>
                  Some duplicates have identical durations. Please select which version to keep for
                  each group.
                </div>
                <div className={styles.selectionProgress}>
                  {Object.keys(userSelections).length} of{" "}
                  {duplicatesReport.groups_requiring_selection} selections made
                </div>
              </div>
            )}
          </div>

          {duplicatesReport.duplicate_groups.length > 0 ? (
            <div className={styles.duplicateGroups}>
              {duplicatesReport.duplicate_groups.map((group, groupIndex) => (
                <div
                  key={groupIndex}
                  className={`${styles.duplicateGroup} ${
                    group.requires_user_selection ? styles.requiresSelection : ""
                  }`}
                >
                  <div
                    className={styles.groupHeader}
                    onClick={() => toggleGroupExpansion(groupIndex)}
                  >
                    <div className={styles.groupInfo}>
                      <span className={styles.groupTitle}>
                        {group.primary_track.artists} - {group.primary_track.title}
                        {group.requires_user_selection && (
                          <span className={styles.manualSelectionBadge}>
                            Manual Selection Required
                          </span>
                        )}
                      </span>
                      <span className={styles.groupMeta}>
                        {group.total_tracks_in_group} versions •{group.duplicates.length} to remove
                        •{group.playlists_affected_count || group.playlists_affected.length}{" "}
                        playlists affected
                      </span>
                    </div>
                    <span className={styles.expandIcon}>
                      {expandedGroups.has(groupIndex) ? "▼" : "▶"}
                    </span>
                  </div>

                  {expandedGroups.has(groupIndex) && (
                    <div className={styles.groupContent}>
                      {group.requires_user_selection ? (
                        /* Manual Selection Interface */
                        <div className={styles.manualSelectionInterface}>
                          <div className={styles.selectionHeader}>
                            <h5>⚖️ Choose which version to keep:</h5>
                            <div className={styles.selectionHint}>
                              All versions have the same duration (
                              {group.primary_track.duration_formatted})
                            </div>
                          </div>

                          <div className={styles.trackSelectionList}>
                            {group.all_tracks?.map((track, trackIndex) => {
                              const isSelected =
                                getSelectedTrackForGroup(group.group_id) === track.uri;
                              return (
                                <div
                                  key={trackIndex}
                                  className={`${styles.trackSelectionItem} ${
                                    isSelected ? styles.selected : ""
                                  }`}
                                  onClick={() => handleTrackSelection(group.group_id, track.uri)}
                                >
                                  <div className={styles.selectionRadio}>
                                    <input
                                      type="radio"
                                      name={`group-${group.group_id}`}
                                      checked={isSelected}
                                      onChange={() =>
                                        handleTrackSelection(group.group_id, track.uri)
                                      }
                                    />
                                  </div>
                                  <div className={styles.trackInfo}>
                                    <div className={styles.trackTitle}>
                                      {track.artists} - {track.title}
                                    </div>
                                    <div className={styles.trackMeta}>
                                      <span className={styles.album}>{track.album}</span>
                                      <span className={styles.duration}>
                                        {track.duration_formatted}
                                      </span>
                                      {track.is_local && (
                                        <span className={styles.localIndicator}>LOCAL</span>
                                      )}
                                      <span className={styles.trackType}>
                                        {track.is_local ? "Local File" : "Spotify Track"}
                                      </span>
                                    </div>
                                    <div className={styles.trackUriSnippet}>
                                      {track.uri?.substring(0, 50)}...
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        /* Auto-Resolved Interface */
                        <>
                          {/* Primary Track (to keep) */}
                          <div className={`${styles.trackItem} ${styles.primaryTrack}`}>
                            <div className={styles.trackIndicator}>✓ KEEP (Longest)</div>
                            <div className={styles.trackInfo}>
                              <div className={styles.trackTitle}>
                                {group.primary_track.artists} - {group.primary_track.title}
                              </div>
                              <div className={styles.trackMeta}>
                                <span className={styles.album}>{group.primary_track.album}</span>
                                <span
                                  className={`${styles.duration} ${getDurationClass(
                                    group.primary_track,
                                    true
                                  )}`}
                                >
                                  {group.primary_track.duration_formatted}
                                </span>
                                {group.primary_track.is_local && (
                                  <span className={styles.localIndicator}>LOCAL</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Duplicate Tracks (to remove) */}
                          {group.duplicates.map((duplicate, duplicateIndex) => (
                            <div
                              key={duplicateIndex}
                              className={`${styles.trackItem} ${styles.duplicateTrack}`}
                            >
                              <div className={styles.trackIndicator}>✗ REMOVE</div>
                              <div className={styles.trackInfo}>
                                <div className={styles.trackTitle}>
                                  {duplicate.artists} - {duplicate.title}
                                </div>
                                <div className={styles.trackMeta}>
                                  <span className={styles.album}>{duplicate.album}</span>
                                  <span
                                    className={`${styles.duration} ${getDurationClass(
                                      duplicate,
                                      false
                                    )}`}
                                  >
                                    {duplicate.duration_formatted}
                                  </span>
                                  {duplicate.is_local && (
                                    <span className={styles.localIndicator}>LOCAL</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}

                      {/* Playlists affected */}
                      {group.playlists_affected.length > 0 && (
                        <div className={styles.affectedPlaylists}>
                          <strong>Playlists where final track will exist:</strong>
                          <div className={styles.playlistList}>
                            {group.playlists_affected.slice(0, 8).map((playlistName, index) => (
                              <span key={index} className={styles.playlistTag}>
                                {playlistName}
                              </span>
                            ))}
                            {group.playlists_affected.length > 8 && (
                              <span className={styles.morePlaylists}>
                                +{group.playlists_affected.length - 8} more
                              </span>
                            )}
                          </div>
                          <div className={styles.playlistsExplanation}>
                            <small>
                              💡 The {group.requires_user_selection ? "selected" : "primary"} track
                              will be added to all these playlists, combining the playlist
                              memberships of all duplicate versions.
                            </small>
                          </div>

                          {/* Spotify sync warning */}
                          <div className={styles.spotifySyncWarning}>
                            <small>
                              ⚠️ <strong>Spotify Sync:</strong> Cleanup will also update your actual
                              Spotify playlists by adding/removing tracks. Use "Preview Cleanup"
                              first to see what will change.
                            </small>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.noDuplicates}>
              <p>🎉 No duplicate tracks found!</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DuplicateTracksPanel;
