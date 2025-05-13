import React, { useState, useEffect } from "react";
import styles from "./PythonActionsPanel.module.css";
import ValidationPanel from "./ValidationPanel";

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

interface ActionInfo {
  name: string;
  data: any;
}

type Match = {
  track_id: string;
  artist: string;
  title: string;
  album: string;
  ratio: number;
};

interface MatchSelection {
  fileName: string;
  trackId: string;
  confidence: number;
}

const ActionButton: React.FC<ActionButtonProps> = ({ label, onClick, disabled, className }) => (
  <button
    className={`${styles.actionButton} ${className || ""}`}
    onClick={onClick}
    disabled={disabled}
  >
    {label}
  </button>
);

const PythonActionsPanel: React.FC = () => {
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<
    Record<string, { success: boolean; message: string } | null>
  >({});
  const [serverUrl, setServerUrl] = useState(() => {
    const savedUrl = localStorage.getItem("tagify:localServerUrl");
    if (savedUrl) {
      // Remove any extra quotes that might have been added
      return savedUrl.replace(/^["'](.*)["']$/, "$1");
    }
    return "http://localhost:8765";
  });
  const [masterPlaylistId, setMasterPlaylistId] = useState(
    () => localStorage.getItem("tagify:masterPlaylistId") || ""
  );
  const [serverStatus, setServerStatus] = useState<"unknown" | "connected" | "disconnected">(
    "unknown"
  );

  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const [validationType, setValidationType] = useState<"track" | "playlist">("track");

  const [userMatchSelections, setUserMatchSelections] = useState<
    { fileName: string; trackId: string; confidence: number }[]
  >([]);
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);
  const [fuzzyMatchingState, setFuzzyMatchingState] = useState<{
    isActive: boolean;
    currentFileIndex: number;
    matches: Match[];
    isLoading: boolean;
  }>({
    isActive: false,
    currentFileIndex: 0,
    matches: [],
    isLoading: false,
  });

  // Paths from localStorage or default values
  const [paths, setPaths] = useState({
    masterTracksDir: localStorage.getItem("tagify:masterTracksDir") || "",
    playlistsDir: localStorage.getItem("tagify:playlistsDir") || "",
  });

  const [matchPage, setMatchPage] = useState(1);
  const [autoMatchPage, setAutoMatchPage] = useState(1);
  const [skippedPage, setSkippedPage] = useState(1);
  const itemsPerPage = 20;

  const getPagedItems = <T,>(items: T[], page: number, perPage: number): T[] => {
    const startIndex = (page - 1) * perPage;
    return items.slice(startIndex, startIndex + perPage);
  };

  const [analysisResults, setAnalysisResults] = useState<any>(null);
  const [isAwaitingConfirmation, setIsAwaitingConfirmation] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionInfo | null>(null);
  const [paginationState, setPaginationState] = useState<
    Record<string, { page: number; pageSize: number }>
  >({});

  // Check server connection on load and when serverUrl changes
  useEffect(() => {
    checkServerConnection();
  }, [serverUrl]);

  const checkServerConnection = async () => {
    try {
      const response = await fetch(`${serverUrl}/status`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (response.ok) {
        setServerStatus("connected");
        // Get environment variables from server
        const data = await response.json();
        if (data.env_vars) {
          if (data.env_vars.MASTER_TRACKS_DIRECTORY_SSD && !paths.masterTracksDir) {
            setPaths((prev) => ({
              ...prev,
              masterTracksDir: data.env_vars.MASTER_TRACKS_DIRECTORY_SSD,
            }));
          }
          if (data.env_vars.MASTER_PLAYLIST_ID && !masterPlaylistId) {
            setMasterPlaylistId(data.env_vars.MASTER_PLAYLIST_ID);
            localStorage.setItem("tagify:masterPlaylistId", data.env_vars.MASTER_PLAYLIST_ID);
          }
        }
      } else {
        setServerStatus("disconnected");
      }
    } catch (err) {
      console.error("Error connecting to server:", err);
      setServerStatus("disconnected");
    }
  };

  const saveSettings = () => {
    // Remove any quotes before saving
    const cleanUrl = serverUrl.replace(/^["'](.*)["']$/, "$1");
    localStorage.setItem("tagify:localServerUrl", cleanUrl);

    // Clean other paths as well
    const cleanMasterTracksDir = paths.masterTracksDir.replace(/^["'](.*)["']$/, "$1");
    const cleanPlaylistsDir = paths.playlistsDir.replace(/^["'](.*)["']$/, "$1");

    localStorage.setItem("tagify:masterTracksDir", cleanMasterTracksDir);
    localStorage.setItem("tagify:playlistsDir", cleanPlaylistsDir);
    localStorage.setItem("tagify:masterPlaylistId", masterPlaylistId);

    // Update state with cleaned values
    setServerUrl(cleanUrl);
    setPaths({
      masterTracksDir: cleanMasterTracksDir,
      playlistsDir: cleanPlaylistsDir,
    });

    Spicetify.showNotification("Settings saved!");
    checkServerConnection();
  };

  const performAction = async (action: string, data: any = {}) => {
    setIsLoading((prev) => ({ ...prev, [action]: true }));
    setResults((prev) => ({ ...prev, [action]: null }));

    try {
      // Clean up paths before sending
      const cleanMasterTracksDir = paths.masterTracksDir.replace(/^["'](.*)["']$/, "$1");
      const cleanPlaylistsDir = paths.playlistsDir.replace(/^["'](.*)["']$/, "$1");

      // Add paths to the data
      const requestData = {
        ...data,
        masterTracksDir: cleanMasterTracksDir,
        playlistsDir: cleanPlaylistsDir,
        master_playlist_id: masterPlaylistId,
      };

      console.log(`Sending request to ${action}:`, requestData);
      const response = await fetch(`${serverUrl.replace(/^["'](.*)["']$/, "$1")}/api/${action}`, {
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

      const result = await response.json();

      // Check if this is an embed-metadata operation that requires fuzzy matching
      if (
        action === "embed-metadata" &&
        result.needs_confirmation &&
        result.requires_fuzzy_matching &&
        !data.confirmed
      ) {
        // Set up for fuzzy matching process
        setAnalysisResults(result);
        setIsAwaitingConfirmation(true);
        setCurrentAction({
          name: action,
          data: requestData,
        });
        setUserMatchSelections([]);
        setSkippedFiles([]);
        setFuzzyMatchingState({
          isActive: true,
          currentFileIndex: 0,
          matches: [],
          isLoading: false,
        });

        // Show notification about analysis completion
        Spicetify.showNotification(
          `Found ${result.details.files_to_process.length} files to process.`
        );
      }
      // For other analysis operations that need confirmation
      else if (result.needs_confirmation && !data.confirmed) {
        setAnalysisResults(result);
        setIsAwaitingConfirmation(true);
        setCurrentAction({
          name: action,
          data: requestData,
        });

        // Show notification about analysis completion
        Spicetify.showNotification(`Analysis complete. Please review and confirm.`);
      }
      // Regular result - process normally
      else {
        setResults((prev) => ({
          ...prev,
          [action]: { success: result.success, message: result.message || JSON.stringify(result) },
        }));

        // Show notification
        if (result.success) {
          Spicetify.showNotification(`Success: ${result.message || action + " completed"}`);
        } else {
          Spicetify.showNotification(`Error: ${result.message || "Unknown error"}`, true);
        }
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`Error performing action ${action}:`, error);
      setResults((prev) => ({
        ...prev,
        [action]: { success: false, message: error.message || String(error) },
      }));
      Spicetify.showNotification(`Server error: ${error.message || String(error)}`, true);
    } finally {
      setIsLoading((prev) => ({ ...prev, [action]: false }));
    }
  };

  // Handle confirmation
  const confirmAction = async () => {
    if (!currentAction) return;

    const { name, data } = currentAction;

    // Add confirmation flag and user selections to the data
    const confirmData = {
      ...data,
      confirmed: true,
    };

    if (name === "sync-database") {
      console.log(`Confirming ${data.action} sync with:`, confirmData);
    }

    // For association sync, include the precomputed changes
    if (name === "sync-database" && data.action === "associations" && analysisResults) {
      // Include the precomputed changes in the confirmation data
      confirmData.precomputed_changes = {
        tracks_with_changes:
          analysisResults.details?.tracks_with_changes ||
          analysisResults.details?.all_changes ||
          analysisResults.details?.samples ||
          [],
        tracks_with_playlists: analysisResults.stats?.tracks_with_playlists,
        tracks_without_playlists: analysisResults.stats?.tracks_without_playlists,
        total_associations: analysisResults.stats?.total_associations,
      };

      console.log(
        "Passing precomputed changes to avoid redundant processing",
        confirmData.precomputed_changes
      );
    }

    if (name === "embed-metadata") {
      // Include the user-selected matches for embed-metadata
      confirmData.userSelections = userMatchSelections;
      confirmData.skippedFiles = skippedFiles;
    }

    // Reset states
    setAnalysisResults(null);
    setIsAwaitingConfirmation(false);
    setCurrentAction(null);
    setUserMatchSelections([]);
    setSkippedFiles([]);
    setFuzzyMatchingState({
      isActive: false,
      currentFileIndex: 0,
      matches: [],
      isLoading: false,
    });

    // Perform the action with confirmation
    await performAction(name, confirmData);
  };

  // Cancel confirmation
  const cancelAction = () => {
    // Reset all states
    setAnalysisResults(null);
    setIsAwaitingConfirmation(false);
    setCurrentAction(null);
    setUserMatchSelections([]);
    setSkippedFiles([]);
    setFuzzyMatchingState({
      isActive: false,
      currentFileIndex: 0,
      matches: [],
      isLoading: false,
    });

    Spicetify.showNotification("Operation cancelled");
  };

  // ! Track validation
  const openTrackValidation = () => {
    setValidationType("track");
    setShowValidationPanel(true);
  };

  const openPlaylistValidation = () => {
    setValidationType("playlist");
    setShowValidationPanel(true);
  };

  const getPagination = (section: string) => {
    if (!paginationState[section]) {
      // Default pagination: start with 20 items, page 1
      setPaginationState((prev) => ({
        ...prev,
        [section]: { page: 1, pageSize: 20 },
      }));
      return { page: 1, pageSize: 20 };
    }
    return paginationState[section];
  };

  const loadMoreItems = (section: string) => {
    setPaginationState((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        page: prev[section]?.page + 1 || 2,
      },
    }));
  };

  useEffect(() => {
    // When the analysis results come in, show how many files were auto-matched
    if (analysisResults && analysisResults.details && analysisResults.details.auto_matched_files) {
      const autoMatchedCount = analysisResults.details.auto_matched_files.length;
      if (autoMatchedCount > 0) {
        Spicetify.showNotification(
          `Auto-matched ${autoMatchedCount} files with high confidence!`,
          false,
          3000
        );
      }
    }
  }, [analysisResults]);

  const FuzzyMatchConfirmation = () => {
    const files = analysisResults?.details?.files_to_process || [];
    const currentFile = files[fuzzyMatchingState.currentFileIndex];

    // Local state to track matches independently from React's state updates
    const [localMatches, setLocalMatches] = useState<any[]>([]);
    const [isLocalLoading, setIsLocalLoading] = useState(false);
    const [hasCalledAPI, setHasCalledAPI] = useState(false);

    // This effect will run once per file
    useEffect(() => {
      const fetchMatches = async () => {
        // Exit early if no file or already called API for this file
        if (!currentFile || hasCalledAPI) return;

        console.log(`Fetching matches for ${currentFile} (independent fetch)`);
        setIsLocalLoading(true);
        setHasCalledAPI(true);

        try {
          const sanitizedUrl = serverUrl.replace(/^["'](.*)["']$/, "$1").trim();

          // Use a simpler fetch approach
          const response = await fetch(`${sanitizedUrl}/api/fuzzy-match-track`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileName: currentFile,
              masterTracksDir: paths.masterTracksDir,
            }),
          });

          console.log(`Received response with status ${response.status}`);

          if (response.ok) {
            const data = await response.json();
            console.log("Fetch received data:", data);

            if (data && data.success && data.matches) {
              console.log(`Found ${data.matches.length} matches via fetch`);
              setLocalMatches(data.matches);
            } else {
              console.error("Invalid response format:", data);
              setLocalMatches([]);
            }
          } else {
            console.error(`Fetch request failed with status: ${response.status}`);
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
    }, [currentFile]); // Only run when currentFile changes

    // Reset the hasCalledAPI flag when moving to a new file
    useEffect(() => {
      setHasCalledAPI(false);
      setLocalMatches([]);
    }, [fuzzyMatchingState.currentFileIndex]);

    const handleSelectMatch = (match: any) => {
      // Add selection to tracked selections
      setUserMatchSelections((prev) => [
        ...prev,
        {
          fileName: currentFile,
          trackId: match.track_id,
          confidence: match.ratio,
        },
      ]);

      // Move to next file
      if (fuzzyMatchingState.currentFileIndex < files.length - 1) {
        setFuzzyMatchingState((prev) => ({
          ...prev,
          currentFileIndex: prev.currentFileIndex + 1,
          matches: [],
        }));
      } else {
        // All files processed
        setFuzzyMatchingState((prev) => ({
          ...prev,
          isActive: false,
        }));
      }
    };

    const handleSkip = () => {
      // Add file to skipped files
      setSkippedFiles((prev) => [...prev, currentFile]);

      // Move to next file
      if (fuzzyMatchingState.currentFileIndex < files.length - 1) {
        setFuzzyMatchingState((prev) => ({
          ...prev,
          currentFileIndex: prev.currentFileIndex + 1,
          matches: [],
        }));
      } else {
        // All files processed
        setFuzzyMatchingState((prev) => ({
          ...prev,
          isActive: false,
        }));
      }
    };

    const processedFilesCount = userMatchSelections.length + skippedFiles.length;

    // Debug output to see what's happening
    console.log("Current state:", {
      currentFile,
      isLocalLoading,
      hasCalledAPI,
      matchCount: localMatches.length,
      currentFileIndex: fuzzyMatchingState.currentFileIndex,
      filesLength: files.length,
    });

    return (
      <div className={styles.fuzzyMatchContainer}>
        <h3>
          Match Files with Tracks ({processedFilesCount} of {files.length} complete)
        </h3>

        {analysisResults &&
          analysisResults.details &&
          analysisResults.details.auto_matched_files &&
          analysisResults.details.auto_matched_files.length > 0 && (
            <div className={styles.autoMatchedSection}>
              <h4>Auto-matched Files ({analysisResults.details.auto_matched_files.length})</h4>
              <p>These files were automatically matched with high confidence (75%+):</p>
              <div className={styles.autoMatchedList}>
                {analysisResults.details.auto_matched_files.slice(0, 5).map(
                  (
                    match: {
                      fileName:
                        | string
                        | number
                        | bigint
                        | boolean
                        | React.ReactElement<unknown, string | React.JSXElementConstructor<any>>
                        | Iterable<React.ReactNode>
                        | React.ReactPortal
                        | Promise<
                            | string
                            | number
                            | bigint
                            | boolean
                            | React.ReactPortal
                            | React.ReactElement<unknown, string | React.JSXElementConstructor<any>>
                            | Iterable<React.ReactNode>
                            | null
                            | undefined
                          >
                        | null
                        | undefined;
                      confidence: number;
                    },
                    index: React.Key | null | undefined
                  ) => (
                    <div key={index} className={styles.autoMatchedItem}>
                      <span className={styles.fileName}>{match.fileName}</span>
                      <span className={styles.confidence}>
                        {(match.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                  )
                )}
                {analysisResults.details.auto_matched_files.length > 5 && (
                  <div className={styles.moreMatches}>
                    ...and {analysisResults.details.auto_matched_files.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}

        {currentFile ? (
          <>
            <div className={styles.fileInfo}>
              <div className={styles.fileName}>
                <strong>Current file:</strong> {currentFile}
              </div>
              <div className={styles.progress}>
                File {fuzzyMatchingState.currentFileIndex + 1} of {files.length}
              </div>
            </div>

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
                        Confidence: {(match.ratio * 100).toFixed(2)}%
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
                        setHasCalledAPI(false); // Allow retrying
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Show debug info for easier troubleshooting */}
                <div
                  className={styles.debugInfo}
                  style={{ marginTop: "20px", fontSize: "12px", color: "#999" }}
                >
                  <p>
                    Debug: API called: {hasCalledAPI ? "Yes" : "No"}, Loading:{" "}
                    {isLocalLoading ? "Yes" : "No"}, Matches: {localMatches.length}
                  </p>
                  <p>
                    File index: {fuzzyMatchingState.currentFileIndex}, Total files: {files.length}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={styles.matchingComplete}>
            <p>All files have been processed!</p>
            <p>Selected matches for {userMatchSelections.length} files.</p>
            <p>Skipped {skippedFiles.length} files.</p>
            <button className={styles.confirmButton} onClick={confirmAction}>
              Confirm and Embed Metadata
            </button>
            <button className={styles.cancelButton} onClick={cancelAction}>
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render the confirmation UI when needed
  const renderConfirmation = () => {
    if (!isAwaitingConfirmation || !analysisResults) return null;

    // For embed-metadata action with fuzzy matching
    if (
      currentAction?.name === "embed-metadata" &&
      analysisResults.requires_fuzzy_matching &&
      fuzzyMatchingState.isActive
    ) {
      return (
        <div className={styles.confirmationPanel}>
          <FuzzyMatchConfirmation />
        </div>
      );
    }

    // For embed-metadata action when fuzzy matching is complete or for final confirmation
    if (
      currentAction?.name === "embed-metadata" &&
      analysisResults.requires_fuzzy_matching &&
      !fuzzyMatchingState.isActive &&
      (userMatchSelections.length > 0 || skippedFiles.length > 0)
    ) {
      return (
        <div className={styles.confirmationPanel}>
          <h3>Confirm Metadata Embedding</h3>
          <div className={styles.summaryContainer}>
            <p>Ready to embed metadata for {userMatchSelections.length} files.</p>
            <p>{skippedFiles.length} files were skipped.</p>

            <div className={styles.selectionsContent}>
              {userMatchSelections &&
                userMatchSelections.length > 0 &&
                getPagedItems(userMatchSelections, matchPage, itemsPerPage).map(
                  (selection: MatchSelection, index: number) => (
                    <div key={index} className={styles.selectionItem}>
                      <div className={styles.selectionFile}>{selection.fileName}</div>
                      <div className={styles.selectionTrackId}>{selection.trackId}</div>
                      <div className={styles.selectionConfidence}>
                        Confidence: {(selection.confidence * 100).toFixed(2)}%
                      </div>
                    </div>
                  )
                )}

              {/* Pagination controls */}
              {userMatchSelections && userMatchSelections.length > itemsPerPage && (
                <div className={styles.paginationControls}>
                  <button
                    disabled={matchPage === 1}
                    onClick={() => setMatchPage((prev) => Math.max(1, prev - 1))}
                  >
                    Previous
                  </button>
                  <span>
                    Page {matchPage} of {Math.ceil(userMatchSelections.length / itemsPerPage)}
                  </span>
                  <button
                    disabled={matchPage >= Math.ceil(userMatchSelections.length / itemsPerPage)}
                    onClick={() => setMatchPage((prev) => prev + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>

            {/* Auto-matched files section */}
            {analysisResults.details?.auto_matched_files &&
              analysisResults.details.auto_matched_files.length > 0 && (
                <div className={styles.autoMatchedPreview}>
                  <h4>Auto-Matched Files:</h4>
                  <div className={styles.selectionsContent}>
                    {getPagedItems<any>(
                      Array.isArray(analysisResults.details.auto_matched_files)
                        ? analysisResults.details.auto_matched_files
                        : [],
                      autoMatchPage,
                      itemsPerPage
                    ).map((match, index: number) => {
                      // Cast the match to MatchSelection type
                      const typedMatch = match as MatchSelection;
                      return (
                        <div key={index} className={styles.selectionItem}>
                          <div className={styles.selectionFile}>{typedMatch.fileName}</div>
                          <div className={styles.selectionTrackId}>{typedMatch.trackId}</div>
                          <div className={styles.selectionConfidence}>
                            Confidence: {(typedMatch.confidence * 100).toFixed(2)}%
                          </div>
                        </div>
                      );
                    })}

                    {/* Pagination for auto-matched files */}
                    {Array.isArray(analysisResults.details.auto_matched_files) &&
                      analysisResults.details.auto_matched_files.length > itemsPerPage && (
                        <div className={styles.paginationControls}>
                          <button
                            disabled={autoMatchPage === 1}
                            onClick={() => setAutoMatchPage((prev) => Math.max(1, prev - 1))}
                          >
                            Previous
                          </button>
                          <span>
                            Page {autoMatchPage} of{" "}
                            {Math.ceil(
                              analysisResults.details.auto_matched_files.length / itemsPerPage
                            )}
                          </span>
                          <button
                            disabled={
                              autoMatchPage >=
                              Math.ceil(
                                analysisResults.details.auto_matched_files.length / itemsPerPage
                              )
                            }
                            onClick={() => setAutoMatchPage((prev) => prev + 1)}
                          >
                            Next
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              )}

            {/* Skipped files section */}
            {skippedFiles && skippedFiles.length > 0 && (
              <div className={styles.skippedFilesPreview}>
                <h4>Skipped Files:</h4>
                <div className={styles.selectionsContent}>
                  {getPagedItems(skippedFiles, skippedPage, itemsPerPage).map(
                    (fileName: string, index: number) => (
                      <div key={index} className={styles.skippedItem}>
                        {fileName}
                      </div>
                    )
                  )}

                  {/* Pagination for skipped files */}
                  {skippedFiles.length > itemsPerPage && (
                    <div className={styles.paginationControls}>
                      <button
                        disabled={skippedPage === 1}
                        onClick={() => setSkippedPage((prev) => Math.max(1, prev - 1))}
                      >
                        Previous
                      </button>
                      <span>
                        Page {skippedPage} of {Math.ceil(skippedFiles.length / itemsPerPage)}
                      </span>
                      <button
                        disabled={skippedPage >= Math.ceil(skippedFiles.length / itemsPerPage)}
                        onClick={() => setSkippedPage((prev) => prev + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className={styles.confirmationButtons}>
              <button className={styles.confirmButton} onClick={confirmAction}>
                Confirm and Embed Metadata
              </button>
              <button className={styles.cancelButton} onClick={cancelAction}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.confirmationPanel}>
        <h3>Confirm Changes</h3>

        {analysisResults.analyses && (
          // This is for the 'all' action
          <div className={styles.allAnalyses}>
            <h4>Playlist Changes</h4>
            <p>
              {analysisResults.analyses.playlists.added} playlists to add,
              {analysisResults.analyses.playlists.updated} to update,
              {analysisResults.analyses.playlists.unchanged} unchanged
            </p>

            {/* Paginated Playlists to Add */}
            {analysisResults.analyses.playlists.details.to_add.length > 0 && (
              <div className={styles.sampleChanges}>
                <h5>
                  Playlists to Add ({analysisResults.analyses.playlists.details.to_add.length})
                </h5>
                <div className={styles.itemList}>
                  {renderPaginatedList(
                    analysisResults.analyses.playlists.details.to_add,
                    "playlists-add",
                    (item) => (
                      <div className={styles.item}>{item.name}</div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Paginated Playlists to Update */}
            {analysisResults.analyses.playlists.details.to_update.length > 0 && (
              <div className={styles.sampleChanges}>
                <h5>
                  Playlists to Update ({analysisResults.analyses.playlists.details.to_update.length}
                  )
                </h5>
                <div className={styles.itemList}>
                  {renderPaginatedList(
                    analysisResults.analyses.playlists.details.to_update,
                    "playlists-update",
                    (item) => (
                      <div className={styles.item}>
                        {item.old_name} → {item.name}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            <h4>Track Changes</h4>
            <p>
              {analysisResults.analyses.tracks.added} tracks to add,
              {analysisResults.analyses.tracks.updated} to update,
              {analysisResults.analyses.tracks.unchanged} unchanged
            </p>

            {/* Paginated Tracks to Add */}
            {analysisResults.analyses.tracks.to_add_total > 0 && (
              <div className={styles.sampleChanges}>
                <h5>Tracks to Add ({analysisResults.analyses.tracks.to_add_total})</h5>
                <div className={styles.trackList}>
                  {renderPaginatedList(
                    analysisResults.analyses.tracks.all_tracks_to_add ||
                      analysisResults.analyses.tracks.to_add_sample,
                    "tracks-add",
                    (track) => (
                      <div className={styles.trackItem}>
                        {track.artists} - {track.title} {track.is_local ? "(LOCAL)" : ""}
                      </div>
                    ),
                    analysisResults.analyses.tracks.to_add_total
                  )}
                </div>
              </div>
            )}

            {/* Paginated Tracks to Update */}
            {analysisResults.analyses.tracks.to_update_total > 0 && (
              <div className={styles.sampleChanges}>
                <h5>Tracks to Update ({analysisResults.analyses.tracks.to_update_total})</h5>
                <div className={styles.trackList}>
                  {renderPaginatedList(
                    analysisResults.analyses.tracks.all_tracks_to_update || [],
                    "tracks-update",
                    (track) => (
                      <div className={styles.trackItem}>
                        {track.old_artists} - {track.old_title} → {track.artists} - {track.title}
                      </div>
                    ),
                    analysisResults.analyses.tracks.to_update_total
                  )}
                </div>
              </div>
            )}

            <h4>Association Changes</h4>
            <p>
              {analysisResults.analyses.associations.associations_to_add} associations to add,
              {analysisResults.analyses.associations.associations_to_remove} to remove, affecting{" "}
              {analysisResults.analyses.associations.tracks_with_changes.length} tracks
            </p>

            {/* Paginated association changes */}
            {(analysisResults.analyses.associations.all_changes ||
              analysisResults.analyses.associations.samples) && (
              <div className={styles.sampleChanges}>
                <h5>
                  Track Association Changes (
                  {analysisResults.analyses.associations.tracks_with_changes
                    ? analysisResults.analyses.associations.tracks_with_changes.length
                    : "Unknown"}
                  )
                </h5>
                <div className={styles.trackList}>
                  {renderPaginatedList(
                    analysisResults.analyses.associations.all_changes ||
                      analysisResults.analyses.associations.samples ||
                      [],
                    "associations",
                    (item) => (
                      <div className={styles.trackItem}>
                        {/* Clearly display the track info as a header */}
                        <div className={styles.trackItemHeader}>
                          <strong>{item.track_info || item.track}</strong>
                        </div>
                        {item.add_to && item.add_to.length > 0 && (
                          <div className={styles.addTo}>
                            <span className={styles.changeIcon}>+</span> Adding to playlists:{" "}
                            {item.add_to.join(", ")}
                          </div>
                        )}
                        {item.remove_from && item.remove_from.length > 0 && (
                          <div className={styles.removeFrom}>
                            <span className={styles.changeIcon}>-</span> Removing from playlists:{" "}
                            {item.remove_from.join(", ")}
                          </div>
                        )}
                      </div>
                    ),
                    analysisResults.analyses.associations.tracks_with_changes
                      ? analysisResults.analyses.associations.tracks_with_changes.length
                      : undefined
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Display specific analysis results for other actions */}
        {analysisResults.details && !analysisResults.analyses && (
          <div className={styles.specificAnalysis}>
            {/* Render details based on what's available */}
            {analysisResults.details.to_add && analysisResults.details.to_add.length > 0 && (
              <div className={styles.sampleChanges}>
                <h5>
                  Items to Add (
                  {analysisResults.details.to_add_total || analysisResults.details.to_add.length})
                </h5>
                <div className={styles.itemList}>
                  {renderPaginatedList(
                    analysisResults.details.all_items_to_add || analysisResults.details.to_add,
                    "items-add",
                    (item) => (
                      <div className={styles.item}>
                        {item.name ||
                          item.title ||
                          item.artists ||
                          (item.id ? `${item.artists} - ${item.title}` : JSON.stringify(item))}
                      </div>
                    ),
                    analysisResults.details.to_add_total
                  )}
                </div>
              </div>
            )}

            {analysisResults.details.to_update && analysisResults.details.to_update.length > 0 && (
              <div className={styles.sampleChanges}>
                <h5>
                  Items to Update (
                  {analysisResults.details.to_update_total ||
                    analysisResults.details.to_update.length}
                  )
                </h5>
                <div className={styles.itemList}>
                  {renderPaginatedList(
                    analysisResults.details.all_items_to_update ||
                      analysisResults.details.to_update,
                    "items-update",
                    (item) => (
                      <div className={styles.item}>
                        {item.old_name || item.old_title || item.old_artists ? (
                          <>
                            {item.old_name ||
                              item.old_title ||
                              (item.old_artists && `${item.old_artists} - ${item.old_title}`)}
                            {" → "}
                            {item.name ||
                              item.title ||
                              (item.artists && `${item.artists} - ${item.title}`)}
                          </>
                        ) : (
                          item.name || item.title || item.artists || JSON.stringify(item)
                        )}
                      </div>
                    ),
                    analysisResults.details.to_update_total
                  )}
                </div>
              </div>
            )}

            {/* For embeddingTrackMetadata - show files */}
            {analysisResults.details.files_to_process && (
              <div className={styles.sampleChanges}>
                <h5>Files to Process ({analysisResults.details.files_to_process.length})</h5>
                <div className={styles.itemList}>
                  {renderPaginatedList(
                    analysisResults.details.files_to_process,
                    "files-process",
                    (file) => (
                      <div className={styles.item}>{file.name || file}</div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* For generating M3U playlists */}
            {analysisResults.details.playlists && (
              <div className={styles.sampleChanges}>
                <h5>Playlists to Generate ({analysisResults.details.playlists.length})</h5>
                <div className={styles.itemList}>
                  {renderPaginatedList(
                    analysisResults.details.playlists,
                    "m3u-playlists",
                    (playlist) => (
                      <div className={styles.item}>
                        {playlist.name} ({playlist.track_count} tracks)
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* For association changes */}
            {analysisResults.details.all_changes ||
            analysisResults.details.samples ||
            (analysisResults.details.tracks_with_changes &&
              analysisResults.details.tracks_with_changes.length > 0) ? (
              <div className={styles.sampleChanges}>
                <h5>
                  Track Association Changes ({analysisResults.details.associations_to_add || 0} to
                  add, {analysisResults.details.associations_to_remove || 0} to remove)
                </h5>
                <div className={styles.trackList}>
                  {renderPaginatedList(
                    analysisResults.details.all_changes ||
                      analysisResults.details.samples ||
                      analysisResults.details.tracks_with_changes ||
                      [],
                    "associations-specific",
                    (item) => (
                      <div className={styles.trackItem}>
                        <div className={styles.trackItemHeader}>
                          <strong>{item.track_info || item.track}</strong>
                        </div>
                        {item.add_to && item.add_to.length > 0 && (
                          <div className={styles.addTo}>
                            <span className={styles.changeIcon}>+</span> Adding to playlists:{" "}
                            {item.add_to.join(", ")}
                          </div>
                        )}
                        {item.remove_from && item.remove_from.length > 0 && (
                          <div className={styles.removeFrom}>
                            <span className={styles.changeIcon}>-</span> Removing from playlists:{" "}
                            {item.remove_from.join(", ")}
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* For sync-to-master */}
        {analysisResults.master_sync && (
          <div className={styles.masterSyncAnalysis}>
            <h4>Sync to MASTER Playlist</h4>
            <p>
              {analysisResults.master_sync.total_tracks_to_add} tracks to add from{" "}
              {analysisResults.master_sync.playlists_with_new_tracks} playlists
            </p>

            {analysisResults.master_sync.playlists && (
              <div className={styles.sampleChanges}>
                <h5>Tracks by Playlist</h5>
                <div className={styles.accordion}>
                  {analysisResults.master_sync.playlists.map(
                    (
                      playlist: {
                        name:
                          | string
                          | number
                          | bigint
                          | boolean
                          | React.ReactElement<unknown, string | React.JSXElementConstructor<any>>
                          | Iterable<React.ReactNode>
                          | React.ReactPortal
                          | Promise<
                              | string
                              | number
                              | bigint
                              | boolean
                              | React.ReactPortal
                              | React.ReactElement<
                                  unknown,
                                  string | React.JSXElementConstructor<any>
                                >
                              | Iterable<React.ReactNode>
                              | null
                              | undefined
                            >
                          | null
                          | undefined;
                        track_count:
                          | string
                          | number
                          | bigint
                          | boolean
                          | React.ReactElement<unknown, string | React.JSXElementConstructor<any>>
                          | Iterable<React.ReactNode>
                          | Promise<
                              | string
                              | number
                              | bigint
                              | boolean
                              | React.ReactPortal
                              | React.ReactElement<
                                  unknown,
                                  string | React.JSXElementConstructor<any>
                                >
                              | Iterable<React.ReactNode>
                              | null
                              | undefined
                            >
                          | null
                          | undefined;
                        tracks: any[];
                      },
                      i: React.Key | null | undefined
                    ) => (
                      <div key={i} className={styles.accordionItem}>
                        <div
                          className={styles.accordionHeader}
                          onClick={() => toggleAccordion(`playlist-${i}`)}
                        >
                          {playlist.name} ({playlist.track_count} tracks)
                          <span
                            className={
                              expandedSections[`playlist-${i}`]
                                ? styles.accordionExpanded
                                : styles.accordionCollapsed
                            }
                          >
                            {expandedSections[`playlist-${i}`] ? "▼" : "►"}
                          </span>
                        </div>

                        {expandedSections[`playlist-${i}`] && (
                          <div className={styles.accordionContent}>
                            {renderPaginatedList(
                              playlist.tracks,
                              `playlist-tracks-${i}`,
                              (track) => (
                                <div className={styles.trackItem}>
                                  {track.artists} - {track.name}
                                </div>
                              ),
                              Number(playlist.track_count)
                            )}
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={styles.confirmationButtons}>
          <button className={styles.confirmButton} onClick={confirmAction}>
            Confirm
          </button>
          <button className={styles.cancelButton} onClick={cancelAction}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  // Helper function to render paginated lists with "Load More" button
  const renderPaginatedList = (
    items: any[],
    sectionKey: string,
    renderItem: (item: any) => React.ReactNode,
    totalItems?: number
  ) => {
    const { page, pageSize } = getPagination(sectionKey);
    const displayItems = items.slice(0, page * pageSize);
    const hasMore = totalItems
      ? displayItems.length < totalItems
      : displayItems.length < items.length;

    return (
      <>
        {displayItems.map((item, index) => (
          <React.Fragment key={index}>{renderItem(item)}</React.Fragment>
        ))}

        {hasMore && (
          <div className={styles.loadMoreContainer}>
            <button className={styles.loadMoreButton} onClick={() => loadMoreItems(sectionKey)}>
              Load More ({displayItems.length} of {totalItems || items.length})
            </button>
          </div>
        )}
      </>
    );
  };

  // State for accordion sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleAccordion = (sectionKey: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  return (
    <div className={styles.container}>
      <h2>Tagify Python Actions</h2>

      <div className={styles.statusIndicator}>
        {serverStatus === "connected" && (
          <div className={styles.connected}>
            <span className={styles.statusDot}></span>
            Connected to server
          </div>
        )}
        {serverStatus === "disconnected" && (
          <div className={styles.disconnected}>
            <span className={styles.statusDot}></span>
            Not connected to server
          </div>
        )}
        {serverStatus === "unknown" && (
          <div className={styles.unknown}>
            <span className={styles.statusDot}></span>
            Checking server status...
          </div>
        )}
      </div>

      <div className={styles.settings}>
        <h3>Settings</h3>
        <div className={styles.formGroup}>
          <label>Server URL</label>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:8765"
          />
        </div>
        <div className={styles.formGroup}>
          <label>Master Tracks Directory</label>
          <input
            type="text"
            value={paths.masterTracksDir}
            onChange={(e) => setPaths({ ...paths, masterTracksDir: e.target.value })}
            placeholder="Path to your music files"
          />
        </div>
        <div className={styles.formGroup}>
          <label>Playlists Directory</label>
          <input
            type="text"
            value={paths.playlistsDir}
            onChange={(e) => setPaths({ ...paths, playlistsDir: e.target.value })}
            placeholder="Path for M3U playlists"
          />
        </div>
        <div className={styles.formGroup}>
          <label>MASTER Playlist ID</label>
          <input
            type="text"
            value={masterPlaylistId}
            onChange={(e) => setMasterPlaylistId(e.target.value)}
            placeholder="Spotify ID of your MASTER playlist"
          />
        </div>
        <ActionButton label="Save Settings" onClick={saveSettings} />
      </div>

      <div className={styles.actions}>
        <h3>Actions</h3>

        <div className={styles.actionGroup}>
          <h4>File Management</h4>
          <div className={styles.actionButtons}>
            <ActionButton
              label="Embed Track Metadata"
              onClick={() => performAction("embed-metadata")}
              disabled={isLoading["embed-metadata"] || serverStatus !== "connected"}
            />
            <ActionButton
              label="Generate M3U Playlists"
              onClick={() =>
                performAction("generate-m3u", {
                  extended: true,
                  overwrite: true,
                  onlyChanged: true,
                })
              }
              disabled={isLoading["generate-m3u"] || serverStatus !== "connected"}
            />
            <ActionButton
              label="Validate Tracks"
              onClick={() => performAction("validate-tracks")}
              disabled={isLoading["validate-tracks"] || serverStatus !== "connected"}
            />
          </div>
        </div>

        <div className={styles.actionGroup}>
          <h4>Database Management</h4>
          <div className={styles.actionButtons}>
            <ActionButton
              label="Sync All Database"
              onClick={() =>
                performAction("sync-database", {
                  action: "all",
                  force_refresh: false,
                  master_playlist_id: masterPlaylistId,
                })
              }
              disabled={isLoading["sync-database"] || serverStatus !== "connected"}
            />
            <ActionButton
              label="Force Full Refresh"
              onClick={() =>
                performAction("sync-database", {
                  action: "all",
                  force_refresh: true,
                  master_playlist_id: masterPlaylistId,
                })
              }
              disabled={isLoading["sync-database"] || serverStatus !== "connected"}
            />
            <ActionButton
              label="Clear Database"
              onClick={() => performAction("sync-database", { action: "clear" })}
              disabled={isLoading["sync-database"] || serverStatus !== "connected"}
              className={styles.dangerButton}
            />
            <ActionButton
              label="Sync Playlists Only"
              onClick={() =>
                performAction("sync-database", {
                  action: "playlists",
                  force_refresh: false,
                })
              }
              disabled={isLoading["sync-database"] || serverStatus !== "connected"}
            />
            <ActionButton
              label="Sync Tracks Only"
              onClick={() =>
                performAction("sync-database", {
                  action: "tracks",
                  force_refresh: false,
                  master_playlist_id: masterPlaylistId,
                })
              }
              disabled={isLoading["sync-database"] || serverStatus !== "connected"}
            />
            <ActionButton
              label="Sync Associations Only"
              onClick={() =>
                performAction("sync-database", {
                  action: "associations",
                  force_refresh: false,
                  master_playlist_id: masterPlaylistId,
                })
              }
              disabled={isLoading["sync-database"] || serverStatus !== "connected"}
            />
          </div>
        </div>

        <div className={styles.actionGroup}>
          <h4>Spotify Integration</h4>
          <div className={styles.actionButtons}>
            <ActionButton
              label="Sync All Playlists to MASTER"
              onClick={() => performAction("sync-to-master")}
              disabled={
                isLoading["sync-to-master"] || serverStatus !== "connected" || !masterPlaylistId
              }
            />
          </div>
          {isLoading["sync-to-master"] && (
            <p className={styles.warning}>
              Sync to MASTER playlist is running. This operation will continue in the background.
            </p>
          )}
        </div>

        <div className={styles.actionGroup}>
          <h4>Validation & Correction</h4>
          <div className={styles.actionButtons}>
            <ActionButton
              label="Validate Track Metadata"
              onClick={openTrackValidation}
              disabled={serverStatus !== "connected"}
            />
            <ActionButton
              label="Validate Playlists"
              onClick={openPlaylistValidation}
              disabled={serverStatus !== "connected"}
            />
          </div>
        </div>
      </div>

      {renderConfirmation()}

      {/* Results display */}
      <div className={styles.results}>
        {Object.entries(results).map(
          ([action, result]) =>
            result && (
              <div
                key={action}
                className={`${styles.result} ${result.success ? styles.success : styles.error}`}
              >
                <h4>{action.replace(/-/g, " ")}</h4>
                <p>{result.message}</p>
              </div>
            )
        )}
      </div>

      {showValidationPanel && (
        <ValidationPanel
          serverUrl={serverUrl}
          masterTracksDir={paths.masterTracksDir}
          playlistsDir={paths.playlistsDir}
          onClose={() => setShowValidationPanel(false)}
        />
      )}
    </div>
  );
};

export default PythonActionsPanel;
