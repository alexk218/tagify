import React, { useState, useEffect } from "react";
import styles from "./PythonActionsPanel.module.css";
import "../styles/globals.css";
import ValidationPanel from "./ValidationPanel";
import FileMappingWizard from "./FileMappingWizard";
import MappingResultsPanel from "./MappingResultsPanel";
import DuplicateTracksPanel from "./DuplicateTracksPanel";
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

interface AutoMatchedFile {
  file_path: string;
  file_name: string;
  uri: string;
  confidence: number;
  match_type: string;
  track_info: string;
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
    auto_matched_files: AutoMatchedFile[]; // TODO: duplicate interfaces in FileMappingWizard
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
    "clear-file-mappings-table": false,
    "fetch-unmapped-files": false,
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
  const [allUnmappedFiles, setAllUnmappedFiles] = useState<FileToProcess[]>([]);
  const [isApplyingMapping, setIsApplyingMapping] = useState(false);

  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);
  const [settings, setSettings] = useState({
    serverUrl: localStorage.getItem("tagify:localServerUrl") || "http://localhost:8765",
    masterTracksDir: localStorage.getItem("tagify:masterTracksDir") || "",
    playlistsDir: localStorage.getItem("tagify:playlistsDir") || "",
    masterPlaylistId: localStorage.getItem("tagify:masterPlaylistId") || "",
    minTrackLengthMinutes: Number(localStorage.getItem("tagify:minTrackLengthMinutes") || "5"),
    rekordboxXmlPath: localStorage.getItem("tagify:rekordboxXmlPath") || "",
  });

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

  const [duplicateTracksReport, setDuplicateTracksReport] = useState<any>(null);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [showDuplicatesPanel, setShowDuplicatesPanel] = useState(false);

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

  const fetchAllUnmappedFiles = async () => {
    setIsLoading((prev) => ({ ...prev, "fetch-unmapped-files": true }));

    try {
      const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");

      const requestData = {
        masterTracksDir: cleanMasterTracksDir,
        confidence_threshold: 0.75,
        confirmed: false,
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

      setAllUnmappedFiles(result.details.files_requiring_user_input || []);
      setAnalysisResults(result);

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

  const handleDetectDuplicates = async () => {
    setIsLoading((prev) => ({ ...prev, "detect-duplicates": true }));

    try {
      const response = await fetch(`${settings.serverUrl}/api/tracks/duplicates/detect`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        setDuplicateTracksReport(result);
        setShowDuplicatesModal(true);

        if (result.total_duplicates === 0) {
          Spicetify.showNotification("No duplicate tracks found!");
        } else {
          Spicetify.showNotification(
            `Found ${result.total_groups} duplicate groups with ${result.total_duplicates} tracks to remove`
          );
        }
      } else {
        throw new Error(result.message || "Unknown error");
      }
    } catch (error) {
      console.error("Error detecting duplicates:", error);
      Spicetify.showNotification(`Error detecting duplicates: ${error}`, true);
    } finally {
      setIsLoading((prev) => ({ ...prev, "detect-duplicates": false }));
    }
  };

  const handleCleanupDuplicates = async (dryRun: boolean = false) => {
    setIsLoading((prev) => ({ ...prev, "cleanup-duplicates": true }));

    try {
      const response = await fetch(`${settings.serverUrl}/api/tracks/duplicates/cleanup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ dry_run: dryRun }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        setResults((prev) => ({ ...prev, "cleanup-duplicates": result }));

        if (dryRun) {
          Spicetify.showNotification(
            `Dry run complete: Would remove ${result.tracks_removed} tracks and merge ${result.playlists_merged} playlists`
          );
        } else {
          Spicetify.showNotification(
            `Cleanup complete: Removed ${result.tracks_removed} duplicate tracks, merged ${result.playlists_merged} playlists`
          );

          // Refresh the duplicates report
          handleDetectDuplicates();
        }
      } else {
        throw new Error(result.message || "Unknown error");
      }
    } catch (error) {
      console.error("Error cleaning up duplicates:", error);
      Spicetify.showNotification(`Error cleaning up duplicates: ${error}`, true);
    } finally {
      setIsLoading((prev) => ({ ...prev, "cleanup-duplicates": false }));
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
        "cleanup-stale-mappings": { url: "/api/tracks/cleanup-mappings", method: "POST" },
        "create-file-mappings": { url: "/api/tracks/mapping", method: "POST" },
        "sync-database": { url: "/api/sync/database", method: "POST" },
        "sync-to-master": { url: "/api/sync/master", method: "POST" },
        "generate-m3u": { url: "/api/playlists/generate", method: "POST" },
        "validate-tracks": { url: "/api/validation/tracks", method: "GET" },
        "validate-playlists": { url: "/api/validation/playlists", method: "GET" },
        "generate-rekordbox-xml": { url: "/api/rekordbox/generate-xml", method: "POST" },
        "regenerate-playlist": {
          url: "/api/playlists/" + requestData.playlist_id + "/regenerate",
          method: "POST",
        },
        "direct-tracks-compare": { url: "/api/tracks/compare", method: "GET" },
        "fuzzy-match-track": { url: "/api/tracks/match", method: "POST" },
        "search-tracks": { url: "/api/tracks/search", method: "GET" },
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
        endpoint = type === "track" ? "file-mappings" : "playlists";
        queryParams = new URLSearchParams({
          masterTracksDir: settings.masterTracksDir,
          playlistsDir: settings.playlistsDir,
          masterPlaylistId: settings.masterPlaylistId,
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

  const applyFileMapping = async (selections: any[], description: string) => {
    if (isApplyingMapping) return; // Prevent multiple calls

    setIsApplyingMapping(true); // Set loading state

    try {
      const cleanMasterTracksDir = settings.masterTracksDir.replace(/^["'](.*)["']$/, "$1");

      const confirmData = {
        masterTracksDir: cleanMasterTracksDir,
        confirmed: true,
        user_selections: selections,
        precomputed_changes_from_analysis: analysisResults,
      };

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
        // Update the mapping results to show actual results instead of confirmation
        setMappingResults(result);

        // Get successfully mapped file paths
        const successfullyMappedFilePaths = new Set(
          result.results
            .filter((r) => r.success)
            .map((r) => selections.find((s) => s.file_name === r.filename)?.file_path)
            .filter(Boolean)
        );

        // Clean up state based on what was applied
        if (description.includes("auto-matched") || description.includes("auto")) {
          setRejectedAutoMatches([]);
        }

        if (description.includes("manual") || description.includes("user")) {
          setUserMatchSelections([]);
        }

        // Update analysisResults to remove successfully mapped files
        if (analysisResults && analysisResults.details.files_requiring_user_input) {
          const updatedAnalysis = {
            ...analysisResults,
            details: {
              ...analysisResults.details,
              files_requiring_user_input: analysisResults.details.files_requiring_user_input.filter(
                (file) => !successfullyMappedFilePaths.has(file.file_path)
              ),
              files_without_mappings: analysisResults.details.files_requiring_user_input.filter(
                (file) => !successfullyMappedFilePaths.has(file.file_path)
              ).length,
            },
          };
          setAnalysisResults(updatedAnalysis);
        }

        // Update allUnmappedFiles
        const filteredFiles = allUnmappedFiles.filter(
          (file) => !successfullyMappedFilePaths.has(file.file_path)
        );
        setAllUnmappedFiles(filteredFiles);

        // Reset fuzzy matching if no more files
        if (filteredFiles.length === 0) {
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

        const remainingCount = filteredFiles.length;
        Spicetify.showNotification(
          `Successfully mapped ${result.successful_mappings} files. ${remainingCount} files remaining.`
        );
      } else {
        throw new Error(result.message || "Unknown error occurred");
      }
    } catch (error) {
      console.error("Error applying file mappings:", error);
      Spicetify.showNotification(`Error applying mappings: ${error}`, true);
    } finally {
      setIsApplyingMapping(false);
    }
  };

  const handleIsLoadingChange = (newLoadingState: Record<string, boolean>) => {
    setIsLoading(newLoadingState);
  };

  // Render the confirmation UI when needed
  const renderConfirmation = () => {
    if (!isAwaitingConfirmation) return null;

    if (currentAction?.name === "create-file-mappings" && showFileMappingPanel) {
      return (
        <FileMappingWizard
          currentAction={currentAction}
          analysisResults={analysisResults}
          allUnmappedFiles={allUnmappedFiles}
          userMatchSelections={userMatchSelections}
          skippedFiles={skippedFiles}
          fuzzyMatchingState={fuzzyMatchingState}
          rejectedAutoMatches={rejectedAutoMatches}
          autoMatchedPage={autoMatchedPage}
          fileMappingConfidenceThreshold={fileMappingConfidenceThreshold}
          analysisConfidenceThreshold={analysisConfidenceThreshold}
          searchQuery={searchQuery}
          searchResults={searchResults}
          isSearching={isSearching}
          showSearchResults={showSearchResults}
          isLoading={isLoading}
          settings={settings}
          onUserMatchSelectionsChange={setUserMatchSelections}
          onSkippedFilesChange={setSkippedFiles}
          onFuzzyMatchingStateChange={setFuzzyMatchingState}
          onRejectedAutoMatchesChange={setRejectedAutoMatches}
          onAutoMatchedPageChange={setAutoMatchedPage}
          onFileMappingConfidenceThresholdChange={setFileMappingConfidenceThreshold}
          onAnalysisResultsChange={setAnalysisResults}
          onAllUnmappedFilesChange={setAllUnmappedFiles}
          onSearchQueryChange={setSearchQuery}
          onSearchResultsChange={setSearchResults}
          onIsSearchingChange={setIsSearching}
          onShowSearchResultsChange={setShowSearchResults}
          onMappingResultsChange={setMappingResults}
          onShowMappingResultsChange={setShowMappingResults}
          onIsLoadingChange={handleIsLoadingChange}
          onClosePanel={() => {
            // 1. Close the panel
            setShowFileMappingPanel(false);

            // 2. Clear confirmation states
            setIsAwaitingConfirmation(false);
            setCurrentAction(null);

            // 3. Clear analysis results
            setAnalysisResults(null);

            // 4. Clear file lists
            setAllUnmappedFiles([]);

            // 5. Clear rejection state
            setRejectedAutoMatches([]);

            // 6. Reset confidence thresholds
            setAnalysisConfidenceThreshold(0.75);
            setFileMappingConfidenceThreshold(0.75);

            // 7. Reset fuzzy matching state completely
            setFuzzyMatchingState({
              isActive: false,
              currentFileIndex: 0,
              matches: [],
              isLoading: false,
            });

            // 8. Clear user selections and skipped files
            setUserMatchSelections([]);
            setSkippedFiles([]);

            // 9. Reset pagination
            setAutoMatchedPage(1);

            // 10. Clear search state
            setSearchQuery("");
            setSearchResults([]);
            setIsSearching(false);
            setShowSearchResults(false);

            // 11. Clear mapping results (in case they're still showing)
            setMappingResults(null);
            setShowMappingResults(false);
          }}
        />
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

          {/* Render based on syncResponse structure */}
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
      <MappingResultsPanel
        mappingResults={mappingResults}
        showMappingResults={showMappingResults}
        onFinish={() => {
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
        }}
        onClose={() => {
          setShowMappingResults(false);
          setMappingResults(null);
        }}
        onConfirmChanges={async (selections) => {
          // Determine the description based on the source
          const description = selections.some(
            (s: any) =>
              mappingResults?.results?.find((r: any) => r.filename === s.file_name)?.source ===
              "auto_match"
          )
            ? "auto-matched selections"
            : "manually selected files";

          await applyFileMapping(selections, description);
        }}
        isApplyingMapping={isApplyingMapping}
      />

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
          <h4>Data Quality</h4>
          <div className={styles.actionButtons}>
            {/* <ActionButton
              label="Detect Duplicate Tracks"
              onClick={handleDetectDuplicates}
              disabled={isLoading["detect-duplicates"] || serverStatus !== "connected"}
            /> */}
            <ActionButton
              label="Manage Duplicate Tracks"
              onClick={() => setShowDuplicatesPanel(!showDuplicatesPanel)}
              disabled={serverStatus !== "connected"}
            />
            <ActionButton
              label="Clean Up Stale Mappings"
              onClick={() => performAction("cleanup-stale-mappings")}
              disabled={isLoading["cleanup-stale-mappings"] || serverStatus !== "connected"}
            />
          </div>
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

      {showDuplicatesPanel && (
        <DuplicateTracksPanel
          serverUrl={settings.serverUrl}
          onDetectDuplicates={() => {
            // Callback when duplicates are detected
            console.log("Duplicates detected");
          }}
          onCleanupDuplicates={(dryRun) => {
            // Callback when duplicates are cleaned up
            console.log(`Duplicates cleanup completed (dry run: ${dryRun})`);
            if (!dryRun) {
              Spicetify.showNotification("Duplicate tracks have been cleaned up successfully!");
            }
          }}
        />
      )}

      {/* {showDuplicatesModal && duplicateTracksReport && (
        <Portal>
          <div className={styles.modalOverlay}>
            <div className={styles.duplicatesPanel}>
              <div className={styles.duplicatesHeader}>
                <h3>Duplicate Tracks Report</h3>
                <button
                  className={styles.closeButton}
                  onClick={() => setShowDuplicatesModal(false)}
                >
                  ✕
                </button>
              </div>

              <div className={styles.duplicatesContent}>
                {duplicateTracksReport.total_duplicates === 0 ? (
                  <div className={styles.noDuplicates}>
                    <p>🎉 No duplicate tracks found!</p>
                    <p>Your music library is clean.</p>
                  </div>
                ) : (
                  <>
                    <div className={styles.duplicatesSummary}>
                      <p>
                        Found <strong>{duplicateTracksReport.total_groups}</strong> duplicate groups
                        with <strong>{duplicateTracksReport.total_duplicates}</strong> tracks to
                        remove.
                      </p>
                    </div>

                    <div className={styles.duplicatesActions}>
                      <button
                        className={styles.previewButton}
                        onClick={() => handleCleanupDuplicates(true)}
                        disabled={isLoading["cleanup-duplicates"]}
                      >
                        {isLoading["cleanup-duplicates"]
                          ? "Analyzing..."
                          : "Preview Cleanup (Dry Run)"}
                      </button>
                      <button
                        className={styles.cleanupButton}
                        onClick={() => handleCleanupDuplicates(false)}
                        disabled={isLoading["cleanup-duplicates"]}
                      >
                        {isLoading["cleanup-duplicates"] ? "Cleaning..." : "Clean Up Duplicates"}
                      </button>
                    </div>

                    <div className={styles.duplicatesList}>
                      <h4>Duplicate Groups:</h4>
                      {duplicateTracksReport.duplicate_groups
                        .slice(0, 10)
                        .map((group: any, index: number) => (
                          <div key={index} className={styles.duplicateGroup}>
                            <div className={styles.primaryTrack}>
                              <strong>✓ Keeping:</strong> {group.primary_track.artists} -{" "}
                              {group.primary_track.title}
                              {group.primary_track.album && (
                                <span className={styles.album}> ({group.primary_track.album})</span>
                              )}
                            </div>
                            <div className={styles.duplicateTracks}>
                              <strong>✗ Removing:</strong>
                              {group.duplicates.map((dup: any, dupIndex: number) => (
                                <div key={dupIndex} className={styles.duplicateTrack}>
                                  • {dup.artists} - {dup.title}
                                  {dup.album && (
                                    <span className={styles.album}> ({dup.album})</span>
                                  )}
                                </div>
                              ))}
                            </div>
                            {group.playlists_affected.length > 0 && (
                              <div className={styles.playlistsAffected}>
                                <strong>Playlists:</strong> {group.playlists_affected.length}{" "}
                                affected
                              </div>
                            )}
                          </div>
                        ))}
                      {duplicateTracksReport.duplicate_groups.length > 10 && (
                        <div className={styles.moreGroups}>
                          ... and {duplicateTracksReport.duplicate_groups.length - 10} more groups
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className={styles.duplicatesFooter}>
                <button
                  className={styles.closeButton}
                  onClick={() => setShowDuplicatesModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )} */}

      <ValidationPanel
        serverUrl={settings.serverUrl}
        masterTracksDir={settings.masterTracksDir}
        playlistsDir={settings.playlistsDir}
        masterPlaylistId={settings.masterPlaylistId}
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
