import React, { useState, useEffect } from "react";
import styles from "./ValidationPanel.module.css";

interface PotentialMismatch {
  file: string;
  track_id: string | null;
  embedded_artist_title: string;
  filename: string;
  confidence: number;
  full_path: string;
  reason?: string;
  duration?: number;
  duration_formatted?: string;
}

interface FileDetail {
  filename: string;
  path: string;
  duration: number;
  duration_formatted: string;
}

interface DuplicateTrackData {
  track_title: string;
  files: FileDetail[];
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
  duplicate_track_ids: Record<string, DuplicateTrackData>;
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
  location?: string;
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

interface SearchResult {
  file: string;
  track_id: string | null;
  embedded_artist_title: string;
  filename: string;
  confidence: number;
  full_path: string;
}

interface ValidationPanelProps {
  serverUrl: string;
  masterTracksDir: string;
  playlistsDir: string;
  minTrackLengthMinutes: number;
  onClose: () => void;
  validationType?: "track" | "playlist";
  cachedData?: any | null;
  lastUpdated?: number | null;
  onRefresh?: (forceRefresh?: boolean) => Promise<any>;
}

const ValidationPanel: React.FC<ValidationPanelProps> = ({
  serverUrl,
  masterTracksDir,
  playlistsDir,
  minTrackLengthMinutes,
  onClose,
  validationType = "track",
  cachedData = null,
  lastUpdated = null,
  onRefresh,
}) => {
  const [currentTab, setCurrentTab] = useState<"track" | "playlist">(validationType);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [trackValidationResult, setTrackValidationResult] = useState<TrackValidationResult | null>(
    validationType === "track" && cachedData ? cachedData : null
  );

  const [playlistValidationResult, setPlaylistValidationResult] =
    useState<PlaylistValidationResult | null>(
      validationType === "playlist" && cachedData ? cachedData : null
    );
  const [selectedMismatch, setSelectedMismatch] = useState<PotentialMismatch | null>(null);
  const [possibleMatches, setPossibleMatches] = useState<any[]>([]);
  const [isFetchingMatches, setIsFetchingMatches] = useState<boolean>(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.75);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [selectedDuplicateTrackId, setSelectedDuplicateTrackId] = useState<string | null>(null);

  const [ignoredTrackPaths, setIgnoredTrackPaths] = useState<Set<string>>(
    new Set(JSON.parse(localStorage.getItem("tagify:ignoredTrackPaths") || "[]"))
  );
  const [showIgnoredTracks, setShowIgnoredTracks] = useState<boolean>(false);
  const [filteredMismatches, setFilteredMismatches] = useState<PotentialMismatch[]>([]);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMoreItems, setHasMoreItems] = useState<boolean>(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentSection, setCurrentSection] = useState<
    "mismatches" | "ignored" | "missing" | "duplicates" | "search"
  >("mismatches");
  const [filesMissingTrackId, setFilesMissingTrackId] = useState<PotentialMismatch[]>([]);

  // Run validation when component mounts
  useEffect(() => {
    // Load data on tab change only if we don't have it already
    if (currentTab === "track") {
      if (!trackValidationResult) {
        validateTrackMetadata(true, false); // reset page, don't force refresh
      }
    } else if (currentTab === "playlist") {
      if (!playlistValidationResult) {
        validatePlaylists(false); // don't force refresh
      }
    }
  }, [currentTab]);

  useEffect(() => {
    // Handle initial cached data
    if (validationType === "track" && cachedData && !trackValidationResult) {
      setTrackValidationResult(cachedData);
      if (cachedData.files_missing_trackid) {
        setFilesMissingTrackId(cachedData.files_missing_trackid);
      }
      if (cachedData.potential_mismatches) {
        updateFilteredMismatches(
          cachedData.potential_mismatches,
          ignoredTrackPaths,
          currentSection === "ignored"
        );
      }
    } else if (validationType === "playlist" && cachedData && !playlistValidationResult) {
      setPlaylistValidationResult(cachedData);
    }
  }, [validationType, cachedData]);

