import React, { useState, useEffect } from "react";
import styles from "./PythonActionsPanel.module.css";

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
}) => {
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

    // Apply only the non-rejected auto-matches
    await applyFileMapping(autoMatchSelections, "auto-matched files");
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

  const handleApplyPartialChanges = async () => {
    if (userMatchSelections.length === 0) return;

    // Apply the current user selections
    await applyFileMapping(userMatchSelections, "manually selected files");
  };

  const applyFileMapping = async (selections: any[], description: string) => {
    try {
      const confirmData = {
        masterTracksDir: settings.masterTracksDir,
        confirmed: true,
        user_selections: selections,
        precomputed_changes_from_analysis: autoMatchResults || analysisResults,
      };

      // Make the API call to apply the mappings
      const response = await fetch(`${settings.serverUrl}/api/tracks/mapping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(confirmData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result: FileMappingResponse = await response.json();

      if (result.success) {
        onMappingResultsChange(result);
        onShowMappingResultsChange(true);

        // Get successfully mapped file paths
        const successfullyMappedFilePaths = new Set(
          result.results
            .filter((r) => r.success)
            .map((r) => selections.find((s) => s.file_name === r.filename)?.file_path)
            .filter(Boolean)
        );

        // Handle different scenarios based on the description
        if (description.includes("auto-matched")) {
          // For auto-matched files, clear the auto-match results
          onAutoMatchResultsChange(null);

          // Remove successfully mapped files from allUnmappedFiles
          const filteredFiles = allUnmappedFiles.filter(
            (file) => !successfullyMappedFilePaths.has(file.file_path)
          );
          onAllUnmappedFilesChange(filteredFiles);

          // Update analysisResults to remove successfully mapped files
          if (analysisResults && analysisResults.details.files_requiring_user_input) {
            const updatedAnalysis = {
              ...analysisResults,
              details: {
                ...analysisResults.details,
                files_requiring_user_input:
                  analysisResults.details.files_requiring_user_input.filter(
                    (file) => !successfullyMappedFilePaths.has(file.file_path)
                  ),
                files_without_mappings: analysisResults.details.files_requiring_user_input.filter(
                  (file) => !successfullyMappedFilePaths.has(file.file_path)
                ).length,
              },
            };
            onAnalysisResultsChange(updatedAnalysis);
          }

          // Clear rejected auto-matches since they've been processed
          onRejectedAutoMatchesChange([]);
        } else if (description.includes("manually selected")) {
          // For manual selections, clear the current selections
          onUserMatchSelectionsChange([]);

          // Remove successfully mapped files from allUnmappedFiles
          const filteredFiles = allUnmappedFiles.filter(
            (file) => !successfullyMappedFilePaths.has(file.file_path)
          );
          onAllUnmappedFilesChange(filteredFiles);

          // Update the analysis results to remove the files that were just processed
          if (analysisResults && analysisResults.details.files_requiring_user_input) {
            const updatedAnalysis = {
              ...analysisResults,
              details: {
                ...analysisResults.details,
                files_requiring_user_input:
                  analysisResults.details.files_requiring_user_input.filter(
                    (file) => !successfullyMappedFilePaths.has(file.file_path)
                  ),
                files_without_mappings: analysisResults.details.files_requiring_user_input.filter(
                  (file) => !successfullyMappedFilePaths.has(file.file_path)
                ).length,
              },
            };
            onAnalysisResultsChange(updatedAnalysis);
          }

          // Reset fuzzy matching to first remaining file if there are any
          const remainingFiles = allUnmappedFiles.filter(
            (file) => !successfullyMappedFilePaths.has(file.file_path)
          );

          if (remainingFiles.length === 0) {
            // No more files to process
            onFuzzyMatchingStateChange({
              isActive: false,
              currentFileIndex: 0,
              matches: [],
              isLoading: false,
            });
          } else {
            // Reset to first remaining file
            onFuzzyMatchingStateChange({
              ...fuzzyMatchingState,
              currentFileIndex: 0,
              matches: [],
              isLoading: false,
            });
          }
        }

        const remainingCount = allUnmappedFiles.length - successfullyMappedFilePaths.size;
        Spicetify.showNotification(
          `Successfully mapped ${result.successful_mappings} files. ${remainingCount} files remaining.`
        );
      } else {
        throw new Error(result.message || "Unknown error occurred");
      }
    } catch (error) {
      console.error("Error applying file mappings:", error);
      Spicetify.showNotification(`Error applying mappings: ${error}`, true);
    }
  };

  const [localMatches, setLocalMatches] = useState<any[]>([]);
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const [hasCalledAPI, setHasCalledAPI] = useState(false);

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

  const processedFilesCount = userMatchSelections.length + skippedFiles.length;

  return (
    <div className={styles.fuzzyMatchContainer}>
      <h3>Map Files to Tracks</h3>

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
                {autoMatchResults.details.auto_matched_files.length})
                {rejectedAutoMatches.length > 0 && (
                  <span className={styles.rejectedCount}>
                    {" "}
                    - {rejectedAutoMatches.length} rejected
                  </span>
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
                  <button className={styles.clearRejectionsButton} onClick={handleClearRejections}>
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
                    Apply Auto-Matches ({getNonRejectedAutoMatches().length} files)
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
              Apply Changes for {userMatchSelections.length} Selected Files
            </button>
          )}
        </div>

        {/* Manual matching interface - show based on dynamic file count */}
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
                    </div>
                    <div className={styles.progress}>
                      File {fuzzyMatchingState.currentFileIndex + 1} of {manualFiles.length}(
                      {processedFilesCount} complete)
                    </div>
                  </div>

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
                      <button type="submit" className={styles.actionButton} disabled={isSearching}>
                        {isSearching ? "🔍" : "Search"}
                      </button>
                    </form>

                    {/* Search Results */}
                    {showSearchResults && searchResults.length > 0 && (
                      <div className={styles.searchResults}>
                        <h5>Search Results ({searchResults.length})</h5>
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
                                  Match: {((match.confidence || match.ratio || 0) * 100).toFixed(1)}
                                  %
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
                          No tracks found for "{searchQuery}"
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
