import React, { useState, useEffect } from "react";
import styles from "./PythonActionsPanel.module.css";
import "../styles/globals.css";
import Portal from "../utils/Portal";
import DuplicateResolutionPanel from "./DuplicateResolutionPanel";

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

interface AutoMatchedFile {
  file_path: string;
  file_name: string;
  uri: string;
  confidence: number;
  match_type: string;
  track_info: string;
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
    auto_matched_files: AutoMatchedFile[];
    total_files: number;
    files_without_mappings: number;
  };
  duplicate_detection?: DuplicateDetectionResult;
}

interface DuplicateDetectionResult {
  performed: boolean;
  conflicts_found: number;
  clean_mappings: number;
  needs_resolution: boolean;
  duplicate_groups?: any[];
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
  const [showDuplicateResolution, setShowDuplicateResolution] = useState(false);
  const [duplicateDetectionResult, setDuplicateDetectionResult] = useState<any>(null);
  const [isResolvingDuplicates, setIsResolvingDuplicates] = useState(false);
  const [currentTab, setCurrentTab] = useState<"analysis" | "review" | "manual">("analysis");

  const autoMatchedPerPage = 40;
  const isFileMapping = currentAction?.name === "create-file-mappings";

  // Get consolidated auto-matched files
  const getAutoMatchedFiles = (): AutoMatchedFile[] => {
    return analysisResults?.details?.auto_matched_files || [];
  };

  // Get manual files
  const getManualFiles = () => {
    // TODO: keep this?
    // return allUnmappedFiles.length > 0
    //   ? allUnmappedFiles
    //   : analysisResults?.details?.files_requiring_user_input || [];
    return analysisResults?.details?.files_requiring_user_input || [];
  };

  // Get current file for manual matching
  const manualFiles = getManualFiles();
  const currentFile = manualFiles[fuzzyMatchingState.currentFileIndex];

  const currentFileName = (() => {
    if (isFileMapping && typeof currentFile === "object" && "file_name" in currentFile) {
      return currentFile.file_name;
    }
    return "";
  })();

  const currentFilePath = (() => {
    if (isFileMapping && typeof currentFile === "object" && "file_path" in currentFile) {
      return currentFile.file_path;
    }
    return "";
  })();

  const getNonRejectedAutoMatches = (): AutoMatchedFile[] => {
    const autoMatches = getAutoMatchedFiles();
    return autoMatches.filter(
      (match: AutoMatchedFile) => !rejectedAutoMatches.includes(match.file_path)
    );
  };

  const getPagedItems = <T,>(items: T[], page: number, perPage: number): T[] => {
    const startIndex = (page - 1) * perPage;
    return items.slice(startIndex, startIndex + perPage);
  };

