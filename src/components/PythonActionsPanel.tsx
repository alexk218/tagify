import React, { useState, useEffect } from "react";
import styles from "./PythonActionsPanel.module.css";
import "../styles/globals.css";
import ValidationPanel from "./ValidationPanel";
import Portal from "../utils/Portal";
import { useLocalStorage } from "../hooks/useLocalStorage";

interface SyncStats {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

interface BaseSyncDetails {
  operation_type: "playlists" | "tracks" | "associations" | "all" | "clear";
  items_to_add: any[];
  items_to_update: any[];
  items_to_delete: any[];
  preview_limit: number;
  total_items_to_add: number;
  total_items_to_update: number;
  total_items_to_delete: number;
}

interface PlaylistSyncDetails extends BaseSyncDetails {
  operation_type: "playlists";
}

interface TrackSyncDetails extends BaseSyncDetails {
  operation_type: "tracks";
}

interface AssociationSyncDetails extends BaseSyncDetails {
  operation_type: "associations";
  tracks_with_changes: any[];
  changed_playlists: any[];
  associations_to_add: number;
  associations_to_remove: number;
}

type SyncDetails =
  | PlaylistSyncDetails
  | TrackSyncDetails
  | AssociationSyncDetails
  | BaseSyncDetails;

interface SyncResponse {
  success: boolean;
  action: "playlists" | "tracks" | "associations" | "all" | "clear";
  stage:
    | "analysis"
    | "sync_complete"
    | "start"
    | "playlists"
    | "tracks"
    | "associations"
    | "complete";
  message: string;
  stats: SyncStats;
  details: SyncDetails;
  needs_confirmation: boolean;
  next_stage?: "playlists" | "tracks" | "associations" | "complete" | null;
}

function isPlaylistSyncDetails(details: SyncDetails): details is PlaylistSyncDetails {
  return details.operation_type === "playlists";
}

function isTrackSyncDetails(details: SyncDetails): details is TrackSyncDetails {
  return details.operation_type === "tracks";
}

function isAssociationSyncDetails(details: SyncDetails): details is AssociationSyncDetails {
  return details.operation_type === "associations";
}

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

type ActionInfo = {
  name: string;
  data: any;
} & (
  | { name: "sequential-sync"; data: { stage: string; details?: any } }
  | { name: "sync-database"; data: any }
  | { name: "sync-to-master"; data: any }
  | { name: string; data: any }
);

type Match = {
  track_id: string;
  artist: string;
  title: string;
  album: string;
  ratio: number;
  confidence: number;
  is_local: boolean;
};

interface FileMappingSelection {
  file_path: string;
  uri: string;
  confidence: number;
  file_name: string;
}

interface FileMappingResult {
  filename: string;
  uri: string;
  success: boolean;
  confidence?: number;
  source?: string;
  reason?: string;
  track_info?: string;
}

interface FileMappingResponse {
  success: boolean;
  stage: string;
  message: string;
  successful_mappings: number;
  failed_mappings: number;
  results: FileMappingResult[];
  total_processed: number;
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

// TODO: implement confirmation panel for master sync analysis
interface MasterSyncAnalysis {
  total_tracks_to_add: number;
  playlists_with_new_tracks: number;
  playlists: PlaylistItem[];
  needs_confirmation: boolean;
}

interface TrackItem {
  id: string;
  artists: string;
  title: string;
  album: string;
  is_local?: boolean;
  old_artists?: string;
  old_title?: string;
  old_album?: string;
  changes?: string[];
  added_at?: string;
}

interface PlaylistItem {
  id: string;
  name: string;
  old_name?: string;
  snapshot_id?: string;
  old_snapshot_id?: string;
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
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({
    "server-connect": false,
    "sequential-sync": false,
    "sequential-playlists": false,
    "sequential-tracks": false,
    "sequential-associations": false,
    "create-file-mappings": false,
  });
  const [results, setResults] = useState<
    Record<string, { success: boolean; message: string } | null>
  >({});

  const [serverStatus, setServerStatus] = useState<"unknown" | "connected" | "disconnected">(
    "unknown"
  );

  const [validationType, setValidationType] = useState<"track" | "playlist" | "short-tracks">(
    "track"
  );
  const [userMatchSelections, setUserMatchSelections] = useState<
    (MatchSelection | FileMappingSelection)[]
  >([]);
  const [autoMatchedPage, setAutoMatchedPage] = useState(1);
  const autoMatchedPerPage = 20;
  const [rejectedAutoMatches, setRejectedAutoMatches] = useState<string[]>([]);

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
  const [mappingResults, setMappingResults] = useState<FileMappingResponse | null>(null);
  const [showMappingResults, setShowMappingResults] = useState(false);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Match[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showSearchResults, setShowSearchResults] = useState<boolean>(false);
  const [fileMappingConfidenceThreshold, setFileMappingConfidenceThreshold] =
    useState<number>(0.75);
  const [analysisConfidenceThreshold, setAnalysisConfidenceThreshold] = useState<number>(0.75);

  const [showFileMappingPanel, setShowFileMappingPanel] = useState(false);
  const [autoMatchResults, setAutoMatchResults] = useState<AnalysisResultsFileMapping | null>(null);
  const [allUnmappedFiles, setAllUnmappedFiles] = useState<FileToProcess[]>([]);

  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);
  const [settings, setSettings] = useState({
    serverUrl: localStorage.getItem("tagify:localServerUrl") || "http://localhost:8765",
    masterTracksDir: localStorage.getItem("tagify:masterTracksDir") || "",
    playlistsDir: localStorage.getItem("tagify:playlistsDir") || "",
    masterPlaylistId: localStorage.getItem("tagify:masterPlaylistId") || "",
    minTrackLengthMinutes: Number(localStorage.getItem("tagify:minTrackLengthMinutes") || "5"),
    rekordboxXmlPath: localStorage.getItem("tagify:rekordboxXmlPath") || "",
  });

  const [matchPage, setMatchPage] = useState(1);
  const [autoMatchPage, setAutoMatchPage] = useState(1);
  const [skippedPage, setSkippedPage] = useState(1);
  const itemsPerPage = 20;

  const getPagedItems = <T,>(items: T[], page: number, perPage: number): T[] => {
    const startIndex = (page - 1) * perPage;
    return items.slice(startIndex, startIndex + perPage);
  };

  const [analysisResults, setAnalysisResults] = useState<AnalysisResultsFileMapping | null>(null);
  const [syncResponse, setSyncResponse] = useState<SyncResponse | null>(null);
  const [isAwaitingConfirmation, setIsAwaitingConfirmation] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionInfo | null>(null);
  const [paginationState, setPaginationState] = useState<
    Record<string, { page: number; pageSize: number }>
  >({});

  const [showSyncOptionsPopup, setShowSyncOptionsPopup] = useState<boolean>(false);
  const [pendingSyncAction, setPendingSyncAction] = useState<{
    action: string;
    data: any;
  } | null>(null);

  const [activeValidationRequests, setActiveValidationRequests] = useState<Set<string>>(new Set());

  const [validationResults, setValidationResults] = useLocalStorage<{
    track: any | null;
    playlist: any | null;
    "short-tracks": any | null;
  }>("tagify:validationResults", {
    track: null,
    playlist: null,
    "short-tracks": null,
  });

  const [validationTimestamps, setValidationTimestamps] = useLocalStorage<{
    track: number | null;
    playlist: number | null;
    "short-tracks": any | null;
  }>("tagify:validationTimestamps", {
    track: null,
    playlist: null,
    "short-tracks": null,
  });

  const [sequentialSyncState, setSequentialSyncState] = useState<{
    isActive: boolean;
    currentStage: string;
    completedStages: string[];
    totalStages: string[];
    startTime: number | null;
  }>({
    isActive: false,
    currentStage: "",
    completedStages: [],
    totalStages: ["playlists", "tracks", "associations"],
    startTime: null,
  });

  // Check server connection on load and when serverUrl changes
  useEffect(() => {
    checkServerConnection();
  }, [settings.serverUrl]);

