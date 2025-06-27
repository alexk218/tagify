import React, { useState, useEffect } from "react";
import styles from "./PythonActionsPanel.module.css";
import "../styles/globals.css";
import Portal from "../utils/Portal";

interface Match {
  track_id: string;
  artist: string;
  title: string;
  album: string;
  ratio: number;
  confidence: number;
  is_local: boolean;
  uri?: string;
}

interface FileMappingSelection {
  file_path: string;
  uri: string;
  confidence: number;
  file_name: string;
}

interface MatchSelection {
  fileName?: string;
  trackId?: string;
  file_name?: string;
  file_path?: string;
  uri?: string;
  confidence: number;
}

interface FileToProcess {
  file_path: string;
  file_name: string;
}

interface AnalysisResultsFileMapping {
  stage: string;
  success: boolean;
  message: string;
  needs_confirmation: boolean;
  requires_fuzzy_matching?: boolean;
  requires_user_selection: boolean;
  details: {
    files_requiring_user_input: FileToProcess[];
    auto_matched_files: any[];
    total_files: number;
    files_without_mappings: number;
  };
}

interface FileMappingResponse {
  success: boolean;
  stage: string;
  message: string;
  successful_mappings: number;
  failed_mappings: number;
  results: any[];
  total_processed: number;
  pendingSelections?: any[];
}

interface FileMappingWizardProps {
  currentAction: any;
  analysisResults: AnalysisResultsFileMapping | null;
  autoMatchResults: AnalysisResultsFileMapping | null;
  allUnmappedFiles: FileToProcess[];
  userMatchSelections: (MatchSelection | FileMappingSelection)[];
  skippedFiles: string[];
  fuzzyMatchingState: {
    isActive: boolean;
    currentFileIndex: number;
    matches: Match[];
    isLoading: boolean;
  };
  rejectedAutoMatches: string[];
  autoMatchedPage: number;
  fileMappingConfidenceThreshold: number;
  analysisConfidenceThreshold: number;
  searchQuery: string;
  searchResults: Match[];
  isSearching: boolean;
  showSearchResults: boolean;
  isLoading: Record<string, boolean>;
  settings: {
    serverUrl: string;
    masterTracksDir: string;
    playlistsDir: string;
    masterPlaylistId: string;
    minTrackLengthMinutes: number;
    rekordboxXmlPath: string;
  };
  onUserMatchSelectionsChange: (selections: (MatchSelection | FileMappingSelection)[]) => void;
  onSkippedFilesChange: (files: string[]) => void;
  onFuzzyMatchingStateChange: (state: any) => void;
  onRejectedAutoMatchesChange: (rejected: string[]) => void;
  onAutoMatchedPageChange: (page: number) => void;
  onFileMappingConfidenceThresholdChange: (threshold: number) => void;
  onAutoMatchResultsChange: (results: AnalysisResultsFileMapping | null) => void;
  onAnalysisResultsChange: (results: AnalysisResultsFileMapping | null) => void;
  onAllUnmappedFilesChange: (files: FileToProcess[]) => void;
  onSearchQueryChange: (query: string) => void;
  onSearchResultsChange: (results: Match[]) => void;
  onIsSearchingChange: (isSearching: boolean) => void;
  onShowSearchResultsChange: (show: boolean) => void;
  onMappingResultsChange: (results: FileMappingResponse | null) => void;
  onShowMappingResultsChange: (show: boolean) => void;
  onClosePanel: () => void;
  onIsLoadingChange: (loadingState: Record<string, boolean>) => void;
}

