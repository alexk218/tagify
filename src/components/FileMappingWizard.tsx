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

  const [showDuplicateResolution, setShowDuplicateResolution] = useState(false);
  const [duplicateDetectionResult, setDuplicateDetectionResult] = useState<any>(null);
  const [isResolvingDuplicates, setIsResolvingDuplicates] = useState(false);

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

  // Enhanced analysis function that uses the new endpoint
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

          Spicetify.showNotification(
            `Analysis complete! Found ${result.duplicate_detection.conflicts_found} duplicate conflicts that need resolution.`,
            false
          );
        } else {
          Spicetify.showNotification(
            `Analysis complete! ${
              result.auto_matched_files?.length || 0
            } files can be auto-matched.`,
            false
          );
        }
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

  // Enhanced mapping creation with duplicate resolution
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

  // Handle duplicate resolution
  const handleDuplicateResolution = async (resolutions: Record<string, string>) => {
    await createMappingsWithResolution(resolutions);
  };

  const handleDuplicateResolutionCancel = () => {
    setShowDuplicateResolution(false);
    setDuplicateDetectionResult(null);
  };

  // Updated apply mappings function
  const applyAllMappings = async () => {
    if (duplicateDetectionResult?.needs_user_resolution) {
      // Show duplicate resolution first
      setShowDuplicateResolution(true);
      return;
    }

    await createMappingsWithResolution();
  };

  // Show duplicate detection status in the UI
  const renderDuplicateDetectionStatus = () => {
    const detection = (analysisResults as AnalysisResultsFileMapping)?.duplicate_detection;

    if (!detection?.performed) return null;

    return (
      <div className={styles.duplicateDetectionStatus}>
        <h4>🔍 Duplicate Detection Results</h4>
        <div className={styles.detectionStats}>
          {detection.needs_resolution ? (
            <div className={styles.conflictsFound}>
              <span className={styles.warningIcon}>⚠️</span>
              <strong>{detection.conflicts_found} duplicate conflicts found</strong>
              <span>These need to be resolved before creating mappings</span>
            </div>
          ) : (
            <div className={styles.noConflicts}>
              <span className={styles.successIcon}>✅</span>
              <strong>No duplicate conflicts found</strong>
              <span>{detection.clean_mappings} clean mappings ready</span>
            </div>
          )}
        </div>
      </div>
    );
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
    if (duplicateDetectionResult?.needs_user_resolution) {
      // Show duplicate resolution first
      setShowDuplicateResolution(true);
      return;
    }

    await createMappingsWithResolution();
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
    <>
      {/* Main Wizard Panel */}

      <Portal>
        <div className={styles.modalOverlay}>
          <div className={styles.fileMappingWizard}>
            <div className={styles.wizardHeader}>
              <h3>🎵 File Mapping Wizard</h3>
              <div className={styles.wizardProgress}>
                <ClearMappingsConfirmationDialog />

                {analysisResults && (
                  <div className={styles.progressSummary}>
                    <span className={styles.progressItem}>
                      Total Files: <strong>{analysisResults.details.total_files}</strong>
                    </span>
                    <span className={styles.progressItem}>
                      Auto-matched:{" "}
                      <strong>{analysisResults.details.auto_matched_files.length}</strong>
                    </span>
                    <span className={styles.progressItem}>
                      Manual:{" "}
                      <strong>{analysisResults.details.files_requiring_user_input.length}</strong>
                    </span>
                  </div>
                )}

                <button
                  className={styles.clearMappingsButton}
                  onClick={() => setShowClearConfirmation(true)}
                  disabled={isLoading["clear-file-mappings-table"]}
                >
                  {isLoading["clear-file-mappings-table"]
                    ? "Clearing mappings..."
                    : "🗑️ Clear All Mappings"}
                </button>
              </div>
            </div>

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
                  onChange={(e) =>
                    onFileMappingConfidenceThresholdChange(Number(e.target.value))
                  }
                  className={styles.thresholdSlider}
                />
              </div>
            </div>

            {/* Enhanced Analysis Button */}
            <div className={styles.analysisSection}>
              <button
                className={styles.enhancedAnalysisButton}
                onClick={runEnhancedAnalysis}
                disabled={isLoading["create-file-mappings"]}
              >
                {isLoading["create-file-mappings"] ? "🔍 Analyzing..." : "🔍 Run Analysis"}
              </button>

              {analysisResults && (
                <div className={styles.analysisResults}>
                  <p className={styles.analysisMessage}>{analysisResults.message}</p>
                </div>
              )}
            </div>

            {/* Duplicate Detection Status */}
            {renderDuplicateDetectionStatus()}

            {/* Auto-matched Files Preview */}
            {analysisResults?.details?.auto_matched_files &&
              analysisResults.details.auto_matched_files.length > 0 && (
                <div className={styles.autoMatchedSection}>
                  <h4>
                    ✅ Auto-matched Files ({analysisResults.details.auto_matched_files.length})
                    {rejectedAutoMatches.length > 0 && (
                      <span className={styles.rejectedCount}>
                        ({rejectedAutoMatches.length} rejected)
                      </span>
                    )}
                  </h4>

                  <div className={styles.autoMatchedList}>
                    {getPagedItems(
                      getNonRejectedAutoMatches(),
                      autoMatchedPage,
                      autoMatchedPerPage
                    ).map((match, index) => {
                      const isRejected = rejectedAutoMatches.includes(match.file_path);
                      return (
                        <div
                          key={match.file_path}
                          className={`${styles.autoMatchedItem} ${
                            isRejected ? styles.rejected : ""
                          }`}
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
                    })}
                  </div>
                  {/* TODO: keep this? */}
                  {getNonRejectedAutoMatches().length > 0 && (
                    <div className={styles.autoMatchActions}>
                      <button
                        className={styles.applyAutoMatchesButton}
                        onClick={handleApplyAutoMatches}
                        disabled={isLoading["create-file-mappings"]}
                      >
                        Apply {getNonRejectedAutoMatches().length} Auto-Matches
                      </button>

                      {rejectedAutoMatches.length > 0 && (
                        <button
                          className={styles.clearRejectionsButton}
                          onClick={handleClearRejections}
                        >
                          Clear {rejectedAutoMatches.length} Rejections
                        </button>
                      )}
                    </div>
                  )}

                  {/* Pagination for auto-matched files */}
                  {analysisResults.details.auto_matched_files.length > autoMatchedPerPage && (
                    <div className={styles.pagination}>
                      <button
                        onClick={() => onAutoMatchedPageChange(Math.max(1, autoMatchedPage - 1))}
                        disabled={autoMatchedPage === 1}
                      >
                        Previous
                      </button>
                      <span>
                        Page {autoMatchedPage} of{" "}
                        {Math.ceil(
                          analysisResults.details.auto_matched_files.length / autoMatchedPerPage
                        )}
                      </span>
                      <button
                        onClick={() => onAutoMatchedPageChange(autoMatchedPage + 1)}
                        disabled={
                          autoMatchedPage >=
                          Math.ceil(
                            analysisResults.details.auto_matched_files.length / autoMatchedPerPage
                          )
                        }
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}

            {/* File Status Summary */}
            <div className={styles.fileStatusSummary}>
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

            {/* Manual Matching Interface */}
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
                                  <p>URI: {mappedSelection.uri}</p>
                                  <p>
                                    Confidence: {(mappedSelection.confidence * 100).toFixed(1)}%
                                  </p>
                                  <button
                                    className={styles.remapButton}
                                    onClick={() => {
                                      // Remove from selections and show matches again
                                      const filtered = userMatchSelections.filter((s) => {
                                        if ("file_path" in s) {
                                          return s.file_path !== currentFilePath;
                                        }
                                        return true;
                                      });
                                      onUserMatchSelectionsChange(filtered);
                                    }}
                                  >
                                    Re-map this file
                                  </button>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}

                      {/* Fuzzy matching results - only show if not already mapped */}
                      {!isCurrentFileAlreadyMapped() && (
                        <>
                          {fuzzyMatchingState.isLoading ? (
                            <div className={styles.loadingMatches}>
                              <p>🔍 Finding matches for {currentFileName}...</p>
                            </div>
                          ) : fuzzyMatchingState.matches.length > 0 ? (
                            <div className={styles.matchesSection}>
                              <h4>Potential matches for: {currentFileName}</h4>
                              <div className={styles.matchesList}>
                                {fuzzyMatchingState.matches.map((match, index) => (
                                  <div key={index} className={styles.matchItem}>
                                    <div className={styles.matchInfo}>
                                      <div className={styles.trackName}>
                                        {match.artist} - {match.title}
                                      </div>
                                      <div className={styles.trackDetails}>
                                        Album: {match.album} | Confidence:{" "}
                                        {(match.confidence * 100).toFixed(1)}%
                                        {match.is_local && (
                                          <span className={styles.localBadge}>Local</span>
                                        )}
                                      </div>
                                    </div>
                                    <button
                                      className={styles.selectMatchButton}
                                      onClick={() => handleSelectMatch(match)}
                                    >
                                      Select
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : fuzzyMatchingState.isActive ? (
                            <div className={styles.noMatchesSection}>
                              <p>No good matches found for: {currentFileName}</p>
                              <button
                                className={styles.searchButton}
                                onClick={() => onShowSearchResultsChange(true)}
                              >
                                🔍 Search manually
                              </button>
                            </div>
                          ) : null}

                          {/* Manual search interface */}
                          {showSearchResults && (
                            <div className={styles.searchSection}>
                              <div className={styles.searchInput}>
                                <input
                                  type="text"
                                  placeholder="Search for track..."
                                  value={searchQuery}
                                  onChange={(e) => onSearchQueryChange(e.target.value)}
                                  onKeyPress={(e) => e.key === "Enter" && handleSearch(searchQuery)}
                                />
                                <button
                                  onClick={() => handleSearch(searchQuery)}
                                  disabled={isSearching}
                                >
                                  {isSearching ? "Searching..." : "Search"}
                                </button>
                              </div>

                              {searchResults.length > 0 && (
                                <div className={styles.searchResults}>
                                  <h5>Search results:</h5>
                                  <div className={styles.searchResultsList}>
                                    {searchResults.map((result, index) => (
                                      <div key={index} className={styles.searchResultItem}>
                                        <div className={styles.resultInfo}>
                                          <div className={styles.resultTrack}>
                                            {result.artist} - {result.title}
                                          </div>
                                          <div className={styles.resultDetails}>
                                            Album: {result.album} | Confidence:{" "}
                                            {(result.confidence * 100).toFixed(1)}%
                                            {result.is_local && (
                                              <span className={styles.localBadge}>Local</span>
                                            )}
                                          </div>
                                        </div>
                                        <button
                                          className={styles.selectSearchButton}
                                          onClick={() => handleSelectMatch(result)}
                                        >
                                          Select
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* File navigation controls */}
                      <div className={styles.fileNavigation}>
                        <button
                          className={styles.skipButton}
                          onClick={() => {
                            const skippedFilePath =
                              manualFiles[fuzzyMatchingState.currentFileIndex]?.file_path;
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
                            } else {
                              // All files processed
                              onFuzzyMatchingStateChange({
                                ...fuzzyMatchingState,
                                isActive: false,
                              });
                            }
                          }}
                        >
                          Skip This File
                        </button>

                        <button
                          className={styles.prevButton}
                          onClick={() => {
                            onFuzzyMatchingStateChange({
                              ...fuzzyMatchingState,
                              currentFileIndex: Math.max(
                                0,
                                fuzzyMatchingState.currentFileIndex - 1
                              ),
                              matches: [],
                            });
                          }}
                          disabled={fuzzyMatchingState.currentFileIndex === 0}
                        >
                          ← Previous File
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

            {/* Action Buttons */}
            <div className={styles.wizardActions}>
              {analysisResults && (
                <button
                  className={styles.applyAllButton}
                  onClick={applyAllMappings}
                  disabled={isLoading["create-file-mappings"] || isResolvingDuplicates}
                >
                  {isResolvingDuplicates
                    ? "Processing..."
                    : duplicateDetectionResult?.needs_user_resolution
                    ? "⚠️ Resolve Conflicts & Apply"
                    : "✅ Apply All Mappings"}
                </button>
              )}

              {/* Clear confirmation dialog */}
              {showClearConfirmation && (
                <div className={styles.clearConfirmation}>
                  <p>Are you sure you want to clear all file mappings? This cannot be undone.</p>
                  <div className={styles.confirmationButtons}>
                    <button
                      className={styles.confirmClearButton}
                      onClick={handleClearMappingsTable}
                      disabled={isLoading["clear-file-mappings-table"]}
                    >
                      {isLoading["clear-file-mappings-table"] ? "Clearing..." : "Yes, Clear All"}
                    </button>
                    <button
                      className={styles.cancelClearButton}
                      onClick={() => setShowClearConfirmation(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
