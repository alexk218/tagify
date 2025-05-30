import React, { useState, useEffect } from "react";
import styles from "./PythonActionsPanel.module.css";
import "../styles/globals.css";
import ValidationPanel from "./ValidationPanel";
import Portal from "../utils/Portal";
import { useLocalStorage } from "../hooks/useLocalStorage";

interface AnalysisResults {
  stage: string;
  success: boolean;
  message: string;
  stats?: any;
  requires_fuzzy_matching?: boolean;
  analyses?: {
    playlists?: {
      added: number;
      updated: number;
      unchanged: number;
      deleted: number;
      details: any;
    };
    tracks?: {
      added: number;
      updated: number;
      unchanged: number;
      deleted: number;
      to_add_sample: any[];
      all_tracks_to_add: any[];
      to_add_total: number;
      to_update_sample: any[];
      to_delete_sample: any[];
      all_tracks_to_update: any[];
      to_update_total: number;
      all_tracks_to_delete: any[];
      to_delete_total: number;
    };
    associations?: any;
  };
  master_sync?: MasterSyncAnalysis;
  details?: {
    files_to_process?: string[];
    playlists?: any[];
    to_add?: any[];
    to_add_total?: number;
    all_items_to_add?: any[];
    to_update?: any[];
    to_update_total?: number;
    all_items_to_update?: any[];
    to_delete?: any[];
    to_delete_total?: number;
    all_items_to_delete?: any[];
    auto_matched_files?: any[];
    tracks_with_changes?: any[];
    associations_to_add?: number;
    associations_to_remove?: number;
    all_changes?: any[];
    samples?: any[];
  };
  needs_confirmation?: boolean;
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
  | { name: string; data: any }
);

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

interface TrackItem {
  id: string;
  artists: string;
  name: string;
  title?: string;
}

interface PlaylistItem {
  name: string;
  track_count: number;
  tracks: TrackItem[];
}

interface MasterSyncAnalysis {
  total_tracks_to_add: number;
  playlists_with_new_tracks: number;
  playlists: PlaylistItem[];
  needs_confirmation: boolean;
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

  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
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