  const checkServerConnection = async () => {
    try {
      setIsLoading((prev) => ({ ...prev, "server-connect": true }));

      // Get server URL from localStorage
      const serverUrl =
        settings.serverUrl ||
        localStorage.getItem("tagify:localServerUrl") ||
        "http://localhost:8765";

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
          // Apply environment variables to settings if they don't already have values
          const updatedSettings = { ...settings };
          let needsUpdate = false;

          if (data.env_vars.MASTER_TRACKS_DIRECTORY_SSD && !settings.masterTracksDir) {
            updatedSettings.masterTracksDir = data.env_vars.MASTER_TRACKS_DIRECTORY_SSD;
            needsUpdate = true;
          }

          if (data.env_vars.MASTER_PLAYLIST_ID && !settings.masterPlaylistId) {
            updatedSettings.masterPlaylistId = data.env_vars.MASTER_PLAYLIST_ID;
            localStorage.setItem("tagify:masterPlaylistId", data.env_vars.MASTER_PLAYLIST_ID);
            needsUpdate = true;
          }

          // Only update state if changes were made
          if (needsUpdate) {
            setSettings(updatedSettings);
          }
        }
      } else {
        setServerStatus("disconnected");
        Spicetify.showNotification("Failed to connect to server", true);
      }
    } catch (err) {
      console.error("Error connecting to server:", err);
      setServerStatus("disconnected");
      Spicetify.showNotification("Error connecting to server", true);
    } finally {
      setIsLoading((prev) => ({ ...prev, "server-connect": false }));
    }
  };

  const saveSettings = () => {
    localStorage.setItem("tagify:localServerUrl", settings.serverUrl);
    localStorage.setItem("tagify:masterTracksDir", settings.masterTracksDir);
    localStorage.setItem("tagify:playlistsDir", settings.playlistsDir);
    localStorage.setItem("tagify:masterPlaylistId", settings.masterPlaylistId);
    localStorage.setItem("tagify:minTrackLengthMinutes", settings.minTrackLengthMinutes.toString());
    localStorage.setItem("tagify:rekordboxXmlPath", settings.rekordboxXmlPath);

    checkServerConnection();

    Spicetify.showNotification("Settings saved successfully");

    setSettingsVisible(false);
  };

  const handleDatabaseAction = (action: string, baseData: any) => {
    // Store the action and data for later execution
    setPendingSyncAction({
      action,
      data: baseData,
    });
    setShowSyncOptionsPopup(true);
  };

  const executeSyncAction = (forceRefresh: boolean) => {
    if (!pendingSyncAction) return;

    performAction(pendingSyncAction.action, {
      ...pendingSyncAction.data,
      force_refresh: forceRefresh,
    });

    // Clean up state
    setShowSyncOptionsPopup(false);
    setPendingSyncAction(null);
  };

  const executeNormalSync = () => {
    executeSyncAction(false); // Use cached data when possible
  };

  const executeForceRefreshSync = () => {
    executeSyncAction(true); // Ignore cached data and fetch fresh
  };

  const cancelSyncAction = () => {
    setShowSyncOptionsPopup(false);
    setPendingSyncAction(null);
  };

  const getPlaylistSettings = () => {
    try {
      const settingsString = localStorage.getItem("tagify:playlistSettings");

      if (settingsString) {
        const settings = JSON.parse(settingsString);
        return settings;
      }
    } catch (error) {
      console.error("Error parsing playlist settings:", error);
    }

    // Default settings if none found
    const defaultSettings = {
      excludeNonOwnedPlaylists: true,
      excludedKeywords: ["Daylist", "Unchartify", "Discover Weekly", "Release Radar"],
      excludedPlaylistIds: [],
      excludeByDescription: ["ignore"],
    };

    console.log("Using default playlist settings:", defaultSettings);
    return defaultSettings;
  };

  const getNonRejectedAutoMatches = () => {
    if (!autoMatchResults?.details?.auto_matched_files) return [];

    return autoMatchResults.details.auto_matched_files.filter(
      (match: any) => !rejectedAutoMatches.includes(match.file_path)
    );
  };

  const fetchAllUnmappedFiles = async () => {
    setIsLoading((prev) => ({ ...prev, "fetch-unmapped-files": true }));

    try {
      const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");

      const requestData = {
        masterTracksDir: cleanMasterTracksDir,
        confidence_threshold: 0.0, // Set to 0 to get ALL files without mappings
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

      // Combine all files that need mapping (both auto-matched and requiring user input)
      const allFiles = [
        ...(result.details.auto_matched_files || []).map((file: any) => ({
          file_path: file.file_path,
          file_name: file.fileName || file.file_name,
        })),
        ...(result.details.files_requiring_user_input || []),
      ];

      setAllUnmappedFiles(allFiles);

      // Also set analysisResults for compatibility with existing manual matching logic
      setAnalysisResults({
        ...result,
        details: {
          ...result.details,
          files_requiring_user_input: allFiles, // Use all files for manual matching
        },
      });
    } catch (error) {
      console.error("Error fetching unmapped files:", error);
      Spicetify.showNotification(`Failed to fetch unmapped files: ${error}`, true);
    } finally {
      setIsLoading((prev) => ({ ...prev, "fetch-unmapped-files": false }));
    }
  };

  const handleMapFilesToTracksClick = () => {
    setShowFileMappingPanel(true);
    setCurrentAction({
      name: "create-file-mappings",
      data: {
        confidence_threshold: fileMappingConfidenceThreshold,
      },
    });
    setIsAwaitingConfirmation(true);

    // Immediately fetch all unmapped files
    fetchAllUnmappedFiles();
  };

  const handleAutoMatchAnalysis = async () => {
    setIsLoading((prev) => ({ ...prev, "auto-match-analysis": true }));

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
      setAutoMatchResults(result);

      // Store the confidence threshold used for this analysis
      setAnalysisConfidenceThreshold(fileMappingConfidenceThreshold);

      // Show notification about analysis completion
      Spicetify.showNotification(
        `Auto-match analysis complete: ${
          result.details.auto_matched_files?.length || 0
        } files can be auto-matched`
      );
    } catch (error) {
      console.error("Error in auto-match analysis:", error);
      Spicetify.showNotification(`Auto-match analysis failed: ${error}`, true);
    } finally {
      setIsLoading((prev) => ({ ...prev, "auto-match-analysis": false }));
    }
  };

  const performAction = async (action: string, data: any = {}) => {
    if (action === "sync-database" && data.action === "all") {
      await startSequentialSync();
      return;
    }

    setIsLoading((prev) => ({ ...prev, [action]: true }));
    setResults((prev) => ({ ...prev, [action]: null }));

    try {
      // Clean up paths before sending
      const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");
      const cleanPlaylistsDir = settings.playlistsDir.replace(/^["'](.*)["']$/, "$1");

      const playlistSettings = getPlaylistSettings();

      // Add paths and playlist settings to the data
      const requestData = {
        ...data,
        masterTracksDir: cleanMasterTracksDir,
        playlistsDir: cleanPlaylistsDir,
        master_playlist_id: settings.masterPlaylistId,
        playlistSettings: playlistSettings,
      };

      // Map old action names to new API endpoints
      const endpointMap: Record<string, { url: string; method: string }> = {
        "create-file-mappings": { url: "/api/tracks/mapping", method: "POST" },
        "sync-database": { url: "/api/sync/database", method: "POST" },
        "sync-to-master": { url: "/api/sync/master", method: "POST" },
        "generate-m3u": { url: "/api/playlists/generate", method: "POST" },
        "validate-tracks": { url: "/api/validation/tracks", method: "GET" },
        "validate-playlists": { url: "/api/validation/playlists", method: "GET" },
        "validate-track-metadata": { url: "/api/validation/track-metadata", method: "GET" },
        "generate-rekordbox-xml": { url: "/api/rekordbox/generate-xml", method: "POST" },
        "regenerate-playlist": {
          url: "/api/playlists/" + requestData.playlist_id + "/regenerate",
          method: "POST",
        },
        "direct-tracks-compare": { url: "/api/tracks/compare", method: "GET" },
        "fuzzy-match-track": { url: "/api/tracks/match", method: "POST" },
        "search-tracks": { url: "/api/tracks/search", method: "GET" },
        "correct-track-id": { url: "/api/tracks/metadata", method: "PUT" },
        "remove-track-id": { url: "/api/tracks/metadata", method: "DELETE" },
        "delete-file": { url: "/api/tracks", method: "DELETE" },
      };

      // Get the endpoint info for this action
      const endpoint = endpointMap[action] || { url: `/api/${action}`, method: "POST" };
      let url = settings.serverUrl.replace(/^["'](.*)["']$/, "$1") + endpoint.url;

      // For GET requests, convert request data to query parameters
      const fetchOptions: RequestInit = {
        method: endpoint.method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      };

      if (endpoint.method === "GET") {
        // Convert request data to query parameters
        const params = new URLSearchParams();
        Object.entries(requestData).forEach(([key, value]) => {
          if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          ) {
            params.append(key, String(value));
          }
        });

        // Append query parameters to URL
        url += `?${params.toString()}`;
      } else {
        // For non-GET requests, include the data in the request body
        fetchOptions.body = JSON.stringify(requestData);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      // Handle sync database operations (use new SyncResponse structure)
      if (action === "sync-database" || action === "sync-to-master") {
        const syncResponse: SyncResponse = result;

        // Check if this needs confirmation (analysis stage)
        if (syncResponse.needs_confirmation && !data.confirmed) {
          setSyncResponse(syncResponse);
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
            [action]: {
              success: syncResponse.success,
              message: syncResponse.message || JSON.stringify(syncResponse),
            },
          }));

          // Show notification
          if (syncResponse.success) {
            Spicetify.showNotification(`Success: ${syncResponse.message || action + " completed"}`);
          } else {
            Spicetify.showNotification(`Error: ${syncResponse.message || "Unknown error"}`, true);
          }
        }
      } else if (action === "create-file-mappings") {
        const analysisResponse: AnalysisResultsFileMapping = result;

        // Check if this requires user selection (analysis stage)
        if (
          analysisResponse.needs_confirmation &&
          analysisResponse.requires_user_selection &&
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
            `Found ${result.details.files_requiring_user_input.length} files requiring user input.`
          );
        }
        // For operations that need confirmation but no user selection
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
        // Regular result - process normally (execution phase complete)
        else {
          setResults((prev) => ({
            ...prev,
            [action]: {
              success: result.success,
              message: result.message || JSON.stringify(result),
            },
          }));

          // Show notification
          if (result.success) {
            Spicetify.showNotification(`Success: ${result.message || action + " completed"}`);
          } else {
            Spicetify.showNotification(`Error: ${result.message || "Unknown error"}`, true);
          }
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

  const startSequentialSync = async () => {
    // Initialize the sequential process
    setSequentialSyncState({
      isActive: true,
      currentStage: "initializing",
      completedStages: [],
      totalStages: ["playlists", "tracks", "associations"],
      startTime: Date.now(),
    });

    const playlistSettings = getPlaylistSettings();

    // Start the process - first API call just returns instructions
    try {
      const response = await fetch(`${settings.serverUrl}/api/sync/database`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "all",
          stage: "start",
          force_refresh: false,
          master_playlist_id: settings.masterPlaylistId,
          playlistSettings: playlistSettings,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      // Start the first stage (should be 'playlists')
      if (result.success && result.next_stage) {
        await processSequentialStage(result.next_stage);
      }
    } catch (err) {
      console.error("Error starting sequential sync:", err);
      Spicetify.showNotification(`Error: ${err || String(err)}`, true);
      setSequentialSyncState({
        isActive: false,
        currentStage: "",
        completedStages: [],
        totalStages: ["playlists", "tracks", "associations"],
        startTime: null,
      });
    }
  };

  const processSequentialStage = async (stage: string) => {
    setSequentialSyncState((prev) => ({
      ...prev,
      currentStage: stage,
    }));

    setIsLoading((prev) => ({ ...prev, [`sync-${stage}`]: true }));

    const playlistSettings = getPlaylistSettings();

    try {
      // First analyze this stage
      const analyzeResponse = await fetch(`${settings.serverUrl}/api/sync/database`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "all",
          stage: stage,
          force_refresh: false,
          confirmed: false,
          master_playlist_id: settings.masterPlaylistId,
          playlistSettings: playlistSettings,
        }),
      });

      if (!analyzeResponse.ok) {
        throw new Error(`HTTP error ${analyzeResponse.status}: ${analyzeResponse.statusText}`);
      }

      const analysisResult = await analyzeResponse.json();

      // If changes need confirmation, show confirmation UI
      if (analysisResult.needs_confirmation) {
        // TODO: set analysis results?
        setAnalysisResults(analysisResult);
        setSyncResponse(analysisResult);
        setIsAwaitingConfirmation(true);
        setCurrentAction({
          name: "sequential-sync",
          data: { stage },
        });
      }
      // If no changes or confirmation not needed, proceed to next stage
      else {
        await proceedToNextStage(analysisResult);
      }
    } catch (err) {
      console.error(`Error processing stage ${stage}:`, err);
      Spicetify.showNotification(`Error: ${err || String(err)}`, true);

      setSequentialSyncState({
        isActive: false,
        currentStage: "",
        completedStages: [],
        totalStages: ["playlists", "tracks", "associations"],
        startTime: null,
      });
    } finally {
      setIsLoading((prev) => ({ ...prev, [`sync-${stage}`]: false }));
    }
  };

  const proceedToNextStage = async (result: any) => {
    const nextStage = result.next_stage;

    // If no changes were needed, move directly to next stage
    if (nextStage && nextStage !== "complete") {
      await processSequentialStage(nextStage);
    }
    // If we're done with all stages
    else if (nextStage === "complete") {
      Spicetify.showNotification("Database sync completed successfully");
    }
  };

  // Handle confirmation
  const confirmAction = async () => {
    if (!currentAction) return;

    const { name, data } = currentAction;

    // Handle sequential sync confirmations (uses syncResponse)
    if (name === "sequential-sync" && data.stage && syncResponse) {
      const stage = data.stage;

      // Clear the confirmation UI
      setSyncResponse(null);
      setIsAwaitingConfirmation(false);
      setCurrentAction(null);

      try {
        const playlistSettings = getPlaylistSettings();
        const url = `${settings.serverUrl}/api/sync/database`;

        // Apply the changes with confirmation
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            action: "all",
            stage: stage,
            force_refresh: false,
            confirmed: true,
            precomputed_changes_from_analysis: syncResponse,
            master_playlist_id: settings.masterPlaylistId,
            playlistSettings: playlistSettings,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }

        const result: SyncResponse = await response.json();

        setSequentialSyncState((prev) => ({
          ...prev,
          completedStages: [...prev.completedStages, data.stage],
        }));

        // Move to the next stage
        if (result.next_stage && result.next_stage !== "complete") {
          await processSequentialStage(result.next_stage);
        } else if (result.next_stage === "complete" || result.stage === "sync_complete") {
          // Process completed
          const endTime = Date.now();
          const duration = sequentialSyncState.startTime
            ? Math.round((endTime - sequentialSyncState.startTime) / 1000)
            : 0;

          Spicetify.showNotification(`Database sync completed successfully in ${duration}s`);

          setSequentialSyncState({
            isActive: false,
            currentStage: "",
            completedStages: [],
            totalStages: ["playlists", "tracks", "associations"],
            startTime: null,
          });
        }
      } catch (err) {
        console.error(`Error applying changes for stage ${stage}:`, err);
        Spicetify.showNotification(`Error: ${err || String(err)}`, true);

        setSequentialSyncState({
          isActive: false,
          currentStage: "",
          completedStages: [],
          totalStages: ["playlists", "tracks", "associations"],
          startTime: null,
        });
      }

      return;
    }

    // Handle sync operations (uses syncResponse)
    if ((name === "sync-database" || name === "sync-to-master") && syncResponse) {
      const confirmData = {
        ...data,
        confirmed: true,
        precomputed_changes_from_analysis: syncResponse,
      };

      // Reset states
      setSyncResponse(null);
      setIsAwaitingConfirmation(false);
      setCurrentAction(null);

      // Perform the action with confirmation
      await performAction(name, confirmData);
      return;
    }

    if (name === "create-file-mappings" && analysisResults) {
      // Add confirmation flag and user selections to the data
      const confirmData = {
        ...data,
        confirmed: true,
        user_selections: userMatchSelections.map((selection: any) => ({
          file_path: selection.file_path,
          uri: selection.uri,
          confidence: selection.confidence,
          file_name: selection.file_name,
        })), // Ensure correct format for API
        precomputed_changes_from_analysis: analysisResults,
      };

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
      return;
    }

    // Handle other operations that might use analysisResults for backwards compatibility
    if (analysisResults) {
      const confirmData = {
        ...data,
        confirmed: true,
        // Include any precomputed data from analysisResults if needed
        precomputed_changes_from_analysis: analysisResults,
      };

      // Reset states
      setAnalysisResults(null);
      setIsAwaitingConfirmation(false);
      setCurrentAction(null);

      // Perform the action with confirmation
      await performAction(name, confirmData);
      return;
    }

    console.warn("confirmAction called but no valid confirmation data found");
  };

  // Cancel confirmation
  const cancelAction = () => {
    // Reset all states
    setSyncResponse(null);
    // setAnalysisResults(null);
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

  const openTrackValidation = () => {
    setValidationType("track");
  };

  const openPlaylistValidation = () => {
    setValidationType("playlist");
  };

  const fetchValidationData = async (
    type: "track" | "playlist" | "short-tracks",
    forceRefresh = false
  ) => {
    // Prevent multiple concurrent requests for the same validation type
    if (activeValidationRequests.has(type)) {
      console.log(`Validation request for ${type} already in progress, skipping`);
      return null;
    }

    // If we have data and aren't forcing a refresh, return the cached data
    if (!forceRefresh && validationResults[type]) {
      return validationResults[type];
    }

    try {
      // Mark this request as active
      setActiveValidationRequests((prev) => new Set([...prev, type]));
      setIsLoading((prev) => ({ ...prev, [`validate-${type}s`]: true }));

      let endpoint: string;
      let queryParams: URLSearchParams;

      if (type === "short-tracks") {
        endpoint = "short-tracks";
        queryParams = new URLSearchParams({
          masterTracksDir: settings.masterTracksDir,
          minLengthMinutes: settings.minTrackLengthMinutes.toString(),
        });
      } else {
        endpoint = type === "track" ? "track-metadata" : "playlists";
        queryParams = new URLSearchParams({
          masterTracksDir: settings.masterTracksDir,
          playlistsDir: settings.playlistsDir,
        });
      }

      const response = await fetch(
        `${settings.serverUrl}/api/validation/${endpoint}?${queryParams}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          // Add longer timeout for short tracks validation
          signal: AbortSignal.timeout(type === "short-tracks" ? 300000 : 60000), // 5 minutes for short tracks, 1 minute for others
        }
      );

      if (response.ok) {
        const data = await response.json();

        // Update our cached results
        setValidationResults((prev) => ({
          ...prev,
          [type]: data,
        }));

        // Update the timestamp
        setValidationTimestamps((prev) => ({
          ...prev,
          [type]: Date.now(),
        }));

        return data;
      } else {
        const error = await response.json();
        console.error(`Error fetching ${type} validation data:`, error);
        throw new Error(error.message || `Failed to validate ${type}s`);
      }
    } catch (error) {
      console.error(`Error in validation fetch: ${error}`);
      Spicetify.showNotification(`Error validating ${type}s`, true);
      throw error;
    } finally {
      // Remove from active requests
      setActiveValidationRequests((prev) => {
        const newSet = new Set(prev);
        newSet.delete(type);
        return newSet;
      });
      setIsLoading((prev) => ({ ...prev, [`validate-${type}s`]: false }));
    }
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

  const MappingResultsPanel = () => {
    if (!mappingResults || !showMappingResults) return null;

    const [successPage, setSuccessPage] = useState(1);
    const [failedPage, setFailedPage] = useState(1);
    const resultsPerPage = 20;

    const successfulMappings = mappingResults.results.filter((r) => r.success);
    const failedMappings = mappingResults.results.filter((r) => !r.success);

    const getPagedResults = (results: FileMappingResult[], page: number) => {
      const startIndex = (page - 1) * resultsPerPage;
      return results.slice(startIndex, startIndex + resultsPerPage);
    };

    const handleContinue = () => {
      setShowMappingResults(false);
      setMappingResults(null);

      // Get the current remaining files count (after successful mappings were removed)
      const remainingFiles = analysisResults?.details?.files_requiring_user_input || [];

      // If there are still files requiring user input, resume fuzzy matching
      if (remainingFiles.length > 0) {
        setFuzzyMatchingState({
          isActive: true,
          currentFileIndex: 0, // Reset to first remaining file
          matches: [],
          isLoading: false,
        });
      } else {
        // All done, reset everything
        setAnalysisResults(null);
        setIsAwaitingConfirmation(false);
        setCurrentAction(null);
        setUserMatchSelections([]);
        setSkippedFiles([]);
        setAllUnmappedFiles([]);

        Spicetify.showNotification("All files have been processed!");
      }
    };

    const handleFinish = () => {
      setShowMappingResults(false);
      setMappingResults(null);
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
    };

    return (
      <Portal>
        <div className={styles.modalOverlay}>
          <div className={styles.mappingResultsPanel}>
            <div className={styles.mappingResultsHeader}>
              <h3>File Mapping Results</h3>
              <div className={styles.resultsSummary}>
                <div className={styles.summaryStats}>
                  <span className={styles.successStat}>
                    ✓ {mappingResults.successful_mappings} Successful
                  </span>
                  <span className={styles.failedStat}>
                    ✗ {mappingResults.failed_mappings} Failed
                  </span>
                  <span className={styles.totalStat}>Total: {mappingResults.total_processed}</span>
                </div>
                <p className={styles.summaryMessage}>{mappingResults.message}</p>
              </div>
            </div>

            <div className={styles.mappingResultsContent}>
              {/* Successful Mappings Section */}
              {successfulMappings.length > 0 && (
                <div className={styles.resultSection}>
                  <h4 className={styles.sectionTitle}>
                    ✓ Successful Mappings ({successfulMappings.length})
                  </h4>
                  <div className={styles.resultsList}>
                    {getPagedResults(successfulMappings, successPage).map((result, index) => (
                      <div key={index} className={`${styles.resultItem} ${styles.successItem}`}>
                        <div className={styles.resultFileName}>{result.filename}</div>
                        <div className={styles.resultUri}>{result.uri}</div>
                        {/* Add track info display */}
                        {result.track_info && (
                          <div className={styles.resultTrackInfo}>
                            <span className={styles.trackName}>→ {result.track_info}</span>
                          </div>
                        )}
                        <div className={styles.resultMeta}>
                          {result.confidence && (
                            <span className={styles.confidence}>
                              {(result.confidence * 100).toFixed(1)}% confidence
                            </span>
                          )}
                          {result.source && (
                            <span className={styles.source}>
                              {result.source === "auto_match" ? "Auto-matched" : "User selected"}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination for successful mappings */}
                  {successfulMappings.length > resultsPerPage && (
                    <div className={styles.paginationControls}>
                      <button
                        disabled={successPage === 1}
                        onClick={() => setSuccessPage((prev) => Math.max(1, prev - 1))}
                      >
                        Previous
                      </button>
                      <span>
                        Page {successPage} of{" "}
                        {Math.ceil(successfulMappings.length / resultsPerPage)}
                      </span>
                      <button
                        disabled={
                          successPage >= Math.ceil(successfulMappings.length / resultsPerPage)
                        }
                        onClick={() => setSuccessPage((prev) => prev + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Failed Mappings Section */}
              {failedMappings.length > 0 && (
                <div className={styles.resultSection}>
                  <h4 className={styles.sectionTitle}>
                    ✗ Failed Mappings ({failedMappings.length})
                  </h4>
                  <div className={styles.resultsList}>
                    {getPagedResults(failedMappings, failedPage).map((result, index) => (
                      <div key={index} className={`${styles.resultItem} ${styles.failedItem}`}>
                        <div className={styles.resultFileName}>{result.filename}</div>
                        <div className={styles.resultUri}>{result.uri}</div>
                        {/* Add track info display for failed mappings too */}
                        {result.track_info && (
                          <div className={styles.resultTrackInfo}>
                            <span className={styles.trackName}>→ {result.track_info}</span>
                          </div>
                        )}
                        <div className={styles.resultReason}>
                          <span className={styles.errorReason}>
                            {result.reason || "Unknown error"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination for failed mappings */}
                  {failedMappings.length > resultsPerPage && (
                    <div className={styles.paginationControls}>
                      <button
                        disabled={failedPage === 1}
                        onClick={() => setFailedPage((prev) => Math.max(1, prev - 1))}
                      >
                        Previous
                      </button>
                      <span>
                        Page {failedPage} of {Math.ceil(failedMappings.length / resultsPerPage)}
                      </span>
                      <button
                        disabled={failedPage >= Math.ceil(failedMappings.length / resultsPerPage)}
                        onClick={() => setFailedPage((prev) => prev + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={styles.mappingResultsFooter}>
              {(() => {
                const remainingFiles = analysisResults?.details?.files_requiring_user_input || [];
                const remainingCount = remainingFiles.length;

                return remainingCount > 0 ? (
                  <>
                    <button className={styles.continueButton} onClick={handleContinue}>
                      Continue with Remaining Files ({remainingCount})
                    </button>
                    <button className={styles.finishButton} onClick={handleFinish}>
                      Finish
                    </button>
                  </>
                ) : (
                  <button className={styles.finishButton} onClick={handleFinish}>
                    Done - All Files Processed
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      </Portal>
    );
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setIsSearching(true);
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
        setSearchResults(data.results || []);
        setShowSearchResults(true);
      } else {
        console.error("Search failed:", response.statusText);
        setSearchResults([]);
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(searchQuery);
  };

  const FuzzyMatchConfirmation = () => {
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
      setRejectedAutoMatches((prev) => {
        if (prev.includes(filePath)) {
          return prev; // Already rejected
        }
        return [...prev, filePath];
      });

      // Add to manual matching files if not already there
      const fileForManual = {
        file_path: fileToReject.file_path,
        file_name: fileToReject.fileName || fileToReject.file_name,
      };

      setAllUnmappedFiles((prev) => {
        // Check if file is already in the list
        const exists = prev.some((f) => f.file_path === fileForManual.file_path);
        if (!exists) {
          return [...prev, fileForManual];
        }
        return prev;
      });

      Spicetify.showNotification(`Moved "${fileForManual.file_name}" to manual matching`);
    };

    const handleClearRejections = () => {
      setRejectedAutoMatches([]);
      // Remove the rejected files from manual matching list
      setAllUnmappedFiles((prev) =>
        prev.filter(
          (file) =>
            !autoMatchResults?.details?.auto_matched_files?.some(
              (autoMatch: any) => autoMatch.file_path === file.file_path
            )
        )
      );
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
          setMappingResults(result);
          setShowMappingResults(true);

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
            setAutoMatchResults(null);

            // Remove successfully mapped files from allUnmappedFiles
            setAllUnmappedFiles((prev) =>
              prev.filter((file) => !successfullyMappedFilePaths.has(file.file_path))
            );

            // Update analysisResults to remove successfully mapped files
            if (analysisResults && analysisResults.details.files_requiring_user_input) {
              setAnalysisResults((prev) => {
                if (!prev) return prev;

                return {
                  ...prev,
                  details: {
                    ...prev.details,
                    files_requiring_user_input: prev.details.files_requiring_user_input.filter(
                      (file) => !successfullyMappedFilePaths.has(file.file_path)
                    ),
                    // Update the count
                    files_without_mappings: prev.details.files_requiring_user_input.filter(
                      (file) => !successfullyMappedFilePaths.has(file.file_path)
                    ).length,
                  },
                };
              });
            }

            // Clear rejected auto-matches since they've been processed
            setRejectedAutoMatches([]);
          } else if (description.includes("manually selected")) {
            // For manual selections, clear the current selections
            setUserMatchSelections([]);

            // Remove successfully mapped files from allUnmappedFiles
            setAllUnmappedFiles((prev) =>
              prev.filter((file) => !successfullyMappedFilePaths.has(file.file_path))
            );

            // Update the analysis results to remove the files that were just processed
            if (analysisResults && analysisResults.details.files_requiring_user_input) {
              setAnalysisResults((prev) => {
                if (!prev) return prev;

                return {
                  ...prev,
                  details: {
                    ...prev.details,
                    files_requiring_user_input: prev.details.files_requiring_user_input.filter(
                      (file) => !successfullyMappedFilePaths.has(file.file_path)
                    ),
                    // Update the count
                    files_without_mappings: prev.details.files_requiring_user_input.filter(
                      (file) => !successfullyMappedFilePaths.has(file.file_path)
                    ).length,
                  },
                };
              });
            }

            // Reset fuzzy matching to first remaining file if there are any
            const remainingFiles = allUnmappedFiles.filter(
              (file) => !successfullyMappedFilePaths.has(file.file_path)
            );

            if (remainingFiles.length === 0) {
              // No more files to process
              setFuzzyMatchingState({
                isActive: false,
                currentFileIndex: 0,
                matches: [],
                isLoading: false,
              });
            } else {
              // Reset to first remaining file
              setFuzzyMatchingState((prev) => ({
                ...prev,
                currentFileIndex: 0,
                matches: [],
                isLoading: false,
              }));
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

    const handleSelectMatch = (match: any) => {
      if (isFileMapping) {
        // For file mappings - use the new format
        // Use 'ratio' for manual matches, 'confidence' for search results
        const confidence = match.ratio || match.confidence || 0;
        setUserMatchSelections((prev) => [
          ...prev,
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
      // Add file to skipped files - always use the filename string
      setSkippedFiles((prev) => [...prev, currentFileName]);

      // Move to next file
      if (fuzzyMatchingState.currentFileIndex < manualFiles.length - 1) {
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
                  onChange={(e) => setFileMappingConfidenceThreshold(Number(e.target.value))}
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
                    <button
                      className={styles.clearRejectionsButton}
                      onClick={handleClearRejections}
                    >
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
                          onClick={() => setAutoMatchedPage((prev) => Math.max(1, prev - 1))}
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
                          onClick={() => setAutoMatchedPage((prev) => prev + 1)}
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
                          onChange={(e) => setSearchQuery(e.target.value)}
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
                          <h5>Search Results ({searchResults.length})</h5>
                          <div className={styles.searchResultsList}>
                            {searchResults.map((match, index) => (
                              <div
                                key={match.track_id || index}
                                className={styles.searchResultItem}
                                onClick={() => {
                                  handleSelectMatch(match);
                                  setSearchQuery("");
                                  setSearchResults([]);
                                  setShowSearchResults(false);
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
                            setFuzzyMatchingState((prev) => ({
                              ...prev,
                              currentFileIndex: prev.currentFileIndex - 1,
                              matches: [],
                            }));
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
                        setFuzzyMatchingState({
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
          <button
            className={styles.closePanelButton}
            onClick={() => {
              setShowFileMappingPanel(false);
              setIsAwaitingConfirmation(false);
              setCurrentAction(null);
              setAutoMatchResults(null);
              setAnalysisResults(null);
              setAllUnmappedFiles([]);
              setRejectedAutoMatches([]);
              setAnalysisConfidenceThreshold(0.75);
              setFuzzyMatchingState({
                isActive: false,
                currentFileIndex: 0,
                matches: [],
                isLoading: false,
              });
              setUserMatchSelections([]);
              setSkippedFiles([]);
              setAutoMatchedPage(1);
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  };

  // Render the confirmation UI when needed
  const renderConfirmation = () => {
    if (!isAwaitingConfirmation) return null;

    if (currentAction?.name === "create-file-mappings" && showFileMappingPanel) {
      return (
        <div className={styles.confirmationPanel}>
          <FuzzyMatchConfirmation />
        </div>
      );
    }

    if (
      currentAction?.name === "create-file-mappings" &&
      analysisResults &&
      analysisResults.requires_user_selection &&
      !fuzzyMatchingState.isActive &&
      (userMatchSelections.length > 0 || skippedFiles.length > 0)
    ) {
      return (
        <div className={styles.confirmationPanel}>
          <h3>Confirm File-Track Mappings</h3>
          <div className={styles.summaryContainer}>
            <p>Ready to create file-track mappings for {userMatchSelections.length} files.</p>
            <p>{skippedFiles.length} files were skipped.</p>

            <div className={styles.selectionsContent}>
              {userMatchSelections &&
                userMatchSelections.length > 0 &&
                getPagedItems(userMatchSelections, matchPage, itemsPerPage).map(
                  (selection: any, index: number) => {
                    // Handle both formats
                    const fileName = selection.fileName || selection.file_name;
                    const trackIdentifier = selection.trackId || selection.uri;

                    return (
                      <div key={index} className={styles.selectionItem}>
                        <div className={styles.selectionFile}>{fileName}</div>
                        <div className={styles.selectionTrackId}>{trackIdentifier}</div>
                        <div className={styles.selectionConfidence}>
                          Confidence: {(selection.confidence * 100).toFixed(2)}%
                        </div>
                      </div>
                    );
                  }
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

            {/* Show auto-matched files if any */}
            {analysisResults.details?.auto_matched_files &&
              analysisResults.details.auto_matched_files.length > 0 && (
                <div className={styles.autoMatchedPreview}>
                  <h4>Auto-Matched Files ({analysisResults.details.auto_matched_files.length}):</h4>
                  <div className={styles.selectionsContent}>
                    {getPagedItems<any>(
                      Array.isArray(analysisResults.details.auto_matched_files)
                        ? analysisResults.details.auto_matched_files
                        : [],
                      autoMatchPage,
                      itemsPerPage
                    ).map((match, index: number) => (
                      <div key={index} className={styles.selectionItem}>
                        <div className={styles.selectionFile}>{match.file_name}</div>
                        <div className={styles.selectionTrackId}>{match.uri}</div>
                        <div className={styles.selectionConfidence}>
                          Confidence: {(match.confidence * 100).toFixed(2)}%
                        </div>
                      </div>
                    ))}

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

            {/* Show skipped files if any */}
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
                Create File-Track Mappings
              </button>
              <button className={styles.cancelButton} onClick={cancelAction}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (currentAction?.name === "sequential-sync" && syncResponse && syncResponse.stage) {
      return (
        <div className={styles.confirmationPanel}>
          <h3>
            Database Sync -{" "}
            {syncResponse.stage.charAt(0).toUpperCase() + syncResponse.stage.slice(1)} Stage
          </h3>

          {/* Show sequential progress indicator */}
          <div className={styles.sequentialHeader}>
            <div className={styles.sequentialProgress}>
              <span
                className={`${styles.sequentialStep} ${
                  syncResponse.stage === "playlists" ? styles.active : ""
                }`}
              >
                1. Playlists
              </span>
              <span
                className={`${styles.sequentialStep} ${
                  syncResponse.stage === "tracks" ? styles.active : ""
                }`}
              >
                2. Tracks
              </span>
              <span
                className={`${styles.sequentialStep} ${
                  syncResponse.stage === "associations" ? styles.active : ""
                }`}
              >
                3. Associations
              </span>
            </div>
          </div>

          {/* NEW: Render based on syncResponse structure */}
          <div>
            <p>
              {syncResponse.stats.added} to add, {syncResponse.stats.updated} to update,{" "}
              {syncResponse.stats.deleted} to delete, {syncResponse.stats.unchanged} unchanged
            </p>
          </div>

          {/* Render based on stage and new structure */}
          {syncResponse.stage === "playlists" && (
            <div className={styles.playlistChanges}>
              <h4>Playlist Changes</h4>

              {syncResponse.stats.added > 0 && (
                <div className={styles.changesSection}>
                  <h5>Playlists to Add ({syncResponse.stats.added})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_add || [],
                      "playlists-add",
                      (item) => (
                        <div className={styles.item}>{item.name}</div>
                      )
                    )}
                  </div>
                </div>
              )}

              {syncResponse.stats.updated > 0 && (
                <div className={styles.changesSection}>
                  <h5>Playlists to Update ({syncResponse.stats.updated})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_update || [],
                      "playlists-update",
                      (item) => (
                        <div className={styles.item}>
                          <div className={styles.playlistName}>
                            {item.old_name !== item.name ? (
                              <span>
                                {item.old_name} → {item.name}
                              </span>
                            ) : (
                              <span>{item.name}</span>
                            )}
                          </div>
                          <div className={styles.updateReasons}>
                            {item.old_name !== item.name && (
                              <span className={styles.updateReason}>Name changed</span>
                            )}
                            {item.old_snapshot_id !== item.snapshot_id && (
                              <span className={styles.updateReason}>Tracks modified</span>
                            )}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {syncResponse.stats.deleted > 0 && (
                <div className={styles.changesSection}>
                  <h5>Playlists to Delete ({syncResponse.stats.deleted})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_delete || [],
                      "playlists-delete",
                      (item) => (
                        <div className={styles.item}>{item.name}</div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {syncResponse.stage === "tracks" && (
            <div className={styles.trackChanges}>
              <h4>Track Changes</h4>

              {syncResponse.stats.added > 0 && (
                <div className={styles.changesSection}>
                  <h5>Tracks to Add ({syncResponse.stats.added})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_add || [],
                      "tracks-add",
                      (track) => (
                        <div className={styles.trackItem}>
                          {track.artists} - {track.title} {track.is_local ? "(LOCAL)" : ""}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {syncResponse.stats.updated > 0 && (
                <div className={styles.changesSection}>
                  <h5>Tracks to Update ({syncResponse.stats.updated})</h5>
                  <div className={styles.trackList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_update || [],
                      "tracks-update",
                      (track) => (
                        <div className={styles.trackItem}>
                          {track.old_artists} - {track.old_title} → {track.artists} - {track.title}
                          {track.is_local ? " (LOCAL)" : ""}
                          {track.changes && track.changes.length > 0 && (
                            <div className={styles.changeReasons}>
                              <div className={styles.changesLabel}>Changes:</div>
                              <ul className={styles.changesList}>
                                {track.changes.map((change: string, index: number) => (
                                  <li key={index} className={styles.changeItem}>
                                    {change}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {syncResponse.stats.deleted > 0 && (
                <div className={styles.changesSection}>
                  <h5>Tracks to Delete ({syncResponse.stats.deleted})</h5>
                  <div className={styles.trackList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_delete || [],
                      "tracks-delete",
                      (track) => (
                        <div className={`${styles.trackItem} ${styles.deleteItem}`}>
                          {track.artists} - {track.title} {track.is_local ? "(LOCAL)" : ""}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {syncResponse.stage === "associations" && (
            <div className={styles.associationChanges}>
              <h4>Association Changes</h4>
              {/* Cast details to AssociationSyncDetails to access tracks_with_changes */}
              {isAssociationSyncDetails(syncResponse.details) &&
                syncResponse.details.tracks_with_changes && (
                  <div className={styles.changesSection}>
                    <h5>
                      Track Association Changes ({syncResponse.details.associations_to_add} to add,{" "}
                      {syncResponse.details.associations_to_remove} to remove )
                    </h5>
                    <div className={styles.trackList}>
                      {renderPaginatedList(
                        syncResponse.details.tracks_with_changes,
                        "associations",
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
                                <span className={styles.changeIcon}>-</span> Removing from
                                playlists: {item.remove_from.join(", ")}
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
              Apply Changes and Continue
            </button>
            <button className={styles.cancelButton} onClick={cancelAction}>
              Cancel Sync Process
            </button>
          </div>
        </div>
      );
    }

    // For regular sync operations (sync-database, sync-to-master) - use syncResponse
    if (
      syncResponse &&
      (currentAction?.name === "sync-database" || currentAction?.name === "sync-to-master")
    ) {
      return (
        <div className={styles.confirmationPanel}>
          <h3>
            Confirm Changes -{" "}
            {syncResponse.action.charAt(0).toUpperCase() + syncResponse.action.slice(1)}
          </h3>

          <div className={styles.summaryStats}>
            <p>
              {syncResponse.stats.added} to add, {syncResponse.stats.updated} to update,
              {syncResponse.stats.deleted} to delete, {syncResponse.stats.unchanged} unchanged
            </p>
          </div>

          {/* Render details based on operation type */}
          {isPlaylistSyncDetails(syncResponse.details) && (
            <div className={styles.playlistChanges}>
              <h4>Playlist Changes</h4>
              {syncResponse.stats.added > 0 && (
                <div className={styles.changesSection}>
                  <h5>Playlists to Add ({syncResponse.stats.added})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_add || [],
                      "playlists-add",
                      (item) => (
                        <div className={styles.item}>{item.name}</div>
                      )
                    )}
                  </div>
                </div>
              )}

              {syncResponse.stats.updated > 0 && (
                <div className={styles.changesSection}>
                  <h5>Playlists to Update ({syncResponse.stats.updated})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_update || [],
                      "playlists-update",
                      (item) => (
                        <div className={styles.item}>
                          <div className={styles.playlistName}>
                            {item.old_name !== item.name ? (
                              <span>
                                {item.old_name} → {item.name}
                              </span>
                            ) : (
                              <span>{item.name}</span>
                            )}
                          </div>
                          <div className={styles.updateReasons}>
                            {item.old_name !== item.name && (
                              <span className={styles.updateReason}>Name changed</span>
                            )}
                            {item.old_snapshot_id !== item.snapshot_id && (
                              <span className={styles.updateReason}>Tracks modified</span>
                            )}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {isTrackSyncDetails(syncResponse.details) && (
            <div className={styles.trackChanges}>
              <h4>Track Changes</h4>
              {/* MIGHT BE FUCKED */}
              {syncResponse.stats.added > 0 && (
                <div className={styles.changesSection}>
                  <h5>Tracks to Add ({syncResponse.stats.added})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_add || [],
                      "tracks-add",
                      (track) => (
                        <div className={styles.trackItem}>
                          {track.artists} - {track.title} {track.is_local ? "(LOCAL)" : ""}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {syncResponse.stats.updated > 0 && (
                <div className={styles.changesSection}>
                  <h5>Tracks to Update ({syncResponse.stats.updated})</h5>
                  <div className={styles.trackList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_update || [],
                      "tracks-update",
                      (track) => (
                        <div className={styles.trackItem}>
                          {track.old_artists} - {track.old_title} → {track.artists} - {track.title}
                          {track.is_local ? " (LOCAL)" : ""}
                          {track.changes && track.changes.length > 0 && (
                            <div className={styles.changeReasons}>
                              <div className={styles.changesLabel}>Changes:</div>
                              <ul className={styles.changesList}>
                                {track.changes.map((change: string, index: number) => (
                                  <li key={index} className={styles.changeItem}>
                                    {change}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {syncResponse.stats.deleted > 0 && (
                <div className={styles.changesSection}>
                  <h5>Tracks to Delete ({syncResponse.stats.deleted})</h5>
                  <div className={styles.trackList}>
                    {renderPaginatedList(
                      syncResponse.details.items_to_delete || [],
                      "tracks-delete",
                      (track) => (
                        <div className={`${styles.trackItem} ${styles.deleteItem}`}>
                          {track.artists} - {track.title} {track.is_local ? "(LOCAL)" : ""}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {isAssociationSyncDetails(syncResponse.details) && (
            <div className={styles.associationChanges}>
              <h4>Association Changes</h4>
              {isAssociationSyncDetails(syncResponse.details) &&
                syncResponse.details.tracks_with_changes && (
                  <div className={styles.changesSection}>
                    <h5>
                      Track Association Changes ({syncResponse.details.associations_to_add} to add,{" "}
                      {syncResponse.details.associations_to_remove} to remove )
                    </h5>
                    <div className={styles.trackList}>
                      {renderPaginatedList(
                        syncResponse.details.tracks_with_changes,
                        "associations",
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
                                <span className={styles.changeIcon}>-</span> Removing from
                                playlists: {item.remove_from.join(", ")}
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
              Confirm Changes
            </button>
            <button className={styles.cancelButton} onClick={cancelAction}>
              Cancel
            </button>
          </div>
        </div>
      );
    }
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

  const SyncOptionsPopup = () => {
    if (!showSyncOptionsPopup || !pendingSyncAction) return null;

    const getActionDisplayName = (action: string, data: any) => {
      if (data.action === "all") return "Sync All Database";
      if (data.action === "playlists") return "Sync Playlists Only";
      if (data.action === "tracks") return "Sync Tracks Only";
      if (data.action === "associations") return "Sync Associations Only";
      if (action === "sync-to-master") return "Sync All Playlists to MASTER";
      return "Database Sync";
    };

    return (
      <Portal>
        <div className={styles.modalOverlay}>
          <div className={styles.syncOptionsPanel}>
            <div className={styles.syncOptionsHeader}>
              <h3>{getActionDisplayName(pendingSyncAction.action, pendingSyncAction.data)}</h3>
              <p>Choose how to perform this sync operation:</p>
            </div>

            <div className={styles.syncOptionsContent}>
              <div className={styles.syncOption}>
                <button
                  className={`${styles.syncOptionButton} ${styles.normalSync}`}
                  onClick={() => executeNormalSync()}
                >
                  <div className={styles.syncOptionTitle}>Normal Sync</div>
                  <div className={styles.syncOptionDescription}>
                    Use cached data when possible. Faster and recommended for regular use.
                  </div>
                </button>
              </div>

              <div className={styles.syncOption}>
                <button
                  className={`${styles.syncOptionButton} ${styles.forceSync}`}
                  onClick={() => executeForceRefreshSync()}
                >
                  <div className={styles.syncOptionTitle}>Force Full Refresh</div>
                  <div className={styles.syncOptionDescription}>
                    Ignore cached data and fetch everything fresh. Slower but ensures latest data.
                  </div>
                </button>
              </div>
            </div>

            <div className={styles.syncOptionsFooter}>
              <button className={styles.cancelButton} onClick={cancelSyncAction}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Portal>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.headerButtons}>
        <button
          className={styles.settingsButton}
          onClick={() => setSettingsVisible(true)}
          title="Settings"
        >
          ⚙️
        </button>
      </div>
      <h2>Tagify Python Actions</h2>

      <div className={styles.statusIndicator}>
        {serverStatus === "connected" ? (
          <div className={styles.connected}>
            <span className={styles.statusDot}></span>
            Connected to server
          </div>
        ) : serverStatus === "disconnected" ? (
          <div className={styles.disconnected}>
            <span className={styles.statusDot}></span>
            Not connected to server
          </div>
        ) : (
          <div className={styles.unknown}>
            <span className={styles.statusDot}></span>
            Checking server status...
          </div>
        )}

        <button
          className={`${styles.connectButton} ${
            serverStatus === "connected" ? styles.connected : styles.disconnected
          }`}
          onClick={checkServerConnection}
          disabled={isLoading["server-connect"]}
        >
          {isLoading["server-connect"] ? "Connecting..." : "Connect"}
        </button>
      </div>

      <div className={styles.headerButtons}>
        <button
          className={styles.settingsButton}
          onClick={() => setSettingsVisible(true)}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      <SyncOptionsPopup />
      <MappingResultsPanel />

      {settingsVisible && (
        <Portal>
          <div className={styles.modalOverlay}>
            <div className={styles.settingsPanel}>
              <div className={styles.settingsHeader}>
                <h3>Tagify Settings</h3>
              </div>

              <div className={styles.settingsForm}>
                <div className={styles.formGroup}>
                  <label>Server URL</label>
                  <input
                    type="text"
                    value={settings.serverUrl}
                    onChange={(e) => setSettings({ ...settings, serverUrl: e.target.value })}
                    placeholder="http://localhost:8765"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Master Tracks Directory</label>
                  <input
                    type="text"
                    value={settings.masterTracksDir}
                    onChange={(e) => setSettings({ ...settings, masterTracksDir: e.target.value })}
                    placeholder="Path to your music files"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Playlists Directory</label>
                  <input
                    type="text"
                    value={settings.playlistsDir}
                    onChange={(e) => setSettings({ ...settings, playlistsDir: e.target.value })}
                    placeholder="Path for M3U playlists"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>MASTER Playlist ID</label>
                  <input
                    type="text"
                    value={settings.masterPlaylistId}
                    onChange={(e) => setSettings({ ...settings, masterPlaylistId: e.target.value })}
                    placeholder="Spotify ID of your MASTER playlist"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>rekordbox XML Path</label>
                  <input
                    type="text"
                    value={settings.rekordboxXmlPath}
                    onChange={(e) => setSettings({ ...settings, rekordboxXmlPath: e.target.value })}
                    placeholder="Path for rekordbox XML file (with .xml extension)"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Minimum Track Length (minutes)</label>
                  <div className={styles.rangeGroup}>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="0.5"
                      value={settings.minTrackLengthMinutes}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          minTrackLengthMinutes: Number(e.target.value),
                        })
                      }
                    />
                    <span className={styles.rangeValue}>
                      {settings.minTrackLengthMinutes} minutes
                    </span>
                  </div>
                  <div className={styles.settingDescription}>
                    Tracks shorter than this length will be highlighted in the validation interface
                  </div>
                </div>

                <div className={styles.buttonGroup}>
                  <button className={styles.saveButton} onClick={saveSettings}>
                    Save Settings
                  </button>
                  <button className={styles.cancelButton} onClick={() => setSettingsVisible(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      <div className={styles.actions}>
        <h3>Actions</h3>

        <div className={styles.actionGroup}>
          <h4>File Management</h4>
          <div className={styles.actionButtons}>
            <ActionButton
              label="Map Files to Tracks"
              onClick={handleMapFilesToTracksClick}
              disabled={isLoading["create-file-mappings"] || serverStatus !== "connected"}
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
            <ActionButton
              label="Generate rekordbox XML"
              onClick={() => {
                const tagData = JSON.parse(localStorage.getItem("tagify:tagData") || "{}");
                const tracks = tagData.tracks || {};

                const ratingData: Record<string, { rating: number; energy: number }> = {};
                Object.entries(tracks).forEach(([key, value]) => {
                  // Only include tracks that have ratings or energy values
                  const trackData = value as any;
                  if (trackData.rating || trackData.energy) {
                    ratingData[key] = {
                      rating: trackData.rating || 0,
                      energy: trackData.energy || 0,
                    };
                  }
                });

                console.log("Prepared ratingData to send:", ratingData);
                console.log("Number of tracks with ratings:", Object.keys(ratingData).length);

                performAction("generate-rekordbox-xml", {
                  rekordboxXmlPath: settings.rekordboxXmlPath,
                  ratingData: ratingData,
                });
              }}
              disabled={isLoading["generate-rekordbox-xml"] || serverStatus !== "connected"}
            />
          </div>
        </div>

        <div className={styles.actionGroup}>
          <h4>Database Management</h4>
          <div className={styles.actionButtons}>
            <ActionButton
              label="Sync All Database"
              onClick={() =>
                handleDatabaseAction("sync-database", {
                  action: "all",
                  master_playlist_id: settings.masterPlaylistId,
                })
              }
              disabled={
                isLoading["sync-database"] ||
                serverStatus !== "connected" ||
                sequentialSyncState.isActive
              }
            />
            <ActionButton
              label="Clear Database"
              onClick={() => performAction("sync-database", { action: "clear" })}
              disabled={
                isLoading["sync-database"] ||
                serverStatus !== "connected" ||
                sequentialSyncState.isActive
              }
              className={styles.dangerButton}
            />
            <ActionButton
              label="Sync Playlists Only"
              onClick={() =>
                handleDatabaseAction("sync-database", {
                  action: "playlists",
                })
              }
              disabled={
                isLoading["sync-database"] ||
                serverStatus !== "connected" ||
                sequentialSyncState.isActive
              }
            />
            <ActionButton
              label="Sync Tracks Only"
              onClick={() =>
                handleDatabaseAction("sync-database", {
                  action: "tracks",
                  master_playlist_id: settings.masterPlaylistId,
                })
              }
              disabled={
                isLoading["sync-database"] ||
                serverStatus !== "connected" ||
                sequentialSyncState.isActive
              }
            />
            <ActionButton
              label="Sync Associations Only"
              onClick={() =>
                handleDatabaseAction("sync-database", {
                  action: "associations",
                  master_playlist_id: settings.masterPlaylistId,
                })
              }
              disabled={
                isLoading["sync-database"] ||
                serverStatus !== "connected" ||
                sequentialSyncState.isActive
              }
            />
          </div>

          {/* Sequential sync progress indicator (Playlists | Tracks | Associations) */}
          {sequentialSyncState.isActive && (
            <div className={styles.sequentialSyncProgress}>
              <div className={styles.progressHeader}>
                <span className={styles.progressTitle}>Database Sync in Progress</span>
                {sequentialSyncState.startTime && (
                  <span className={styles.progressTime}>
                    {Math.round((Date.now() - sequentialSyncState.startTime) / 1000)}s elapsed
                  </span>
                )}
              </div>
              <div className={styles.progressStages}>
                {sequentialSyncState.totalStages.map((stage, index) => (
                  <div
                    key={stage}
                    className={`${styles.progressStage} ${
                      sequentialSyncState.completedStages.includes(stage)
                        ? styles.completed
                        : sequentialSyncState.currentStage === stage
                        ? styles.active
                        : styles.pending
                    }`}
                  >
                    <span className={styles.stageNumber}>{index + 1}</span>
                    <span className={styles.stageName}>
                      {stage.charAt(0).toUpperCase() + stage.slice(1)}
                    </span>
                    {sequentialSyncState.completedStages.includes(stage) && (
                      <span className={styles.stageCheck}>✓</span>
                    )}
                    {sequentialSyncState.currentStage === stage && (
                      <span className={styles.stageSpinner}>⟳</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.actionGroup}>
          <h4>Spotify Integration</h4>
          <div className={styles.actionButtons}>
            <ActionButton
              label="Sync All Playlists to MASTER"
              onClick={() =>
                handleDatabaseAction("sync-to-master", {
                  master_playlist_id: settings.masterPlaylistId,
                })
              }
              disabled={
                isLoading["sync-to-master"] ||
                serverStatus !== "connected" ||
                !settings.masterPlaylistId
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
            <ActionButton
              label={
                isLoading["validate-short-tracks"] ? "Scanning Tracks..." : "Validate Short Tracks"
              }
              onClick={() => {
                setValidationType("short-tracks");
              }}
              disabled={serverStatus !== "connected" || isLoading["validate-short-tracks"]}
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

      <ValidationPanel
        serverUrl={settings.serverUrl}
        masterTracksDir={settings.masterTracksDir}
        playlistsDir={settings.playlistsDir}
        minTrackLengthMinutes={settings.minTrackLengthMinutes}
        validationType={validationType}
        cachedData={validationResults[validationType]}
        lastUpdated={validationTimestamps[validationType]}
        onRefresh={(forceRefresh) => fetchValidationData(validationType, forceRefresh)}
      />
    </div>
  );
};

export default PythonActionsPanel;