  // Enhanced analysis function
  const runEnhancedAnalysis = async () => {
    if (!settings.masterTracksDir) {
      Spicetify.showNotification("Master tracks directory not configured", true);
      return;
    }

    onIsLoadingChange({ ...isLoading, "create-file-mappings": true });

    try {
      const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");

      const response = await fetch(`${settings.serverUrl}/api/tracks/mapping/analyze-enhanced`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterTracksDir: cleanMasterTracksDir,
          confidenceThreshold: fileMappingConfidenceThreshold,
        }),
      });

      const result = await response.json();

      if (result.success) {
        const enhancedResults: AnalysisResultsFileMapping = {
          stage: result.stage,
          success: result.success,
          message: result.message,
          needs_confirmation: result.needs_confirmation || result.requires_user_selection,
          requires_user_selection: result.requires_user_selection,
          details: {
            files_requiring_user_input: result.files_requiring_user_input || [],
            auto_matched_files: result.auto_matched_files || [],
            total_files: result.total_files || 0,
            files_without_mappings: result.files_without_mappings || 0,
          },
          duplicate_detection: result.duplicate_detection,
        };

        onAnalysisResultsChange(enhancedResults);
        onAllUnmappedFilesChange(result.files_requiring_user_input || []);

        // Check if duplicate resolution is needed
        if (result.duplicate_detection?.needs_resolution) {
          setDuplicateDetectionResult(result.duplicate_detection);
          setShowDuplicateResolution(true);
        } else {
          // Switch to review tab if we have results
          if (
            enhancedResults.details.auto_matched_files.length > 0 ||
            enhancedResults.details.files_requiring_user_input.length > 0
          ) {
            setCurrentTab("review");
          }
        }

        Spicetify.showNotification(
          `Analysis complete! ${result.auto_matched_files?.length || 0} auto-matched, ${
            result.files_requiring_user_input?.length || 0
          } need manual review.`,
          false
        );
      } else {
        throw new Error(result.message || "Analysis failed");
      }
    } catch (error) {
      console.error("Enhanced analysis error:", error);
      Spicetify.showNotification(`Analysis failed: ${error}`, true);
    } finally {
      onIsLoadingChange({ ...isLoading, "create-file-mappings": false });
    }
  };

  // Handle search functionality
  const handleSearch = async (query: string) => {
    if (!query.trim()) return;

    onIsSearchingChange(true);
    try {
      const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");

      const response = await fetch(
        `${settings.serverUrl}/api/tracks/search?query=${encodeURIComponent(
          query
        )}&masterTracksDir=${encodeURIComponent(cleanMasterTracksDir)}&type=matching`,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
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
      const confidence = match.ratio || match.confidence || 0;
      onUserMatchSelectionsChange([
        ...userMatchSelections,
        {
          file_path: currentFilePath,
          uri: match.uri || `spotify:track:${match.track_id}`,
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
      setHasCalledAPI(false); // Reset for next file
    } else {
      onFuzzyMatchingStateChange({
        ...fuzzyMatchingState,
        isActive: false,
      });
    }

    onShowSearchResultsChange(false);
    onSearchQueryChange("");
  };

  // Fetch matches for current file
  useEffect(() => {
    const fetchMatches = async () => {
      if (!currentFileName || hasCalledAPI || !isFileMapping) return;

      setIsLocalLoading(true);
      setHasCalledAPI(true);

      try {
        const sanitizedUrl = settings.serverUrl.replace(/^["'](.*)["']$/, "$1");
        const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");

        const response = await fetch(`${sanitizedUrl}/api/tracks/match`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            filename: currentFileName,
            master_tracks_dir: cleanMasterTracksDir,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          setLocalMatches(data.matches || []);
          onFuzzyMatchingStateChange({
            ...fuzzyMatchingState,
            matches: data.matches || [],
            isLoading: false,
          });
        } else {
          console.error("Fuzzy match failed:", response.statusText);
          setLocalMatches([]);
          onFuzzyMatchingStateChange({
            ...fuzzyMatchingState,
            matches: [],
            isLoading: false,
          });
        }
      } catch (error) {
        console.error("Error fetching fuzzy matches:", error);
        setLocalMatches([]);
        onFuzzyMatchingStateChange({
          ...fuzzyMatchingState,
          matches: [],
          isLoading: false,
        });
      } finally {
        setIsLocalLoading(false);
      }
    };

    fetchMatches();
  }, [fuzzyMatchingState.currentFileIndex, currentFileName, isFileMapping]);

  // Reset hasCalledAPI when file changes
  useEffect(() => {
    setHasCalledAPI(false);
  }, [fuzzyMatchingState.currentFileIndex]);

  const handleRejectAutoMatch = (fileToReject: any) => {
    const filePath = fileToReject.file_path;
    onRejectedAutoMatchesChange([...rejectedAutoMatches, filePath]);

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
    const filteredFiles = allUnmappedFiles.filter(
      (file) =>
        !getAutoMatchedFiles()?.some(
          (autoMatch: AutoMatchedFile) => autoMatch.file_path === file.file_path
        )
    );
    onAllUnmappedFilesChange(filteredFiles);
    Spicetify.showNotification("Cleared all rejections - files moved back to auto-match");
  };

  const handleReviewChanges = () => {
    const autoMatches = getNonRejectedAutoMatches();
    const manualMatches = userMatchSelections;

    const totalSelections = [
      ...autoMatches.map((match: AutoMatchedFile) => ({
        file_path: match.file_path,
        uri: match.uri,
        confidence: match.confidence,
        file_name: match.file_name,
      })),
      ...manualMatches,
    ];

    if (totalSelections.length === 0) {
      Spicetify.showNotification("No files selected for mapping", true);
      return;
    }

    // Show review panel
    onMappingResultsChange({
      success: true,
      stage: "confirmation",
      message: `Ready to map ${totalSelections.length} files`,
      successful_mappings: 0,
      failed_mappings: 0,
      results: totalSelections.map((sel) => ({
        filename: sel.file_name,
        uri: sel.uri,
        success: true,
        confidence: sel.confidence,
        source: autoMatches.find((m: AutoMatchedFile) => m.file_path === sel.file_path)
          ? "auto_match"
          : "user_selected",
        track_info:
          autoMatches.find((m: AutoMatchedFile) => m.file_path === sel.file_path)?.track_info || "",
      })),
      total_processed: totalSelections.length,
      pendingSelections: totalSelections,
    });
    onShowMappingResultsChange(true);
  };

  const isCurrentFileAlreadyMapped = () => {
    if (!currentFilePath || !isFileMapping) return false;
    return userMatchSelections.some((selection) => {
      if ("file_path" in selection) {
        return selection.file_path === currentFilePath;
      }
      return false;
    });
  };

  const createMappingsWithResolution = async (duplicateResolutions?: Record<string, string>) => {
    if (!settings.masterTracksDir) {
      Spicetify.showNotification("Master tracks directory not configured", true);
      return;
    }

    setIsResolvingDuplicates(true);

    try {
      const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");

      const requestBody = {
        masterTracksDir: cleanMasterTracksDir,
        userSelections: userMatchSelections,
        precomputedChanges: {
          auto_matched_files: analysisResults?.details?.auto_matched_files || [],
        },
        duplicateResolutions: duplicateResolutions || {},
      };

      const response = await fetch(
        `${settings.serverUrl}/api/tracks/mapping/create-with-resolution`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );

      const result = await response.json();

      if (result.success) {
        if (result.stage === "duplicate_resolution_required") {
          // More duplicates found - show resolution panel
          setDuplicateDetectionResult(result.duplicate_detection);
          setShowDuplicateResolution(true);

          Spicetify.showNotification(
            `Found ${result.duplicate_detection.duplicate_groups} additional conflicts requiring resolution.`,
            false
          );
        } else {
          // Success - show results
          onMappingResultsChange(result);
          onShowMappingResultsChange(true);
          setShowDuplicateResolution(false);

          Spicetify.showNotification(
            `Successfully created ${result.successful_mappings} file mappings!`,
            false
          );
        }
      } else {
        throw new Error(result.message || "Mapping creation failed");
      }
    } catch (error) {
      console.error("Enhanced mapping creation error:", error);
      Spicetify.showNotification(`Mapping creation failed: ${error}`, true);
    } finally {
      setIsResolvingDuplicates(false);
    }
  };

  const handleDuplicateResolution = async (duplicateResolutions: Record<string, string>) => {
    if (!duplicateDetectionResult) return;

    try {
      setIsResolvingDuplicates(true);

      // Apply the mappings with duplicate resolution
      await createMappingsWithResolution(duplicateResolutions);

      // Close duplicate resolution panel
      setShowDuplicateResolution(false);
      setDuplicateDetectionResult(null);

      Spicetify.showNotification("Duplicate conflicts resolved successfully!");
    } catch (error) {
      console.error("Error resolving duplicates:", error);
      Spicetify.showNotification(`Error resolving duplicates: ${error}`, true);
    } finally {
      setIsResolvingDuplicates(false);
    }
  };

  const handleDuplicateResolutionCancel = () => {
    setShowDuplicateResolution(false);
    setDuplicateDetectionResult(null);
    setIsResolvingDuplicates(false);

    Spicetify.showNotification("Duplicate resolution cancelled");
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

  const processedFilesCount = userMatchSelections.length + skippedFiles.length;

  const renderAnalysisTab = () => (
    <div className={styles.analysisTab}>
      {/* Confidence Threshold Controls */}
      <div className={styles.thresholdControls}>
        <div className={styles.thresholdControl}>
          <label>
            Analysis Confidence Threshold: {(fileMappingConfidenceThreshold * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0.5"
            max="0.95"
            step="0.05"
            value={fileMappingConfidenceThreshold}
            onChange={(e) => onFileMappingConfidenceThresholdChange(Number(e.target.value))}
            className={styles.thresholdSlider}
          />
        </div>
      </div>

      {/* Analysis Button */}
      <div className={styles.analysisSection}>
        <button
          className={styles.enhancedAnalysisButton}
          onClick={runEnhancedAnalysis}
          disabled={isLoading["create-file-mappings"] || isLoading["fetch-unmapped-files"]}
        >
          {isLoading["create-file-mappings"] || isLoading["fetch-unmapped-files"]
            ? "🔍 Analyzing..."
            : "🔍 Run Analysis"}
        </button>

        {analysisResults && (
          <div className={styles.analysisResults}>
            <p className={styles.analysisMessage}>{analysisResults.message}</p>
          </div>
        )}
      </div>

      {/* Clear Mappings */}
      <div className={styles.clearMappingsSection}>
        <button
          className={styles.clearMappingsButton}
          onClick={() => setShowClearConfirmation(true)}
          disabled={isLoading["clear-file-mappings-table"]}
        >
          {isLoading["clear-file-mappings-table"] ? "Clearing..." : "🗑️ Clear All Mappings"}
        </button>
      </div>
    </div>
  );

  const renderReviewTab = () => (
    <div className={styles.reviewTab}>
      {/* Summary */}
      {analysisResults && (
        <div className={styles.progressSummary}>
          <span className={styles.progressItem}>
            Total Files: <strong>{analysisResults.details.total_files}</strong>
          </span>
          <span className={styles.progressItem}>
            Auto-matched: <strong>{getAutoMatchedFiles().length}</strong>
          </span>
          <span className={styles.progressItem}>
            Manual: <strong>{getManualFiles().length}</strong>
          </span>
        </div>
      )}

      {/* Auto-matched Files */}
      {getAutoMatchedFiles().length > 0 && (
        <div className={styles.autoMatchedSection}>
          <h4>
            ✅ Auto-matched Files ({getAutoMatchedFiles().length})
            {rejectedAutoMatches.length > 0 && (
              <span className={styles.rejectedCount}> ({rejectedAutoMatches.length} rejected)</span>
            )}
          </h4>

          <div className={styles.autoMatchedList}>
            {getPagedItems(getNonRejectedAutoMatches(), autoMatchedPage, autoMatchedPerPage).map(
              (match: AutoMatchedFile) => {
                const isRejected = rejectedAutoMatches.includes(match.file_path);
                return (
                  <div
                    key={match.file_path}
                    className={`${styles.autoMatchedItem} ${isRejected ? styles.rejected : ""}`}
                  >
                    <div className={styles.matchInfo}>
                      <div className={styles.fileName}>{match.file_name}</div>
                      <div className={styles.trackInfo}>
                        → {match.track_info} ({(match.confidence * 100).toFixed(1)}%)
                      </div>
                    </div>
                    <button
                      className={styles.rejectButton}
                      onClick={() => handleRejectAutoMatch(match)}
                      title={isRejected ? "Accept this match" : "Reject this match"}
                    >
                      {isRejected ? "✓" : "✗"}
                    </button>
                  </div>
                );
              }
            )}
          </div>

          {/* Pagination */}
          {getAutoMatchedFiles().length > autoMatchedPerPage && (
            <div className={styles.pagination}>
              <button
                onClick={() => onAutoMatchedPageChange(Math.max(1, autoMatchedPage - 1))}
                disabled={autoMatchedPage === 1}
              >
                Previous
              </button>
              <span>
                Page {autoMatchedPage} of{" "}
                {Math.ceil(getAutoMatchedFiles().length / autoMatchedPerPage)}
              </span>
              <button
                onClick={() => onAutoMatchedPageChange(autoMatchedPage + 1)}
                disabled={
                  autoMatchedPage >= Math.ceil(getAutoMatchedFiles().length / autoMatchedPerPage)
                }
              >
                Next
              </button>
            </div>
          )}

          {/* Actions */}
          <div className={styles.autoMatchActions}>
            {rejectedAutoMatches.length > 0 && (
              <button className={styles.clearRejectionsButton} onClick={handleClearRejections}>
                Clear {rejectedAutoMatches.length} Rejections
              </button>
            )}
          </div>
        </div>
      )}

      {/* Manual Matches Summary */}
      {userMatchSelections.length > 0 && (
        <div className={styles.manualMatchesSection}>
          <h4>📝 Manual Selections ({userMatchSelections.length})</h4>
          <div className={styles.manualMatchesList}>
            {userMatchSelections.slice(0, 10).map((selection, index) => (
              <div key={index} className={styles.manualMatchItem}>
                <div className={styles.fileName}>{selection.file_name}</div>
                <div className={styles.trackInfo}>→ {selection.uri}</div>
              </div>
            ))}
            {userMatchSelections.length > 10 && (
              <div className={styles.moreItemsIndicator}>
                ...and {userMatchSelections.length - 10} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Review and Apply */}
      <div className={styles.reviewActions}>
        <div className={styles.reviewSummary}>
          <p>
            Ready to map:{" "}
            <strong>{getNonRejectedAutoMatches().length + userMatchSelections.length}</strong> files
          </p>
        </div>

        <div className={styles.actionButtons}>
          <button
            className={styles.reviewButton}
            onClick={handleReviewChanges}
            disabled={getNonRejectedAutoMatches().length + userMatchSelections.length === 0}
          >
            📋 Review Changes
          </button>

          {getManualFiles().length > 0 && (
            <button
              className={styles.manualMatchButton}
              onClick={() => {
                setCurrentTab("manual");
                onFuzzyMatchingStateChange({
                  ...fuzzyMatchingState,
                  isActive: true,
                  currentFileIndex: 0,
                });
              }}
            >
              ✏️ Manual Matching ({getManualFiles().length} files)
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderManualTab = () => (
    <div className={styles.manualTab}>
      {/* File Info */}
      {currentFileName && (
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
      )}

      {/* Search Interface */}
      <div className={styles.searchSection}>
        <form onSubmit={handleSearchSubmit} className={styles.searchForm}>
          <input
            type="text"
            placeholder="Search for track..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className={styles.searchInput}
          />
          <button type="submit" disabled={isSearching} className={styles.searchButton}>
            {isSearching ? "🔍 Searching..." : "🔍 Search"}
          </button>
        </form>

        {showSearchResults && searchResults.length > 0 && (
          <div className={styles.searchResults}>
            <h5>Search Results:</h5>
            <div className={styles.searchResultsList}>
              {searchResults.map((result, index) => (
                <div key={index} className={styles.searchResultItem}>
                  <div className={styles.trackDetails}>
                    <strong>{result.title}</strong> - {result.artist}
                    {result.album && <span className={styles.album}> ({result.album})</span>}
                    <div className={styles.confidence}>
                      Confidence: {(result.confidence * 100).toFixed(1)}%
                    </div>
                  </div>
                  <button className={styles.selectButton} onClick={() => handleSelectMatch(result)}>
                    Select
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Fuzzy Matches */}
      {!showSearchResults && (isLocalLoading || localMatches.length > 0) && (
        <div className={styles.fuzzyMatchesSection}>
          <h5>Suggested Matches:</h5>
          {isLocalLoading ? (
            <div className={styles.loadingIndicator}>Loading matches...</div>
          ) : (
            <div className={styles.matchesList}>
              {localMatches.map((match, index) => (
                <div key={index} className={styles.matchItem}>
                  <div className={styles.trackDetails}>
                    <strong>{match.title}</strong> - {match.artist}
                    {match.album && <span className={styles.album}> ({match.album})</span>}
                    <div className={styles.confidence}>
                      Match: {(match.ratio * 100).toFixed(1)}%
                    </div>
                  </div>
                  <button className={styles.selectButton} onClick={() => handleSelectMatch(match)}>
                    Select
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation Controls */}
      <div className={styles.fileNavigation}>
        <button
          className={styles.skipButton}
          onClick={() => {
            const skippedFilePath = manualFiles[fuzzyMatchingState.currentFileIndex]?.file_path;
            if (skippedFilePath) {
              onSkippedFilesChange([...skippedFiles, skippedFilePath]);
            }

            if (fuzzyMatchingState.currentFileIndex < manualFiles.length - 1) {
              onFuzzyMatchingStateChange({
                ...fuzzyMatchingState,
                currentFileIndex: fuzzyMatchingState.currentFileIndex + 1,
                matches: [],
                isLoading: false,
              });
              setHasCalledAPI(false);
            } else {
              onFuzzyMatchingStateChange({
                ...fuzzyMatchingState,
                isActive: false,
              });
              setCurrentTab("review");
            }
          }}
        >
          Skip File
        </button>

        <button
          className={styles.prevButton}
          onClick={() => {
            if (fuzzyMatchingState.currentFileIndex > 0) {
              onFuzzyMatchingStateChange({
                ...fuzzyMatchingState,
                currentFileIndex: fuzzyMatchingState.currentFileIndex - 1,
                matches: [],
              });
              setHasCalledAPI(false);
            }
          }}
          disabled={fuzzyMatchingState.currentFileIndex === 0}
        >
          Previous File
        </button>

        <button
          className={styles.nextButton}
          onClick={() => {
            if (fuzzyMatchingState.currentFileIndex < manualFiles.length - 1) {
              onFuzzyMatchingStateChange({
                ...fuzzyMatchingState,
                currentFileIndex: fuzzyMatchingState.currentFileIndex + 1,
                matches: [],
              });
              setHasCalledAPI(false);
            } else {
              onFuzzyMatchingStateChange({
                ...fuzzyMatchingState,
                isActive: false,
              });
              setCurrentTab("review");
            }
          }}
          disabled={fuzzyMatchingState.currentFileIndex >= manualFiles.length - 1}
        >
          Next File
        </button>

        <button className={styles.backToReviewButton} onClick={() => setCurrentTab("review")}>
          Back to Review
        </button>
      </div>
    </div>
  );

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

  return (
    <>
      {/* Main Wizard Panel */}
      <Portal>
        <div className={styles.modalOverlay}>
          <div className={styles.fileMappingWizard}>
            <div className={styles.wizardHeader}>
              <h3>🎵 File Mapping Wizard</h3>
              <ClearMappingsConfirmationDialog />

              {/* Tab Navigation */}
              <div className={styles.tabNavigation}>
                <button
                  className={`${styles.tab} ${currentTab === "analysis" ? styles.activeTab : ""}`}
                  onClick={() => setCurrentTab("analysis")}
                >
                  📊 Analysis
                </button>
                <button
                  className={`${styles.tab} ${currentTab === "review" ? styles.activeTab : ""}`}
                  onClick={() => setCurrentTab("review")}
                  disabled={!analysisResults}
                >
                  📋 Review
                </button>
                <button
                  className={`${styles.tab} ${currentTab === "manual" ? styles.activeTab : ""}`}
                  onClick={() => setCurrentTab("manual")}
                  disabled={getManualFiles().length === 0}
                >
                  ✏️ Manual ({getManualFiles().length})
                </button>
              </div>
            </div>

            <div className={styles.wizardContent}>
              {currentTab === "analysis" && renderAnalysisTab()}
              {currentTab === "review" && renderReviewTab()}
              {currentTab === "manual" && renderManualTab()}
            </div>

            {/* Close panel button */}
            <div className={styles.panelFooter}>
              <button className={styles.closePanelButton} onClick={onClosePanel}>
                Close
              </button>
            </div>
          </div>
        </div>
      </Portal>

      {/* Duplicate Resolution Panel */}
      <DuplicateResolutionPanel
        duplicateDetection={duplicateDetectionResult}
        isVisible={showDuplicateResolution}
        onResolve={handleDuplicateResolution}
        onCancel={handleDuplicateResolutionCancel}
        isLoading={isResolvingDuplicates}
      />
    </>
  );
};

export default FileMappingWizard;