  const [sequentialProcess, setSequentialProcess] = useState<{
    active: boolean;
    stage: string;
    results: Record<string, any>;
  }>({
    active: false,
    stage: "",
    results: {},
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

  // TODO: have a summary page at the end of all operations - shows everything that's been modified. saves to a txt or json file?
  // Optional: Add this if you want to persist details between stages
  const [sequentialSyncDetails, setSequentialSyncDetails] = useState<{
    playlists?: any;
    tracks?: any;
    associations?: any;
  }>({});

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

    // Execute the action with the chosen force_refresh option
    if (pendingSyncAction.action === "sync-to-master") {
      performAction("sync-to-master", {
        ...pendingSyncAction.data,
        force_refresh: forceRefresh,
      });
    } else {
      // For database sync actions
      performAction(pendingSyncAction.action, {
        ...pendingSyncAction.data,
        force_refresh: forceRefresh,
      });
    }

    // Clean up state
    setShowSyncOptionsPopup(false);
    setPendingSyncAction(null);
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
        "embed-metadata": { url: "/api/tracks/metadata/embed", method: "POST" },
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

  const startSequentialSync = async () => {
    // Initialize the sequential process
    setSequentialSyncState({
      isActive: true,
      currentStage: "initializing",
      completedStages: [],
      totalStages: ["playlists", "tracks", "associations"],
      startTime: Date.now(),
    });

    setSequentialProcess({
      active: true,
      stage: "start",
      results: {},
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
      setSequentialProcess({
        active: false,
        stage: "",
        results: {},
      });
    }
  };

  const processSequentialStage = async (stage: string) => {
    setSequentialSyncState((prev) => ({
      ...prev,
      currentStage: stage,
    }));

    setSequentialProcess((prev) => ({
      ...prev,
      stage: stage,
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

      // Store the result for this stage
      setSequentialProcess((prev) => ({
        ...prev,
        results: { ...prev.results, [stage]: analysisResult },
      }));

      // If changes need confirmation, show confirmation UI
      if (analysisResult.needs_confirmation) {
        setAnalysisResults(analysisResult);
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
      setSequentialProcess({
        active: false,
        stage: "",
        results: {},
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
      setSequentialProcess({
        active: false,
        stage: "",
        results: {},
      });
      Spicetify.showNotification("Database sync completed successfully");
    }
  };

  // Handle confirmation
  const confirmAction = async () => {
    if (!currentAction) return;

    const { name, data } = currentAction;

    // Map old action names to new API endpoints
    const endpointMap: Record<string, { url: string; method: string }> = {
      "embed-metadata": { url: "/api/tracks/metadata/embed", method: "POST" },
      "sync-database": { url: "/api/sync/database", method: "POST" },
      "sequential-sync": { url: "/api/sync/database", method: "POST" },
    };

    // Handle sequential sync confirmations
    if (name === "sequential-sync" && data.stage) {
      const stage = data.stage;

      // Clear the confirmation UI
      setAnalysisResults(null);
      setIsAwaitingConfirmation(false);
      setCurrentAction(null);

      try {
        // Get the analysis result for this stage to use as precomputed changes
        const stageResult = sequentialProcess.results[stage];
        const playlistSettings = getPlaylistSettings();

        // Prepare precomputed changes based on the stage
        let formattedPrecomputedChanges = stageResult.details;

        // Special handling for tracks stage to ensure all required fields are included
        if (stage === "tracks") {
          formattedPrecomputedChanges = {
            tracks_to_add:
              stageResult.details?.all_items_to_add?.map(
                (track: {
                  id: any;
                  artists: any;
                  title: any;
                  album: any;
                  is_local: any;
                  added_at: any;
                }) => ({
                  id: track.id,
                  artists: track.artists || "Unknown Artist",
                  title: track.title || "Unknown Title",
                  album: track.album || "Unknown Album",
                  is_local: !!track.is_local,
                  added_at: track.added_at || null,
                })
              ) || [],

            tracks_to_update:
              stageResult.details?.all_items_to_update?.map(
                (track: {
                  id: any;
                  old_artists: any;
                  old_title: any;
                  old_album: any;
                  artists: any;
                  title: any;
                  album: any;
                  is_local: any;
                  changes?: string[];
                }) => ({
                  id: track.id,
                  old_artists: track.old_artists || "Unknown Artist",
                  old_title: track.old_title || "Unknown Title",
                  old_album: track.old_album || "Unknown Album",
                  artists: track.artists || "Unknown Artist",
                  title: track.title || "Unknown Title",
                  album: track.album || "Unknown Album",
                  is_local: !!track.is_local,
                  changes: track.changes || [],
                })
              ) || [],

            tracks_to_delete:
              stageResult.details?.all_items_to_delete?.map(
                (track: { id: any; artists: any; title: any; album: any; is_local: any }) => ({
                  id: track.id,
                  artists: track.artists || "Unknown Artist",
                  title: track.title || "Unknown Title",
                  album: track.album || "Unknown Album",
                  is_local: !!track.is_local,
                })
              ) || [],

            unchanged_tracks: stageResult.stats?.unchanged || 0,
          };
        }

        // Get the endpoint for this action
        const endpoint = endpointMap["sync-database"] || {
          url: "/api/sync-database",
          method: "POST",
        };
        const url = `${settings.serverUrl}/api/sync/database`;

        // Apply the changes with confirmation
        const response = await fetch(url, {
          method: endpoint.method,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            action: "all",
            stage: stage,
            force_refresh: false,
            confirmed: true,
            precomputed_changes_from_analysis:
              stage === "tracks" ? formattedPrecomputedChanges : stageResult.details,
            master_playlist_id: settings.masterPlaylistId,
            playlistSettings: playlistSettings,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        setSequentialSyncState((prev) => ({
          ...prev,
          completedStages: [...prev.completedStages, data.stage],
        }));
        // Store the sync result
        setSequentialProcess((prev) => ({
          ...prev,
          results: { ...prev.results, [`${stage}_sync`]: result },
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
          setSequentialProcess({
            active: false,
            stage: "",
            results: {},
          });
        } else {
          // If no next_stage is provided, end the process
          console.warn("No next_stage provided in result:", result);
          setSequentialProcess({
            active: false,
            stage: "",
            results: {},
          });
          Spicetify.showNotification("Database sync completed");
        }
      } catch (err) {
        console.error(`Error applying changes for stage ${stage}:`, err);
        Spicetify.showNotification(`Error: ${err || String(err)}`, true);

        setSequentialProcess({
          active: false,
          stage: "",
          results: {},
        });
      }

      return;
    }

    // Add confirmation flag and user selections to the data
    const confirmData = {
      ...data,
      confirmed: true,
    };

    if (name === "sync-database") {
      console.log(`Confirming ${data.action} sync with:`, confirmData);
    }

    if (name === "sync-database" && data.action === "all" && analysisResults) {
      // Include all precomputed data
      confirmData.precomputed_changes_from_analysis = {
        playlists: analysisResults.analyses?.playlists?.details,
        tracks: {
          tracks_to_add:
            analysisResults.analyses?.tracks?.all_tracks_to_add?.map((track) => ({
              id: track.id,
              artists: track.artists || "Unknown Artist",
              title: track.title || "Unknown Title",
              album: track.album || "Unknown Album",
              is_local: !!track.is_local,
              added_at: track.added_at || null,
            })) || [],

          tracks_to_update:
            analysisResults.analyses?.tracks?.all_tracks_to_update?.map((track) => ({
              id: track.id,
              old_artists: track.old_artists || "Unknown Artist",
              old_title: track.old_title || "Unknown Title",
              old_album: track.old_album || "Unknown Album",
              artists: track.artists || "Unknown Artist",
              title: track.title || "Unknown Title",
              album: track.album || "Unknown Album",
              is_local: !!track.is_local,
              changes: track.changes || [],
            })) || [],
          tracks_to_delete:
            analysisResults.details?.all_items_to_delete?.map((track) => ({
              id: track.id,
              artists: track.artists || "Unknown Artist",
              title: track.title || "Unknown Title",
              album: track.album || "Unknown Album",
              is_local: !!track.is_local,
            })) || [],

          unchanged_tracks: analysisResults.analyses?.tracks?.unchanged || 0,
        },
        associations: {
          tracks_with_changes:
            analysisResults.details?.tracks_with_changes ||
            analysisResults.details?.all_changes ||
            analysisResults.details?.samples ||
            [],
          tracks_with_playlists: analysisResults.stats?.tracks_with_playlists,
          tracks_without_playlists: analysisResults.stats?.tracks_without_playlists,
          total_associations: analysisResults.stats?.total_associations,
        },
      };
    } else if (name === "sync-database" && data.action === "playlists" && analysisResults) {
      confirmData.precomputed_changes_from_analysis = analysisResults.details;
    } else if (name === "sync-database" && data.action === "tracks" && analysisResults) {
      confirmData.precomputed_changes_from_analysis = {
        tracks_to_add:
          analysisResults.details?.all_items_to_add?.map((track) => ({
            id: track.id,
            artists: track.artists || "Unknown Artist",
            title: track.title || "Unknown Title",
            album: track.album || "Unknown Album",
            is_local: !!track.is_local,
            added_at: track.added_at || null,
          })) || [],

        tracks_to_update:
          analysisResults.details?.all_items_to_update?.map((track) => ({
            id: track.id,
            old_artists: track.old_artists || "Unknown Artist",
            old_title: track.old_title || "Unknown Title",
            old_album: track.old_album || "Unknown Album",
            artists: track.artists || "Unknown Artist",
            title: track.title || "Unknown Title",
            album: track.album || "Unknown Album",
            is_local: !!track.is_local,
            changes: track.changes || [],
          })) || [],

        tracks_to_delete:
          analysisResults.details?.all_items_to_delete?.map(
            (track: { id: any; artists: any; title: any; album: any; is_local: any }) => ({
              id: track.id,
              artists: track.artists || "Unknown Artist",
              title: track.title || "Unknown Title",
              album: track.album || "Unknown Album",
              is_local: !!track.is_local,
            })
          ) || [],

        unchanged_tracks: analysisResults.stats?.unchanged || 0,
      };
    } else if (name === "sync-database" && data.action === "associations" && analysisResults) {
      confirmData.precomputed_changes_from_analysis = {
        tracks_with_changes:
          analysisResults.details?.tracks_with_changes ||
          analysisResults.details?.all_changes ||
          analysisResults.details?.samples ||
          [],
        tracks_with_playlists: analysisResults.stats?.tracks_with_playlists,
        tracks_without_playlists: analysisResults.stats?.tracks_without_playlists,
        total_associations: analysisResults.stats?.total_associations,
      };
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
          const sanitizedUrl = settings.serverUrl.replace(/^["'](.*)["']$/, "$1").trim();

          // Use a simpler fetch approach
          const response = await fetch(`${sanitizedUrl}/api/tracks/match`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileName: currentFile,
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
    }, [currentFile]);

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
              {" "}
              <h4>Auto-matched Files ({analysisResults.details.auto_matched_files.length})</h4>
              <p>These files were automatically matched with high confidence (75%+):</p>
              <div className={styles.autoMatchedList}>
                {" "}
                {/* TODO: fix this */}
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
                  className={styles.debugInfo} // TODO: add this styling. or just remove this div
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
    if (
      isAwaitingConfirmation &&
      analysisResults &&
      analysisResults.stage &&
      currentAction?.name === "sequential-sync"
    ) {
      return (
        <div className={styles.confirmationPanel}>
          <h3>
            Database Sync -{" "}
            {analysisResults.stage.charAt(0).toUpperCase() + analysisResults.stage.slice(1)} Stage
          </h3>

          {/* Show a header indicating this is part of the sequential process */}
          <div className={styles.sequentialHeader}>
            <div className={styles.sequentialProgress}>
              <span
                className={`${styles.sequentialStep} ${
                  analysisResults.stage === "playlists" ? styles.active : ""
                }`}
              >
                1. Playlists
              </span>
              <span
                className={`${styles.sequentialStep} ${
                  analysisResults.stage === "tracks" ? styles.active : ""
                }`}
              >
                2. Tracks
              </span>
              <span
                className={`${styles.sequentialStep} ${
                  analysisResults.stage === "associations" ? styles.active : ""
                }`}
              >
                3. Associations
              </span>
            </div>
          </div>

          {/* Render the analysis results based on the stage */}
          {analysisResults.stage === "playlists" && analysisResults.details && (
            <div className={styles.playlistChanges}>
              <h4>Playlist Changes</h4>
              {analysisResults.stats.added > 0 && analysisResults.details.to_add && (
                <div className={styles.changesSection}>
                  <h5>Playlists to Add ({analysisResults.stats.added})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      analysisResults.details.to_add || [],
                      "playlists-add",
                      (item) => (
                        <div className={styles.item}>{item.name}</div>
                      )
                    )}
                  </div>
                </div>
              )}

              {analysisResults.stats.updated > 0 && analysisResults.details.to_update && (
                <div className={styles.changesSection}>
                  <h5>Playlists to Update ({analysisResults.stats.updated})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      analysisResults.details.to_update || [],
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

              {analysisResults.stats.deleted > 0 && analysisResults.details.to_delete && (
                <div className={styles.changesSection}>
                  <h5>Playlists to Delete ({analysisResults.stats.deleted})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      analysisResults.details.to_delete || [],
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

          {analysisResults.stage === "tracks" && analysisResults.details && (
            <div className={styles.trackChanges}>
              <h4>Track Changes</h4>
              {analysisResults.stats.added > 0 && analysisResults.details.all_items_to_add && (
                <div className={styles.changesSection}>
                  <h5>Tracks to Add ({analysisResults.stats.added})</h5>
                  <div className={styles.itemList}>
                    {renderPaginatedList(
                      analysisResults.details.all_items_to_add || [],
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

              {analysisResults.stats.updated > 0 && analysisResults.details.all_items_to_update && (
                <div className={styles.changesSection}>
                  <h5>Tracks to Update ({analysisResults.stats.updated})</h5>
                  <div className={styles.trackList}>
                    {renderPaginatedList(
                      analysisResults.details.all_items_to_update || [],
                      "tracks-update",
                      (track) => (
                        <div className={styles.trackItem}>
                          {track.old_artists} - {track.old_title} → {track.artists} - {track.title}
                          {track.is_local ? " (LOCAL)" : ""}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {analysisResults.stage === "associations" && analysisResults.details && (
            <div className={styles.associationChanges}>
              <h4>Association Changes</h4>
              {(analysisResults.details.all_changes ||
                analysisResults.details.samples ||
                analysisResults.details.tracks_with_changes) && (
                <div className={styles.changesSection}>
                  <h5>
                    Track Association Changes (
                    {analysisResults.stats ? (
                      <>
                        {analysisResults.stats.associations_to_add || 0} to add,{" "}
                        {analysisResults.stats.associations_to_remove || 0} to remove
                      </>
                    ) : (
                      "Updating associations"
                    )}
                    )
                  </h5>
                  <div className={styles.trackList}>
                    {renderPaginatedList(
                      analysisResults.details.all_changes ||
                        analysisResults.details.tracks_with_changes ||
                        analysisResults.details.samples ||
                        [],
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
                              <span className={styles.changeIcon}>-</span> Removing from playlists:{" "}
                              {item.remove_from.join(", ")}
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

    return (
      <div className={styles.confirmationPanel}>
        <h3>Confirm Changes</h3>

        {analysisResults.analyses && analysisResults.analyses.playlists && (
          // This is for the 'all' action
          <div className={styles.allAnalyses}>
            <h4>Playlist Changes</h4>
            <p>
              {analysisResults.analyses.playlists.added} playlists to add,{" "}
              {analysisResults.analyses.playlists.updated} to update,{" "}
              {analysisResults.analyses.playlists.unchanged} unchanged,{" "}
              {analysisResults.analyses.playlists.details?.to_delete?.length || 0} to delete
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

            {analysisResults.analyses.playlists.details.to_delete.length > 0 && (
              <div className={styles.sampleChanges}>
                <h5>
                  Playlists to Delete ({analysisResults.analyses.playlists.details.to_delete.length}
                  )
                </h5>
                <div className={styles.itemList}>
                  {renderPaginatedList(
                    analysisResults.analyses.playlists.details.to_delete,
                    "playlists-delete",
                    (item) => (
                      <div className={styles.item}>{item.name}</div>
                    )
                  )}
                </div>
              </div>
            )}

            <h4>Track Changes</h4>
            <p>
              {analysisResults.analyses.tracks?.added} tracks to add,{" "}
              {analysisResults.analyses.tracks?.updated} to update,{" "}
              {analysisResults.analyses.tracks?.unchanged} unchanged,{" "}
              {analysisResults.analyses.tracks?.deleted || 0} to delete
            </p>

            {/* Paginated Tracks to Add */}
            {analysisResults.analyses.tracks &&
              analysisResults.analyses.tracks.to_add_total > 0 && (
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
            {analysisResults.analyses.tracks &&
              analysisResults.analyses.tracks.to_update_total > 0 && (
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

            {analysisResults.analyses.tracks &&
              analysisResults.analyses.tracks.to_delete_total > 0 && (
                <div className={styles.sampleChanges}>
                  <h5 className={styles.deleteHeading}>
                    Tracks to Delete ({analysisResults.analyses.tracks.to_delete_total})
                  </h5>
                  <div className={styles.trackList}>
                    {renderPaginatedList(
                      analysisResults.analyses.tracks.all_tracks_to_delete ||
                        analysisResults.analyses.tracks.to_delete_sample ||
                        [],
                      "tracks-delete",
                      (track) => (
                        <div className={`${styles.trackItem} ${styles.deleteItem}`}>
                          {track.artists} - {track.title} {track.is_local ? "(LOCAL)" : ""}
                        </div>
                      ),
                      analysisResults.analyses.tracks.to_delete_total
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
                        <div className={styles.itemName}>
                          {item.changes && item.changes.length > 0 ? (
                            // If we have detailed changes, just show the track name once
                            `${item.artists} - ${item.title}`
                          ) : (
                            // Otherwise show the before → after format
                            <>
                              {item.old_name ||
                                item.old_title ||
                                (item.old_artists && `${item.old_artists} - ${item.old_title}`)}
                              {" → "}
                              {item.name ||
                                item.title ||
                                (item.artists && `${item.artists} - ${item.title}`)}
                            </>
                          )}
                        </div>
                        {/* Show update reasons for playlists */}
                        {item.old_name !== undefined && item.old_snapshot_id !== undefined && (
                          <div className={styles.updateReasons}>
                            {item.old_name !== item.name && (
                              <span className={styles.updateReason}>Name changed</span>
                            )}
                            {item.old_snapshot_id !== item.snapshot_id && (
                              <span className={styles.updateReason}>Tracks modified</span>
                            )}
                          </div>
                        )}
                        {/* Show update reasons for tracks */}
                        {item.changes && item.changes.length > 0 && (
                          <div className={styles.changeReasons}>
                            <div className={styles.changesLabel}>Changes:</div>
                            <ul className={styles.changesList}>
                              {item.changes.map((change: string, index: number) => (
                                <li key={index} className={styles.changeItem}>
                                  {change}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ),
                    analysisResults.details.to_update_total
                  )}
                </div>
              </div>
            )}

            {analysisResults.details?.to_delete && analysisResults.details.to_delete.length > 0 && (
              <div className={styles.sampleChanges}>
                <h5 className={styles.deleteHeading}>
                  Items to Delete (
                  {analysisResults.details.to_delete_total ||
                    analysisResults.details.to_delete.length}
                  )
                </h5>
                <div className={styles.itemList}>
                  {renderPaginatedList(
                    analysisResults.details.all_items_to_delete ||
                      analysisResults.details.to_delete,
                    "items-delete",
                    (item) => (
                      <div className={`${styles.item} ${styles.deleteItem}`}>
                        {item.name ||
                          item.title ||
                          item.artists ||
                          (item.id ? `${item.artists} - ${item.title}` : JSON.stringify(item))}
                      </div>
                    ),
                    analysisResults.details.to_delete_total
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
                    (playlist: PlaylistItem, i: React.Key | null | undefined) => (
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
                  onClick={() => executeSyncAction(false)}
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
                  onClick={() => executeSyncAction(true)}
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