  const handleManualRefresh = () => {
    if (onRefresh) {
      // When using the parent's refresh mechanism, pass forceRefresh=true
      setIsLoading(true);

      if (currentTab === "track") {
        onRefresh(true)
          .then((data) => {
            if (data) {
              setTrackValidationResult(data);
              setFilesMissingTrackId(data.files_missing_trackid || []);
              updateFilteredMismatches(
                data.potential_mismatches,
                ignoredTrackPaths,
                currentSection === "ignored"
              );
            }
          })
          .catch((error) => {
            console.error("Error refreshing data:", error);
          })
          .finally(() => {
            setIsLoading(false);
          });
      } else if (currentTab === "playlist") {
        onRefresh(true)
          .then((data) => {
            if (data) {
              setPlaylistValidationResult(data);
            }
          })
          .catch((error) => {
            console.error("Error refreshing data:", error);
          })
          .finally(() => {
            setIsLoading(false);
          });
      }
    } else {
      // Fall back to local refresh functions if onRefresh not provided
      if (currentTab === "track") {
        validateTrackMetadata(true, true); // reset page to 1, force refresh
      } else if (currentTab === "playlist") {
        validatePlaylists(true); // force refresh
      }
    }
  };

  useEffect(() => {
    // Update currentTab when validationType prop changes
    setCurrentTab(validationType);
  }, [validationType]);

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