const FileMappingWizard: React.FC<FileMappingWizardProps> = ({
  currentAction,
  analysisResults,
  autoMatchResults,
  allUnmappedFiles,
  userMatchSelections,
  skippedFiles,
  fuzzyMatchingState,
  rejectedAutoMatches,
  autoMatchedPage,
  fileMappingConfidenceThreshold,
  analysisConfidenceThreshold,
  searchQuery,
  searchResults,
  isSearching,
  showSearchResults,
  isLoading,
  settings,
  onUserMatchSelectionsChange,
  onSkippedFilesChange,
  onFuzzyMatchingStateChange,
  onRejectedAutoMatchesChange,
  onAutoMatchedPageChange,
  onFileMappingConfidenceThresholdChange,
  onAutoMatchResultsChange,
  onAnalysisResultsChange,
  onAllUnmappedFilesChange,
  onSearchQueryChange,
  onSearchResultsChange,
  onIsSearchingChange,
  onShowSearchResultsChange,
  onMappingResultsChange,
  onShowMappingResultsChange,
  onClosePanel,
  onIsLoadingChange,
}) => {
  const [localMatches, setLocalMatches] = useState<any[]>([]);
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const [hasCalledAPI, setHasCalledAPI] = useState(false);

  const [showClearConfirmation, setShowClearConfirmation] = useState(false);

  const autoMatchedPerPage = 20;

  const isFileMapping = currentAction?.name === "create-file-mappings";

  // Use allUnmappedFiles if available, otherwise fall back to analysisResults
  const manualFiles =
    allUnmappedFiles.length > 0
      ? allUnmappedFiles
      : analysisResults?.details?.files_requiring_user_input || [];
  const currentFile = manualFiles[fuzzyMatchingState.currentFileIndex];

  // Get the current file name with proper type checking
  const currentFileName = (() => {
    if (isFileMapping && typeof currentFile === "object" && "file_name" in currentFile) {
      return currentFile.file_name;
    }
    return "";
  })();

  // Get the current file path for file mappings
  const currentFilePath = (() => {
    if (isFileMapping && typeof currentFile === "object" && "file_path" in currentFile) {
      return currentFile.file_path;
    }
    return "";
  })();

  const getNonRejectedAutoMatches = () => {
    if (!autoMatchResults?.details?.auto_matched_files) return [];

    return autoMatchResults.details.auto_matched_files.filter(
      (match: any) => !rejectedAutoMatches.includes(match.file_path)
    );
  };

  const getPagedItems = <T,>(items: T[], page: number, perPage: number): T[] => {
    const startIndex = (page - 1) * perPage;
    return items.slice(startIndex, startIndex + perPage);
  };

  const handleClearMappingsTable = async () => {
    try {
      // Set loading state to true
      onIsLoadingChange({ ...isLoading, "clear-file-mappings-table": true });

      const response = await fetch(`${settings.serverUrl}/api/tracks/cleanup-mappings`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (result) {
        Spicetify.showNotification(
          `Successfully cleared file mappings. Deleted: ${result.deleted_count} mappings`
        );
      }
    } catch (error) {
      console.error("Error clearing file mappings:", error);
      Spicetify.showNotification(`Failed to clear file mappings: ${error}`, true);
    } finally {
      // Set loading state back to false
      onIsLoadingChange({ ...isLoading, "clear-file-mappings-table": false });
      // Close the confirmation dialog
      setShowClearConfirmation(false);
    }
  };

  const handleAutoMatchAnalysis = async () => {
    try {
      const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");

      const requestData = {
        masterTracksDir: cleanMasterTracksDir,
        confidence_threshold: fileMappingConfidenceThreshold,
        confirmed: false, // Analysis only
      };

      const response = await fetch(`${settings.serverUrl}/api/tracks/mapping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result: AnalysisResultsFileMapping = await response.json();

      // Sort auto-matched files by confidence (highest first)
      if (result.details?.auto_matched_files) {
        result.details.auto_matched_files.sort(
          (a: any, b: any) => (b.confidence || 0) - (a.confidence || 0)
        );
      }

      onAutoMatchResultsChange(result);

      // Show notification about analysis completion
      Spicetify.showNotification(
        `Auto-match analysis complete: ${
          result.details.auto_matched_files?.length || 0
        } files can be auto-matched`
      );
    } catch (error) {
      console.error("Error in auto-match analysis:", error);
      Spicetify.showNotification(`Auto-match analysis failed: ${error}`, true);
    }
  };

  const handleApplyAutoMatches = async () => {
    if (!autoMatchResults?.details?.auto_matched_files) return;

    const nonRejectedMatches = getNonRejectedAutoMatches();

    if (nonRejectedMatches.length === 0) {
      Spicetify.showNotification("No auto-matches to apply (all were rejected)", true);
      return;
    }

    const autoMatchSelections = nonRejectedMatches.map((match: any) => ({
      file_path: match.file_path,
      uri: match.uri,
      confidence: match.confidence,
      file_name: match.fileName || match.file_name,
    }));

    // Show confirmation panel
    onMappingResultsChange({
      success: true,
      stage: "confirmation",
      message: `Ready to apply ${autoMatchSelections.length} auto-matched files`,
      successful_mappings: 0,
      failed_mappings: 0,
      results: autoMatchSelections.map((sel) => ({
        filename: sel.file_name,
        uri: sel.uri,
        success: true,
        confidence: sel.confidence,
        source: "auto_match",
        track_info: nonRejectedMatches.find((m) => m.file_path === sel.file_path)?.track_info,
      })),
      total_processed: autoMatchSelections.length,
      pendingSelections: autoMatchSelections,
    });
    onShowMappingResultsChange(true);
  };

  const handleApplyPartialChanges = async () => {
    if (userMatchSelections.length === 0) return;

    // Create proper result objects with actual track info
    const resultsWithTrackInfo = userMatchSelections.map((sel) => {
      // Try to find track info from the matches we've seen
      const matchInfo = localMatches.find(
        (match) => match.uri === sel.uri || `spotify:track:${match.track_id}` === sel.uri
      );

      let trackInfo = "Manual selection";
      if (matchInfo) {
        trackInfo = `${matchInfo.artist} - ${matchInfo.title}`;
        if (matchInfo.album) {
          trackInfo += ` (${matchInfo.album})`;
        }
      }

      return {
        filename: sel.file_name,
        uri: sel.uri,
        success: true,
        confidence: sel.confidence,
        source: "user_selected",
        track_info: trackInfo,
      };
    });

    onMappingResultsChange({
      success: true,
      stage: "confirmation",
      message: `Ready to apply ${userMatchSelections.length} manually selected files`,
      successful_mappings: 0,
      failed_mappings: 0,
      results: resultsWithTrackInfo,
      total_processed: userMatchSelections.length,
      pendingSelections: userMatchSelections,
    });
    onShowMappingResultsChange(true);
  };

  const handleRejectAutoMatch = (fileToReject: any) => {
    const filePath = fileToReject.file_path;

    // Add to rejected list (prevent duplicates)
    onRejectedAutoMatchesChange([...rejectedAutoMatches, filePath]);

    // Add to manual matching files if not already there
    const fileForManual = {
      file_path: fileToReject.file_path,
      file_name: fileToReject.fileName || fileToReject.file_name,
    };

    const exists = allUnmappedFiles.some((f) => f.file_path === fileForManual.file_path);
    if (!exists) {
      onAllUnmappedFilesChange([...allUnmappedFiles, fileForManual]);
    }

    Spicetify.showNotification(`Moved "${fileForManual.file_name}" to manual matching`);
  };

  const handleClearRejections = () => {
    onRejectedAutoMatchesChange([]);
    // Remove the rejected files from manual matching list
    const filteredFiles = allUnmappedFiles.filter(
      (file) =>
        !autoMatchResults?.details?.auto_matched_files?.some(
          (autoMatch: any) => autoMatch.file_path === file.file_path
        )
    );
    onAllUnmappedFilesChange(filteredFiles);
    Spicetify.showNotification("Cleared all rejections - files moved back to auto-match");
  };

  const isCurrentFileAlreadyMapped = () => {
    if (!currentFilePath || !isFileMapping) return false;

    return userMatchSelections.some((selection) => {
      // Handle both possible formats of selections
      if ("file_path" in selection) {
        return selection.file_path === currentFilePath;
      }
      return false;
    });
  };

  // Runs once per file - fetches matches
  useEffect(() => {
    const fetchMatches = async () => {
      if (!currentFileName || hasCalledAPI) return;

      console.log(`Fetching matches for ${currentFileName}`);
      setIsLocalLoading(true);
      setHasCalledAPI(true);

      try {
        const sanitizedUrl = settings.serverUrl.replace(/^["'](.*)["']$/, "$1").trim();
        const response = await fetch(`${sanitizedUrl}/api/tracks/match`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: currentFileName,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data && data.success && data.matches) {
            setLocalMatches(data.matches);
          } else {
            setLocalMatches([]);
          }
        } else {
          setLocalMatches([]);
        }
      } catch (error) {
        console.error("Error in fetch:", error);
        setLocalMatches([]);
      } finally {
        setIsLocalLoading(false);
      }
    };

    fetchMatches();
  }, [currentFileName, fuzzyMatchingState.currentFileIndex]);

  // Reset the hasCalledAPI flag when moving to a new file
  useEffect(() => {
    setHasCalledAPI(false);
    setLocalMatches([]);
  }, [fuzzyMatchingState.currentFileIndex]);

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      onSearchResultsChange([]);
      onShowSearchResultsChange(false);
      return;
    }

    onIsSearchingChange(true);
    try {
      const response = await fetch(
        `${settings.serverUrl}/api/tracks/search?query=${encodeURIComponent(
          query
        )}&type=matching&limit=20`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        onSearchResultsChange(data.results || []);
        onShowSearchResultsChange(true);
      } else {
        console.error("Search failed:", response.statusText);
        onSearchResultsChange([]);
      }
    } catch (error) {
      console.error("Search error:", error);
      onSearchResultsChange([]);
    } finally {
      onIsSearchingChange(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(searchQuery);
  };

  const handleSelectMatch = (match: any) => {
    if (isFileMapping) {
      // For file mappings - use the new format
      // Use 'ratio' for manual matches, 'confidence' for search results
      const confidence = match.ratio || match.confidence || 0;
      onUserMatchSelectionsChange([
        ...userMatchSelections,
        {
          file_path: currentFilePath,
          uri: match.uri || `spotify:track:${match.track_id}`, // Convert track_id to URI if needed
          confidence: confidence,
          file_name: currentFileName,
        },
      ]);
    }
    // Move to next file
    if (fuzzyMatchingState.currentFileIndex < manualFiles.length - 1) {
      onFuzzyMatchingStateChange({
        ...fuzzyMatchingState,
        currentFileIndex: fuzzyMatchingState.currentFileIndex + 1,
        matches: [],
      });
    } else {
      // All files processed
      onFuzzyMatchingStateChange({
        ...fuzzyMatchingState,
        isActive: false,
      });
    }
  };

  const handleSkip = () => {
    // Add file to skipped files - always use the filename string
    onSkippedFilesChange([...skippedFiles, currentFileName]);

    // Move to next file
    if (fuzzyMatchingState.currentFileIndex < manualFiles.length - 1) {
      onFuzzyMatchingStateChange({
        ...fuzzyMatchingState,
        currentFileIndex: fuzzyMatchingState.currentFileIndex + 1,
        matches: [],
      });
    } else {
      // All files processed
      onFuzzyMatchingStateChange({
        ...fuzzyMatchingState,
        isActive: false,
      });
    }
  };

  const handleClearMappingsClick = () => {
    setShowClearConfirmation(true);
  };

  const ClearMappingsConfirmationDialog = () => {
    if (!showClearConfirmation) return null;

    return (
      <Portal>
        <div className={styles.modalOverlay}>
          <div className={styles.confirmationDialog}>
            <div className={styles.confirmationHeader}>
              <h3>Clear File Mappings</h3>
              <p>Are you sure you want to clear all file mappings from the database?</p>
            </div>

            <div className={styles.confirmationContent}>
              <div className={styles.warningMessage}>
                <span className={styles.warningIcon}>⚠️</span>
                <div>
                  <strong>This action cannot be undone.</strong>
                  <br />
                  All existing file-to-track mappings will be permanently deleted.
                </div>
              </div>
            </div>

            <div className={styles.confirmationFooter}>
              <button
                className={styles.confirmButton}
                onClick={handleClearMappingsTable}
                disabled={isLoading["clear-file-mappings-table"]}
              >
                {isLoading["clear-file-mappings-table"] ? "Clearing..." : "Yes, Clear Mappings"}
              </button>
              <button
                className={styles.cancelButton}
                onClick={() => setShowClearConfirmation(false)}
                disabled={isLoading["clear-file-mappings-table"]}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Portal>
    );
  };

  const processedFilesCount = userMatchSelections.length + skippedFiles.length;

  return (
    <div className={styles.fuzzyMatchContainer}>
      <h3>Map Files to Tracks</h3>

      {/* Clear FileTrackMappings table */}
      <button
        className={styles.confirmButton}
        onClick={handleClearMappingsClick}
        disabled={isLoading["clear-file-mappings-table"]}
      >
        {isLoading["clear-file-mappings-table"] ? "Clearing mappings..." : "Clear File Mappings"}
      </button>

      <ClearMappingsConfirmationDialog />

      {/* Show loading state while fetching files */}
      {isLoading["fetch-unmapped-files"] && (
        <div className={styles.loadingFiles}>
          <p>Scanning for unmapped files...</p>
        </div>
      )}

      {/* Auto-matching section */}
      <div className={styles.autoMatchingSection}>
        <div className={styles.autoMatchingHeader}>
          <h4>Auto-Matching</h4>
          <p>Automatically match files with high confidence based on filename similarity:</p>

          {/* Confidence threshold control */}
          <div className={styles.settingGroup}>
            <label className={styles.settingLabel}>Auto-Match Confidence Threshold</label>
            <div className={styles.sliderGroup}>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={fileMappingConfidenceThreshold}
                onChange={(e) => onFileMappingConfidenceThresholdChange(Number(e.target.value))}
                className={styles.confidenceSlider}
              />
              <span className={styles.sliderValue}>
                {(fileMappingConfidenceThreshold * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {/* Auto-match analysis button */}
          <button
            className={styles.autoMatchButton}
            onClick={handleAutoMatchAnalysis}
            disabled={
              isLoading["auto-match-analysis"] ||
              !settings.masterTracksDir ||
              allUnmappedFiles.length === 0
            }
          >
            {isLoading["auto-match-analysis"] ? "Analyzing..." : "Run Auto-Match Analysis"}
          </button>
        </div>

        {/* Auto-match results with full pagination and reject functionality */}
        {autoMatchResults &&
          autoMatchResults.details &&
          autoMatchResults.details.auto_matched_files &&
          autoMatchResults.details.auto_matched_files.length > 0 && (
            <div className={styles.autoMatchResults}>
              <h5>
                Auto-Matched Files ({getNonRejectedAutoMatches().length} of{" "}
                {autoMatchResults.details.files_without_mappings})
                {rejectedAutoMatches.length > 0 && (
                  <span> - {rejectedAutoMatches.length} rejected</span>
                )}
              </h5>
              <p>
                These files were automatically matched with{" "}
                {(analysisConfidenceThreshold * 100).toFixed(0)}%+ confidence:
              </p>

              {/* Show warning if all files are rejected */}
              {getNonRejectedAutoMatches().length === 0 && rejectedAutoMatches.length > 0 && (
                <div className={styles.allRejectedWarning}>
                  <p>⚠️ All auto-matched files have been rejected for manual matching.</p>
                  <button className="btn" onClick={handleClearRejections}>
                    Clear All Rejections
                  </button>
                </div>
              )}

              {/* Only show the list if there are non-rejected matches */}
              {getNonRejectedAutoMatches().length > 0 && (
                <>
                  <div className={styles.autoMatchedList}>
                    {/* Show paginated results with individual confidence */}
                    {getPagedItems(
                      getNonRejectedAutoMatches(),
                      autoMatchedPage,
                      autoMatchedPerPage
                    ).map((match: any, index: number) => (
                      <div key={index} className={styles.autoMatchedItem}>
                        <div className={styles.autoMatchContent}>
                          <span className={styles.fileName}>{match.file_name}</span>
                          <span className={styles.trackInfo}>{match.track_info}</span>
                          <span className={styles.confidence}>
                            {((match.confidence || 0) * 100).toFixed(1)}% confidence
                          </span>
                        </div>
                        <button
                          className={styles.rejectAutoMatchButton}
                          onClick={() => handleRejectAutoMatch(match)}
                          title="Reject this auto-match and move to manual matching"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Pagination controls for auto-matched files */}
                  {getNonRejectedAutoMatches().length > autoMatchedPerPage && (
                    <div className={styles.paginationControls}>
                      <button
                        disabled={autoMatchedPage === 1}
                        onClick={() => onAutoMatchedPageChange(Math.max(1, autoMatchedPage - 1))}
                      >
                        Previous
                      </button>
                      <span>
                        Page {autoMatchedPage} of{" "}
                        {Math.ceil(getNonRejectedAutoMatches().length / autoMatchedPerPage)}
                      </span>
                      <button
                        disabled={
                          autoMatchedPage >=
                          Math.ceil(getNonRejectedAutoMatches().length / autoMatchedPerPage)
                        }
                        onClick={() => onAutoMatchedPageChange(autoMatchedPage + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}

                  {/* Apply auto-matches button */}
                  <button
                    className={styles.applyAutoMatchesButton}
                    onClick={handleApplyAutoMatches}
                  >
                    Review Auto-Matches ({getNonRejectedAutoMatches().length} files)
                  </button>
                </>
              )}
            </div>
          )}

        {/* Show analysis results summary */}
        {autoMatchResults && (
          <div className={styles.analysisStats}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Total files:</span>
              <span className={styles.statValue}>{autoMatchResults.details.total_files}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Auto-matched:</span>
              <span className={styles.statValue}>{getNonRejectedAutoMatches().length}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Rejected auto-matches:</span>
              <span className={styles.statValue}>{rejectedAutoMatches.length}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>For manual matching:</span>
              <span className={styles.statValue}>{allUnmappedFiles.length}</span>
            </div>
          </div>
        )}
      </div>

      {/* Manual matching section - always visible when files are available */}
      <div className={styles.manualMatchingSection}>
        <div className={styles.manualMatchingHeader}>
          <h4>Manual Matching</h4>
          <p>For files that need your input:</p>

          {/* Show file count immediately - use dynamic count */}
          {(() => {
            const manualFiles =
              allUnmappedFiles.length > 0
                ? allUnmappedFiles
                : analysisResults?.details?.files_requiring_user_input || [];
            const remainingManualFiles = manualFiles.length;

            return remainingManualFiles > 0 ? (
              <div className={styles.fileCountInfo}>
                <p>{remainingManualFiles} files available for manual matching</p>
                {userMatchSelections.length > 0 && (
                  <p className={styles.selectedCount}>
                    {userMatchSelections.length} files selected for mapping
                  </p>
                )}
              </div>
            ) : (
              <div className={styles.fileCountInfo}>
                <p>✅ No files need manual matching</p>
              </div>
            );
          })()}

          {/* Apply partial changes button */}
          {userMatchSelections.length > 0 && (
            <button className={styles.applyPartialButton} onClick={handleApplyPartialChanges}>
              Review Changes for {userMatchSelections.length} Selected Files
            </button>
          )}
        </div>

        {/* MANUAL MATCHING INTERFACE */}
        {(() => {
          const manualFiles =
            allUnmappedFiles.length > 0
              ? allUnmappedFiles
              : analysisResults?.details?.files_requiring_user_input || [];

          return manualFiles.length > 0 ? (
            <>
              {/* Always show file info and controls */}
              {currentFileName ? (
                <>
                  <div className={styles.fileInfo}>
                    <div className={styles.fileName}>
                      <strong>Current file:</strong> {currentFileName}
                      {isCurrentFileAlreadyMapped() && (
                        <span className={styles.mappedIndicator}> ✓ Already Mapped</span>
                      )}
                    </div>
                    <div className={styles.progress}>
                      File {fuzzyMatchingState.currentFileIndex + 1} of {manualFiles.length}(
                      {processedFilesCount} complete)
                    </div>
                  </div>

                  {/* Show mapped file details if already mapped */}
                  {isCurrentFileAlreadyMapped() && (
                    <div className={styles.alreadyMappedSection}>
                      <h4>This file has already been mapped:</h4>
                      {(() => {
                        const mappedSelection = userMatchSelections.find((selection) => {
                          if ("file_path" in selection) {
                            return selection.file_path === currentFilePath;
                          }
                          return false;
                        });

                        if (mappedSelection && "uri" in mappedSelection) {
                          return (
                            <div className={styles.mappedDetails}>
                              <div>
                                <strong>URI:</strong> {mappedSelection.uri}
                              </div>
                              <div>
                                <strong>Confidence:</strong>{" "}
                                {(mappedSelection.confidence * 100).toFixed(1)}%
                              </div>
                              <button
                                className={styles.removeMappingButton}
                                onClick={() => {
                                  // Remove this mapping from userMatchSelections
                                  const updatedSelections = userMatchSelections.filter(
                                    (selection) => {
                                      if ("file_path" in selection) {
                                        return selection.file_path !== currentFilePath;
                                      }
                                      return true;
                                    }
                                  );
                                  onUserMatchSelectionsChange(updatedSelections);
                                  Spicetify.showNotification(
                                    `Removed mapping for ${currentFileName}`
                                  );
                                }}
                              >
                                Remove This Mapping
                              </button>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}

                  {/* Only show search and matching interface if not already mapped */}
                  {!isCurrentFileAlreadyMapped() && (
                    <>
                      {/* Search Section */}
                      <div className={styles.searchSection}>
                        <h4>Search for Track</h4>
                        <form onSubmit={handleSearchSubmit} className={styles.searchInputContainer}>
                          <input
                            type="text"
                            className={styles.searchInput}
                            placeholder="Search by artist, title, or album... (Press Enter to search)"
                            value={searchQuery}
                            onChange={(e) => onSearchQueryChange(e.target.value)}
                          />
                          <button
                            type="submit"
                            className={styles.actionButton}
                            disabled={isSearching}
                          >
                            {isSearching ? "🔍" : "Search"}
                          </button>
                        </form>

                        {/* Search Results */}
                        {showSearchResults && searchResults.length > 0 && (
                          <div className={styles.searchResults}>
                            <div className={styles.searchResultsHeader}>
                              <h5>Search Results ({searchResults.length})</h5>
                              <button
                                className={styles.closeSearchButton}
                                onClick={() => {
                                  onShowSearchResultsChange(false);
                                  onSearchResultsChange([]);
                                  onSearchQueryChange("");
                                }}
                                title="Close search results"
                              >
                                ✕
                              </button>
                            </div>
                            <div className={styles.searchResultsList}>
                              {searchResults.map((match, index) => (
                                <div
                                  key={match.track_id || index}
                                  className={styles.searchResultItem}
                                  onClick={() => {
                                    handleSelectMatch(match);
                                    onSearchQueryChange("");
                                    onSearchResultsChange([]);
                                    onShowSearchResultsChange(false);
                                  }}
                                >
                                  <div className={styles.searchResultContent}>
                                    <div className={styles.searchResultTitle}>
                                      {match.artist} - {match.title}
                                    </div>
                                    <div className={styles.searchResultAlbum}>{match.album}</div>
                                    <div className={styles.searchResultConfidence}>
                                      Match:{" "}
                                      {((match.confidence || match.ratio || 0) * 100).toFixed(1)}%
                                      {match.is_local && (
                                        <span className={styles.localIndicator}> (LOCAL)</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {showSearchResults &&
                          searchResults.length === 0 &&
                          searchQuery.trim() &&
                          !isSearching && (
                            <div className={styles.noSearchResults}>
                              <div className={styles.noSearchResultsContent}>
                                <span>No tracks found for "{searchQuery}"</span>
                                <button
                                  className={styles.closeSearchButton}
                                  onClick={() => {
                                    onShowSearchResultsChange(false);
                                    onSearchQueryChange("");
                                  }}
                                  title="Close search results"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          )}
                      </div>

                      {/* Existing fuzzy match results */}
                      {isLocalLoading ? (
                        <div className={styles.loadingMatches}>
                          <div>Loading potential matches...</div>
                          <button
                            className={styles.skipButton}
                            onClick={() => {
                              setIsLocalLoading(false);
                              handleSkip();
                            }}
                          >
                            Skip this file
                          </button>
                        </div>
                      ) : (
                        <div className={styles.matchesList}>
                          <h4>Suggested Matches</h4>
                          <div className={styles.matchOption} onClick={handleSkip}>
                            <div className={styles.matchNumber}>0.</div>
                            <div className={styles.matchText}>Skip this file (no match)</div>
                          </div>

                          {localMatches.map((match, index) => (
                            <div
                              key={match.track_id || index}
                              className={styles.matchOption}
                              onClick={() => handleSelectMatch(match)}
                            >
                              <div className={styles.matchNumber}>{index + 1}.</div>
                              <div className={styles.matchContent}>
                                <div className={styles.matchTitle}>
                                  {match.artist} - {match.title}
                                </div>
                                <div className={styles.matchAlbum}>{match.album}</div>
                                <div className={styles.confidence}>
                                  {((match.ratio || match.confidence || 0) * 100).toFixed(1)}%
                                  confidence
                                </div>
                              </div>
                            </div>
                          ))}

                          {localMatches.length === 0 && !isLocalLoading && hasCalledAPI && (
                            <div className={styles.noMatches}>
                              <p>No potential matches found.</p>
                              <button
                                className={styles.retryButton}
                                onClick={() => {
                                  setHasCalledAPI(false);
                                }}
                              >
                                Retry
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Navigation controls */}
                  <div className={styles.manualMatchingControls}>
                    <button
                      className={styles.prevFileButton}
                      onClick={() => {
                        if (fuzzyMatchingState.currentFileIndex > 0) {
                          onFuzzyMatchingStateChange({
                            ...fuzzyMatchingState,
                            currentFileIndex: fuzzyMatchingState.currentFileIndex - 1,
                            matches: [],
                          });
                        }
                      }}
                      disabled={fuzzyMatchingState.currentFileIndex === 0}
                    >
                      ← Previous File
                    </button>

                    <button
                      className={styles.nextFileButton}
                      onClick={() => {
                        if (fuzzyMatchingState.currentFileIndex < manualFiles.length - 1) {
                          onFuzzyMatchingStateChange({
                            ...fuzzyMatchingState,
                            currentFileIndex: fuzzyMatchingState.currentFileIndex + 1,
                            matches: [],
                          });
                        } else {
                          // All files processed
                          onFuzzyMatchingStateChange({
                            ...fuzzyMatchingState,
                            isActive: false,
                          });
                        }
                      }}
                      disabled={fuzzyMatchingState.currentFileIndex >= manualFiles.length - 1}
                    >
                      Next File →
                    </button>
                  </div>
                </>
              ) : (
                /* Show start button when no current file is selected */
                <div className={styles.manualMatchingStart}>
                  <button
                    className={styles.startManualMatchingButton}
                    onClick={() => {
                      onFuzzyMatchingStateChange({
                        isActive: true,
                        currentFileIndex: 0,
                        matches: [],
                        isLoading: false,
                      });
                    }}
                  >
                    Start Manual Matching ({manualFiles.length} files)
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className={styles.allDoneMessage}>
              <p>🎉 All files have been processed or mapped!</p>
            </div>
          );
        })()}
      </div>

      {/* Close panel button */}
      <div className={styles.panelFooter}>
        <button className={styles.closePanelButton} onClick={onClosePanel}>
          Close
        </button>
      </div>
    </div>
  );
};

export default FileMappingWizard;