  const validateTrackMetadata = async (resetPageToOne = true, forceRefresh = false) => {
    if (resetPageToOne) {
      setPage(1);
    }

    if (trackValidationResult && !forceRefresh) {
      // Make sure filtered mismatches are up to date with current settings
      updateFilteredMismatches(
        trackValidationResult.potential_mismatches,
        ignoredTrackPaths,
        currentSection === "ignored"
      );
      return;
    }

    setIsLoading(true);

    setIsLoading(true);

    try {
      if (onRefresh) {
        const data = await onRefresh();
        if (data) {
          setTrackValidationResult(data);
          // Store the files missing TrackId
          setFilesMissingTrackId(data.files_missing_trackid || []);
          updateFilteredMismatches(
            data.potential_mismatches,
            ignoredTrackPaths,
            currentSection === "ignored"
          );
        }
      } else {
        const response = await fetch(`${serverUrl}/api/validate-track-metadata`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            masterTracksDir: masterTracksDir,
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
      }
    } catch (error) {
      console.error("Error validating track metadata:", error);
      Spicetify.showNotification("Error validating track metadata", true);
    } finally {
      setIsLoading(false);
    }
  };

  const validatePlaylists = async (forceRefresh = false) => {
    // If we have data and aren't forcing a refresh, use cached data
    if (playlistValidationResult && !forceRefresh) {
      return;
    }

    setIsLoading(true);

    try {
      if (onRefresh) {
        const data = await onRefresh();
        if (data) {
          setPlaylistValidationResult(data);
        }
      } else {
        const response = await fetch(`${serverUrl}/api/validate-playlists`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            masterTracksDir: masterTracksDir,
            playlistsDir: playlistsDir,
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
      }
    } catch (error) {
      console.error("Error validating playlists:", error);
      Spicetify.showNotification("Error validating playlists", true);
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

  const getLastUpdatedText = () => {
    if (!lastUpdated) return "Never updated";

    const date = new Date(lastUpdated);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffMinutes < 1) return "Updated just now";
    if (diffMinutes === 1) return "Updated 1 minute ago";
    if (diffMinutes < 60) return `Updated ${diffMinutes} minutes ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours === 1) return "Updated 1 hour ago";
    if (diffHours < 24) return `Updated ${diffHours} hours ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `Updated ${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
  };

  const isShortTrack = (duration: number) => {
    return duration < minTrackLengthMinutes * 60;
  };

  const findPossibleMatches = async (mismatch: PotentialMismatch | SearchResult) => {
    setIsFetchingMatches(true);

    try {
      const response = await fetch(`${serverUrl}/api/fuzzy-match-track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: mismatch.file,
          masterTracksDir: masterTracksDir,
          currentTrackId: mismatch.track_id,
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
          masterTracksDir: masterTracksDir,
          playlistsDir: playlistsDir,
          playlist_id: playlistId,
          extended: true,
          overwrite: true,
          force: true,
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
      // Determine which playlists need updating
      const playlistsToUpdate = playlistValidationResult?.playlist_analysis
        .filter(
          (playlist) =>
            playlist.needs_update ||
            (playlist.has_m3u && playlist.m3u_track_count !== playlist.total_associations) ||
            (!playlist.has_m3u && playlist.total_associations > 0)
        )
        .map((playlist) => playlist.id);

      if (playlistsToUpdate?.length === 0) {
        Spicetify.showNotification("No playlists need updating");
        return;
      }

      // Show loading state
      setIsLoading(true);

      const response = await fetch(`${serverUrl}/api/generate-m3u`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          masterTracksDir: masterTracksDir,
          playlistsDir: playlistsDir,
          extended: true,
          overwrite: true,
          confirmed: true,
          playlists_to_update: playlistsToUpdate, // Only send the playlists that need updating
        }),
      });

      if (response.ok) {
        const data = await response.json();
        Spicetify.showNotification(
          `${data.stats.playlists_updated} playlists regenerated successfully`
        );
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
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectMismatch = (mismatch: PotentialMismatch | SearchResult) => {
    setSelectedMismatch(mismatch);
    findPossibleMatches(mismatch);
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

  const searchTracks = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);

    try {
      const response = await fetch(`${serverUrl}/api/search-tracks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          masterTracksDir: masterTracksDir,
          query: searchQuery,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Explicitly cast the results to the SearchResult type
          const typedResults: SearchResult[] = data.results || [];
          setSearchResults(typedResults);
          if (typedResults.length > 0) {
            handleSelectMismatch(typedResults[0]);
          } else {
            setSelectedMismatch(null);
            setPossibleMatches([]);
          }
        } else {
          console.error("Search error:", data.message);
          Spicetify.showNotification(`Search error: ${data.message}`, true);
        }
      } else {
        const error = await response.json();
        console.error("Search error:", error);
        Spicetify.showNotification(`Search error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Search error:", error);
      Spicetify.showNotification("Error searching tracks", true);
    } finally {
      setIsSearching(false);
    }
  };

  const confirmDialog = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const confirmed = window.confirm(message);
      resolve(confirmed);
    });
  };

  const deleteFile = async (filePath: string, fileName: string) => {
    const confirmed = await confirmDialog(`Are you sure you want to delete ${fileName}?`);

    if (!confirmed) return;

    try {
      const response = await fetch(`${serverUrl}/api/delete-file`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file_path: filePath }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          Spicetify.showNotification(`File deleted: ${fileName}`);
          // Refresh the validation
          validateTrackMetadata();
        } else {
          Spicetify.showNotification(`Error: ${data.message}`, true);
        }
      } else {
        const error = await response.json();
        console.error("Error deleting file:", error);
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error deleting file:", error);
      Spicetify.showNotification("Error deleting file", true);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Track & Playlist Validation</h2>
        <button className={styles.closeButton} onClick={onClose}>
          Close
        </button>
      </div>

      <div className={styles.subHeader}>
        <div className={styles.lastUpdated}>{getLastUpdatedText()}</div>
        <button className={styles.refreshButton} onClick={handleManualRefresh} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh Data"}
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
                    setSelectedMismatch(null);

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
                  Confirmed Tracks ({ignoredTrackPaths.size})
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
                <button
                  className={`${styles.tab} ${currentSection === "search" ? styles.active : ""}`}
                  onClick={() => {
                    setCurrentSection("search");
                    setSelectedDuplicateTrackId(null);
                    setSelectedMismatch(null);
                  }}
                >
                  Search Tracks
                </button>
              </div>

              {selectedDuplicateTrackId || currentSection === "duplicates" ? (
                // Show duplicate track IDs
                <div className={styles.duplicatesContainer}>
                  <h3>Duplicate TrackIds</h3>
                  {Object.keys(getDuplicateTrackIds()).length > 0 ? (
                    <div className={styles.splitView}>
                      <div className={styles.duplicatesList}>
                        {Object.entries(getDuplicateTrackIds()).map(
                          ([trackId, trackData], index) => (
                            <div
                              key={index}
                              className={`${styles.duplicateItem} ${
                                selectedDuplicateTrackId === trackId ? styles.selected : ""
                              }`}
                              onClick={() => setSelectedDuplicateTrackId(trackId)}
                            >
                              <div className={styles.duplicateTrackId}>{trackId}</div>
                              <div className={styles.duplicateTrackTitle}>
                                {trackData.track_title}
                              </div>
                              <div className={styles.duplicateCount}>
                                {trackData.files.length} files
                              </div>
                            </div>
                          )
                        )}
                      </div>

                      <div className={styles.duplicateDetail}>
                        {selectedDuplicateTrackId && (
                          <>
                            <h3>Files with TrackId: {selectedDuplicateTrackId}</h3>
                            <h4>
                              {getDuplicateTrackIds()[selectedDuplicateTrackId]?.track_title ||
                                "Unknown Track"}
                            </h4>
                            <div className={styles.filesList}>
                              {getDuplicateTrackIds()[selectedDuplicateTrackId]?.files.map(
                                (file, index) => (
                                  <div key={index} className={styles.fileItem}>
                                    <div className={styles.fileInfo}>
                                      <span className={styles.fileName}>{file.filename}</span>
                                      <span
                                        className={
                                          file.duration < 5 * 60
                                            ? styles.fileDurationShort
                                            : styles.fileDuration
                                        }
                                      >
                                        {file.duration_formatted}
                                      </span>
                                    </div>
                                    <button
                                      className={styles.deleteButton}
                                      onClick={() => deleteFile(file.path, file.filename)}
                                      title="Delete file"
                                    >
                                      ×
                                    </button>
                                  </div>
                                )
                              )}
                            </div>
                            <div className={styles.duplicateWarning}>
                              <p>
                                Having multiple files with the same TrackId may cause inconsistent
                                playlist behavior. Consider reassigning the correct TrackId to each
                                file or delete duplicate files.
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
                                  <div
                                    className={
                                      isShortTrack(selectedMismatch.duration ?? 0)
                                        ? styles.fileDurationShort
                                        : styles.fileDuration
                                    }
                                  >
                                    {selectedMismatch.duration_formatted}
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
                            <h3>Confirmed Track: {selectedMismatch.file}</h3>
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
                                  Spicetify.showNotification("Removed from confirmed tracks");
                                }}
                              >
                                Remove from Confirmed
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className={styles.noSelection}>
                            Select a confirmed track from the list to see details and options.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.noIssues}>
                      No confirmed tracks found. Mark tracks as correctly embedded to see them here.
                    </div>
                  )}
                </div>
              ) : currentSection === "search" ? (
                <div className={styles.searchContainer}>
                  <h3>Search for Tracks</h3>
                  <div className={styles.searchBox}>
                    <input
                      type="text"
                      placeholder="Search by artist or title..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={styles.searchInput}
                    />
                    <button
                      className={styles.searchButton}
                      onClick={searchTracks}
                      disabled={isSearching || !searchQuery.trim()}
                    >
                      {isSearching ? "Searching..." : "Search"}
                    </button>
                  </div>

                  <div className={styles.splitView}>
                    <div className={styles.mismatchList}>
                      {searchResults.length > 0 ? (
                        <>
                          {searchResults.map((result, index) => (
                            <div
                              key={index}
                              className={`${styles.mismatchItem} ${
                                selectedMismatch && selectedMismatch.file === result.file
                                  ? styles.selected
                                  : ""
                              }`}
                              onClick={() => handleSelectMismatch(result)}
                            >
                              <div className={styles.mismatchFile}>{result.file}</div>
                              <div className={styles.mismatchDetails}>
                                <div>
                                  <strong>Embedded:</strong> {result.embedded_artist_title}
                                </div>
                                <div>
                                  <strong>TrackId:</strong> {result.track_id || "No TrackId"}
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : searchQuery && !isSearching ? (
                        <div className={styles.noResults}>No results found for "{searchQuery}"</div>
                      ) : !searchQuery ? (
                        <div className={styles.noResults}>Enter a search term to find tracks</div>
                      ) : (
                        <div className={styles.loading}>Searching...</div>
                      )}
                    </div>

                    <div className={styles.matchPanel}>
                      {selectedMismatch ? (
                        <>
                          <h3>Selected Track: {selectedMismatch.file}</h3>
                          {isFetchingMatches ? (
                            <div className={styles.loading}>Finding potential matches...</div>
                          ) : (
                            <>
                              <div className={styles.currentInfo}>
                                <div>
                                  <strong>Current TrackId:</strong>{" "}
                                  {selectedMismatch.track_id || "No TrackId"}
                                </div>
                                <div>
                                  <strong>Embedded as:</strong>{" "}
                                  {selectedMismatch.embedded_artist_title}
                                </div>
                                <div>
                                  <strong>Filename:</strong> {selectedMismatch.filename}
                                </div>
                                <div
                                  className={
                                    isShortTrack(selectedMismatch.duration ?? 0)
                                      ? styles.fileDurationShort
                                      : styles.fileDuration
                                  }
                                ></div>
                              </div>

                              <div className={styles.actionButtons}>
                                {selectedMismatch.track_id && (
                                  <button
                                    className={styles.removeButton}
                                    onClick={() => removeTrackId(selectedMismatch.full_path)}
                                  >
                                    Remove TrackId
                                  </button>
                                )}
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
                                        <div className={styles.matchTrackId}>{match.track_id}</div>
                                        <div className={styles.matchConfidence}>
                                          Confidence: {(match.ratio * 100).toFixed(2)}%
                                        </div>
                                      </div>
                                      <button
                                        className={styles.applyButton}
                                        onClick={() =>
                                          correctTrackId(selectedMismatch.full_path, match.track_id)
                                        }
                                      >
                                        Apply
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className={styles.noMatches}>
                                  No potential matches found. Try refining your search.
                                </div>
                              )}
                            </>
                          )}
                        </>
                      ) : (
                        <div className={styles.noSelection}>
                          Select a track from the search results to see details and options.
                        </div>
                      )}
                    </div>
                  </div>
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
                                    <div
                                      className={
                                        isShortTrack(selectedMismatch.duration ?? 0)
                                          ? styles.fileDurationShort
                                          : styles.fileDuration
                                      }
                                    >
                                      <strong>Track Length:</strong>{" "}
                                      {selectedMismatch.duration_formatted || "Unknown"}
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
                                          Spicetify.showNotification(
                                            "Removed from confirmed tracks"
                                          );
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
                              Select a{" "}
                              {showIgnoredTracks ? "confirmed track" : "potential mismatch"} from
                              the list to see options for correction.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.noIssues}>
                        {showIgnoredTracks
                          ? "No confirmed tracks found. Mark tracks as correctly embedded to see them here."
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
                            <div className={styles.playlistName}>
                              {playlist.name}
                              {playlist.location && playlist.location !== "root" && (
                                <span className={styles.playlistLocation}>
                                  ({playlist.location})
                                </span>
                              )}
                            </div>
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
