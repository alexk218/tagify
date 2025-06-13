import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import styles from "./ValidationPanel.module.css";
import Portal from "../utils/Portal";
import PlaylistStructureView from "./PlaylistStructureView";

interface PotentialMismatch {
  file: string;
  uri: string | null;
  track_id: string | null;
  track_info: string;
  filename: string;
  confidence: number;
  full_path: string;
  reason?: string;
  duration?: number;
  duration_formatted?: string;
}

interface FuzzyMatchResults {
  uri: string;
  track_id: string | null;
  artist: string;
  title: string;
  album: string;
  is_local: boolean;
  confidence: number;
  match_type: string;
  match_details: string;
}

interface FileDetail {
  filename: string;
  path: string;
  duration: number;
  duration_formatted: string;
  file_size: number;
  last_modified: string;
}

interface DuplicateTrackData {
  track_title: string;
  files: FileDetail[];
}

interface TrackValidationResult {
  success: boolean;
  summary: {
    total_files: number;
    files_with_track_id: number; // TODO: RENAME. on server-side too
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
  uri: string | null;
  track_info: string;
  filename: string;
  confidence: number;
  full_path: string;
}

interface SummaryTrackIssue {
  id: string;
  title: string;
  artists: string;
  album?: string;
  playlistsCount: number;
  playlistNames: string[];
  isLocal: boolean;
  notDownloaded: boolean;
  missingFromM3u: boolean;
  unexpectedInM3u: boolean;
}

interface ShortTrack {
  file: string;
  full_path: string;
  artist: string;
  title: string;
  duration_seconds: number;
  duration_formatted: string;
  track_id: string | null;
  extended_versions_found: ExtendedVersion[];
  has_longer_versions: boolean;
  discogs_search_completed: boolean;
  search_error: string | null;
  track_found_on_discogs?: boolean;
  total_versions_found?: number;
  status_message?: string;
  status_type?:
    | "not_searched"
    | "searching"
    | "not_found"
    | "no_extended"
    | "extended_found"
    | "error";
  manually_marked_extended?: boolean;
}

interface ExtendedVersion {
  artist: string;
  title: string;
  duration_seconds: number;
  duration_formatted: string;
  release_title: string;
  release_year: number;
  formats: string[];
  labels: string[];
  discogs_url: string;
  mix_type: string;
}

interface ShortTracksValidationResult {
  success: boolean;
  summary: {
    total_files: number;
    short_tracks: number;
    min_length_minutes: number;
  };
  short_tracks: ShortTrack[];
}

interface ValidationPanelProps {
  serverUrl: string;
  masterTracksDir: string;
  playlistsDir: string;
  minTrackLengthMinutes: number;
  validationType?: "track" | "playlist" | "short-tracks";
  cachedData?: any | null;
  lastUpdated?: number | null;
  onRefresh?: (forceRefresh?: boolean) => Promise<any>;
}

const ValidationPanel: React.FC<ValidationPanelProps> = ({
  serverUrl,
  masterTracksDir,
  playlistsDir,
  minTrackLengthMinutes,
  validationType = "track",
  cachedData = null,
  lastUpdated = null,
  onRefresh,
}) => {
  const [currentTab, setCurrentTab] = useState<"track" | "playlist" | "short-tracks">(
    validationType
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [trackValidationResult, setTrackValidationResult] = useState<TrackValidationResult | null>(
    validationType === "track" && cachedData ? cachedData : null
  );

  const [playlistValidationResult, setPlaylistValidationResult] =
    useState<PlaylistValidationResult | null>(
      validationType === "playlist" && cachedData ? cachedData : null
    );
  const [selectedMismatch, setSelectedMismatch] = useState<PotentialMismatch | null>(null);
  const [possibleMatches, setPossibleMatches] = useState<FuzzyMatchResults[]>([]);
  const [isFetchingMatches, setIsFetchingMatches] = useState<boolean>(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.75);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [selectedDuplicateTrackId, setSelectedDuplicateTrackId] = useState<string | null>(null);

  const [ignoredTrackPaths, setIgnoredTrackPaths] = useState<Set<string>>(
    new Set(JSON.parse(localStorage.getItem("tagify:ignoredTrackPaths") || "[]") as string[])
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
  const [shortTracksSection, setShortTracksSection] = useState<
    "unsearched" | "no-extended" | "extended-found" | "confirmed-short"
  >("unsearched");
  const [filesMissingTrackId, setFilesMissingTrackId] = useState<PotentialMismatch[]>([]);

  const [playlistSearchQuery, setPlaylistSearchQuery] = useState<string>("");

  const [currentView, setCurrentView] = useState<
    "playlists" | "tracks" | "all-playlists" | "playlist-structure"
  >("playlists");
  const [trackSummaryFilter, setTrackSummaryFilter] = useState<string>("all");
  const [trackSummarySort, setTrackSummarySort] = useState<string>("playlists-desc");

  const [shortTracksValidationResult, setShortTracksValidationResult] =
    useState<ShortTracksValidationResult | null>(null);
  const [confirmedShortTracks, setConfirmedShortTracks] = useState<Set<string>>(
    new Set(JSON.parse(localStorage.getItem("tagify:confirmedShortTracks") || "[]") as string[])
  );

  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);

  const [showClearConfirmation, setShowClearConfirmation] = useState(false);
  const bulkSearchCancelRef = useRef(false);
  const isBulkSearchingRef = useRef(false);

  const [bulkSearchState, setBulkSearchState] = useState<{
    isRunning: boolean;
    currentIndex: number;
    totalTracks: number;
    currentTrack: ShortTrack | null;
    cancelled: boolean;
  }>({
    isRunning: false,
    currentIndex: 0,
    totalTracks: 0,
    currentTrack: null,
    cancelled: false,
  });

  const [shortTracksSearchResults, setShortTracksSearchResultsState] = useState<
    Record<
      string,
      {
        status_type:
          | "not_searched"
          | "searching"
          | "not_found"
          | "no_extended"
          | "extended_found"
          | "error";
        status_message: string;
        track_found_on_discogs: boolean;
        total_versions_found: number;
        extended_versions_found: ExtendedVersion[];
        has_longer_versions: boolean;
        search_date: string;
        manually_marked_extended?: boolean;
      }
    >
  >(() => {
    // Initialize from localStorage
    try {
      const stored = localStorage.getItem("tagify:shortTracksSearchResults");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Run validation when component mounts
  useEffect(() => {
    if (onRefresh) {
      onRefresh(false)
        .then((data) => {
          if (data) {
            if (validationType === "track") {
              setTrackValidationResult(data);
              setFilesMissingTrackId(data.files_missing_trackid || []);
              if (data.potential_mismatches) {
                updateFilteredMismatches(
                  data.potential_mismatches,
                  ignoredTrackPaths,
                  currentSection === "ignored"
                );
              }
            } else if (validationType === "playlist") {
              setPlaylistValidationResult(data);
            } else if (validationType === "short-tracks") {
              setShortTracksValidationResult(data);
            }
          }
        })
        .catch((error) => {
          console.error("Error loading data:", error);
        });
    }
  }, [validationType, onRefresh]);

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
      } else if (currentTab === "short-tracks") {
        onRefresh(true)
          .then((data) => {
            if (data) {
              setShortTracksValidationResult(data);
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

  const getFilteredPlaylists = () => {
    if (!playlistSearchQuery.trim() || !playlistValidationResult) {
      return playlistValidationResult?.playlist_analysis || [];
    }

    const query = playlistSearchQuery.toLowerCase().trim();
    return playlistValidationResult.playlist_analysis.filter((playlist) =>
      playlist.name.toLowerCase().includes(query)
    );
  };

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
        const queryParams = new URLSearchParams({
          masterTracksDir: masterTracksDir,
        });

        const response = await fetch(`${serverUrl}/api/validation/file-mappings?${queryParams}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
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
        const queryParams = new URLSearchParams({
          masterTracksDir: masterTracksDir,
          playlistsDir: playlistsDir,
        });

        const response = await fetch(`${serverUrl}/api/validation/playlists?${queryParams}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
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

  const [playlistCreationResult, setPlaylistCreationResult] = useState<{
    show: boolean;
    data: any;
  } | null>(null);

  // TODO: figure this out...
  const createPlaylistFromExtendedTracks = async () => {
    if (tracksWithExtended.length === 0) {
      Spicetify.showNotification("No tracks with extended versions found", true);
      return;
    }

    setIsCreatingPlaylist(true);

    try {
      // Extract track IDs that are already available from the track objects
      let trackIds = tracksWithExtended
        .filter((track) => track.track_id && track.track_id.trim())
        .map((track) => track.track_id);

      // If some tracks don't have track_id in the object, extract from file metadata
      const tracksWithoutId = tracksWithExtended.filter((track) => !track.track_id);

      if (tracksWithoutId.length > 0) {
        const extractResponse = await fetch(`${serverUrl}/api/validation/extract-file-mappings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filePaths: tracksWithoutId.map((track) => track.full_path),
          }),
        });

        if (extractResponse.ok) {
          const extractData = await extractResponse.json();
          if (extractData.success) {
            const additionalTrackIds = extractData.track_ids
              .filter((item: { track_id: any }) => item.track_id)
              .map((item: { track_id: any }) => item.track_id);
            trackIds = [...trackIds, ...additionalTrackIds];
          }
        }
      }

      if (trackIds.length === 0) {
        Spicetify.showNotification("No tracks have embedded TrackIDs", true);
        return;
      }

      const response = await fetch(
        `${serverUrl}/api/validation/create-extended-versions-playlist`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            trackIds: trackIds,
            playlistName: `Extended Versions (${new Date().toLocaleDateString()})`,
            playlistDescription: `Playlist created from ${
              trackIds.length
            } tracks that have extended versions available. Created on ${new Date().toLocaleDateString()}.`,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Show detailed results
          setPlaylistCreationResult({
            show: true,
            data: data,
          });

          if (data.failed_tracks_count > 0) {
            Spicetify.showNotification(
              `Playlist created with ${data.tracks_added}/${data.tracks_requested} tracks. ${data.failed_tracks_count} tracks failed.`,
              false,
              5000
            );
          } else {
            Spicetify.showNotification(
              `Successfully created playlist "${data.playlist_name}" with ${data.tracks_added} tracks`
            );
          }
        } else {
          Spicetify.showNotification(`Error: ${data.message}`, true);
        }
      } else {
        const error = await response.json();
        Spicetify.showNotification(`Error: ${error.message || "Unknown error"}`, true);
      }
    } catch (error) {
      console.error("Error creating playlist:", error);
      Spicetify.showNotification("Error creating playlist", true);
    } finally {
      setIsCreatingPlaylist(false);
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

  const setShortTracksSearchResults = useCallback(
    (updater: React.SetStateAction<typeof shortTracksSearchResults>) => {
      setShortTracksSearchResultsState((prev) => {
        const newState = typeof updater === "function" ? updater(prev) : updater;

        // If not in bulk search mode, immediately sync to localStorage
        if (!isBulkSearchingRef.current) {
          localStorage.setItem("tagify:shortTracksSearchResults", JSON.stringify(newState));
        }

        return newState;
      });
    },
    []
  );

  useEffect(() => {
    if (!bulkSearchState.isRunning && isBulkSearchingRef.current) {
      // Bulk search just completed, sync to localStorage
      localStorage.setItem(
        "tagify:shortTracksSearchResults",
        JSON.stringify(shortTracksSearchResults)
      );
      isBulkSearchingRef.current = false;
    }
  }, [bulkSearchState.isRunning, shortTracksSearchResults]);

  const isShortTrack = (duration: number) => {
    return duration < minTrackLengthMinutes * 60;
  };

  const confirmShortTrack = (filePath: string) => {
    const newConfirmedTracks = new Set(confirmedShortTracks);
    newConfirmedTracks.add(filePath);
    setConfirmedShortTracks(newConfirmedTracks);
    localStorage.setItem("tagify:confirmedShortTracks", JSON.stringify([...newConfirmedTracks]));
    Spicetify.showNotification("Track confirmed as correct length");
  };

  const unconfirmShortTrack = (filePath: string) => {
    const newConfirmedTracks = new Set(confirmedShortTracks);
    newConfirmedTracks.delete(filePath);
    setConfirmedShortTracks(newConfirmedTracks);
    localStorage.setItem("tagify:confirmedShortTracks", JSON.stringify([...newConfirmedTracks]));
    Spicetify.showNotification("Track removed from confirmed list");
  };

  const searchExtendedVersions = async (track: ShortTrack) => {
    // Set searching status
    const searchingStatus = {
      status_type: "searching" as const,
      status_message: "Searching Discogs...",
      track_found_on_discogs: false,
      total_versions_found: 0,
      extended_versions_found: [],
      has_longer_versions: false,
      search_date: new Date().toISOString(),
    };

    setShortTracksSearchResults((prev) => ({
      ...prev,
      [track.full_path]: searchingStatus,
    }));

    try {
      const response = await fetch(`${serverUrl}/api/validation/search-extended-versions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          artist: track.artist,
          title: track.title,
          currentDuration: track.duration_seconds,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        // Save search results to localStorage
        const searchResult = {
          status_type: data.status_type || "error",
          status_message: data.status_message || "Search completed",
          track_found_on_discogs: data.track_found_on_discogs || false,
          total_versions_found: data.total_versions_found || 0,
          extended_versions_found: data.extended_versions || [],
          has_longer_versions: data.has_longer_versions || false,
          search_date: new Date().toISOString(),
        };

        setShortTracksSearchResults((prev) => ({
          ...prev,
          [track.full_path]: searchResult,
        }));

        // Show notification based on result
        if (data.success) {
          Spicetify.showNotification(data.status_message);
        } else {
          Spicetify.showNotification(`Search failed: ${data.error}`, true);
        }
      } else {
        // Handle HTTP error
        const errorResult = {
          status_type: "error" as const,
          status_message: "Request failed",
          track_found_on_discogs: false,
          total_versions_found: 0,
          extended_versions_found: [],
          has_longer_versions: false,
          search_date: new Date().toISOString(),
        };

        setShortTracksSearchResults((prev) => ({
          ...prev,
          [track.full_path]: errorResult,
        }));

        Spicetify.showNotification("Failed to search for extended versions", true);
      }
    } catch (error) {
      console.error("Error searching extended versions:", error);

      const errorResult = {
        status_type: "error" as const,
        status_message: "Network error",
        track_found_on_discogs: false,
        total_versions_found: 0,
        extended_versions_found: [],
        has_longer_versions: false,
        search_date: new Date().toISOString(),
      };

      setShortTracksSearchResults((prev) => ({
        ...prev,
        [track.full_path]: errorResult,
      }));

      Spicetify.showNotification("Error searching for extended versions", true);
    }
  };

  const markAsNeedsExtended = (track: ShortTrack) => {
    const manualResult = {
      status_type: "extended_found" as const,
      status_message: "Manually marked as needs extended version",
      track_found_on_discogs: false,
      total_versions_found: 0,
      extended_versions_found: [],
      has_longer_versions: true,
      manually_marked_extended: true,
      search_date: new Date().toISOString(),
    };

    setShortTracksSearchResults((prev) => ({
      ...prev,
      [track.full_path]: manualResult,
    }));

    Spicetify.showNotification("Track marked as needs extended version");
  };

  const mergeTrackWithStoredResults = (track: ShortTrack): ShortTrack => {
    const storedResult = shortTracksSearchResults[track.full_path];

    if (storedResult) {
      return {
        ...track,
        status_type: storedResult.status_type,
        status_message: storedResult.status_message,
        track_found_on_discogs: storedResult.track_found_on_discogs,
        total_versions_found: storedResult.total_versions_found,
        extended_versions_found: storedResult.extended_versions_found,
        has_longer_versions: storedResult.has_longer_versions,
        discogs_search_completed: storedResult.status_type !== "searching",
        manually_marked_extended: storedResult.manually_marked_extended || false,
      };
    }

    return {
      ...track,
      status_type: "not_searched" as const,
      status_message: "Not searched yet",
      discogs_search_completed: false,
      manually_marked_extended: false,
    };
  };

  const searchAllUnsearchedTracks = async () => {
    if (unsearchedTracks.length === 0) {
      Spicetify.showNotification("No unsearched tracks found");
      return;
    }

    // Set bulk search mode
    isBulkSearchingRef.current = true;

    // Reset cancellation flag
    bulkSearchCancelRef.current = false;

    setBulkSearchState({
      isRunning: true,
      currentIndex: 0,
      totalTracks: unsearchedTracks.length,
      currentTrack: unsearchedTracks[0],
      cancelled: false,
    });

    Spicetify.showNotification(`Starting bulk search for ${unsearchedTracks.length} tracks`);

    for (let i = 0; i < unsearchedTracks.length; i++) {
      // Check if search was cancelled using the ref
      if (bulkSearchCancelRef.current) {
        Spicetify.showNotification("Bulk search cancelled");
        break;
      }

      const track = unsearchedTracks[i];

      setBulkSearchState((prev) => ({
        ...prev,
        currentIndex: i,
        currentTrack: track,
      }));

      try {
        // Search for this track
        await searchSingleTrackForBulk(track);

        // Wait between requests to respect rate limits (1.2 seconds)
        if (i < unsearchedTracks.length - 1 && !bulkSearchCancelRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      } catch (error) {
        console.error(`Error searching track ${track.artist} - ${track.title}:`, error);
        // Continue with next track even if one fails
      }
    }

    setBulkSearchState({
      isRunning: false,
      currentIndex: 0,
      totalTracks: 0,
      currentTrack: null,
      cancelled: false,
    });

    if (!bulkSearchCancelRef.current) {
      Spicetify.showNotification("Bulk search completed!");
    }
  };

  const searchSingleTrackForBulk = async (track: ShortTrack): Promise<void> => {
    try {
      const response = await fetch(`${serverUrl}/api/validation/search-extended-versions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          artist: track.artist,
          title: track.title,
          currentDuration: track.duration_seconds,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        // Save search results to localStorage
        const searchResult = {
          status_type: data.status_type || "error",
          status_message: data.status_message || "Search completed",
          track_found_on_discogs: data.track_found_on_discogs || false,
          total_versions_found: data.total_versions_found || 0,
          extended_versions_found: data.extended_versions || [],
          has_longer_versions: data.has_longer_versions || false,
          search_date: new Date().toISOString(),
        };

        setShortTracksSearchResults((prev) => ({
          ...prev,
          [track.full_path]: searchResult,
        }));
      } else {
        // Handle HTTP error
        const errorResult = {
          status_type: "error" as const,
          status_message: "Request failed",
          track_found_on_discogs: false,
          total_versions_found: 0,
          extended_versions_found: [],
          has_longer_versions: false,
          search_date: new Date().toISOString(),
        };

        setShortTracksSearchResults((prev) => ({
          ...prev,
          [track.full_path]: errorResult,
        }));
      }
    } catch (error) {
      console.error("Error in bulk search:", error);

      const errorResult = {
        status_type: "error" as const,
        status_message: "Network error",
        track_found_on_discogs: false,
        total_versions_found: 0,
        extended_versions_found: [],
        has_longer_versions: false,
        search_date: new Date().toISOString(),
      };

      setShortTracksSearchResults((prev) => ({
        ...prev,
        [track.full_path]: errorResult,
      }));
    }
  };

  const cancelBulkSearch = () => {
    bulkSearchCancelRef.current = true;
    setBulkSearchState((prev) => ({
      ...prev,
      cancelled: true,
    }));

    // Sync current state to localStorage since bulk search is ending
    if (isBulkSearchingRef.current) {
      localStorage.setItem(
        "tagify:shortTracksSearchResults",
        JSON.stringify(shortTracksSearchResults)
      );
      isBulkSearchingRef.current = false;
    }
  };

  const unsearchedTracks = useMemo(() => {
    if (!shortTracksValidationResult) return [];

    return shortTracksValidationResult.short_tracks
      .filter((track) => !confirmedShortTracks.has(track.full_path))
      .map(mergeTrackWithStoredResults)
      .filter(
        (track) =>
          !track.discogs_search_completed ||
          !track.status_type ||
          track.status_type === "not_searched"
      );
  }, [shortTracksValidationResult, confirmedShortTracks, shortTracksSearchResults]);

  const tracksWithoutExtended = useMemo(() => {
    if (!shortTracksValidationResult) return [];

    return shortTracksValidationResult.short_tracks
      .filter((track) => !confirmedShortTracks.has(track.full_path))
      .map(mergeTrackWithStoredResults)
      .filter(
        (track) =>
          !track.has_longer_versions &&
          (track.status_type === "no_extended" || track.status_type === "not_found")
      );
  }, [shortTracksValidationResult, confirmedShortTracks, shortTracksSearchResults]);

  const tracksWithExtended = useMemo(() => {
    if (!shortTracksValidationResult) return [];

    return shortTracksValidationResult.short_tracks
      .filter((track) => !confirmedShortTracks.has(track.full_path))
      .map(mergeTrackWithStoredResults)
      .filter((track) => track.has_longer_versions);
  }, [shortTracksValidationResult, confirmedShortTracks, shortTracksSearchResults]);

  const confirmedShortTracksList = useMemo(() => {
    if (!shortTracksValidationResult) return [];

    return shortTracksValidationResult.short_tracks
      .filter((track) => confirmedShortTracks.has(track.full_path))
      .map(mergeTrackWithStoredResults);
  }, [shortTracksValidationResult, confirmedShortTracks, shortTracksSearchResults]);

  const findPossibleMatches = async (mismatch: PotentialMismatch | SearchResult) => {
    setIsFetchingMatches(true);

    try {
      const response = await fetch(`${serverUrl}/api/tracks/match`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: mismatch.file,
          currentTrackId: mismatch.track_id, // TODO: FIX. and fix server-side...
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

  const createFileMapping = async (filePath: string, uri: string, matchInfo: any) => {
    try {
      const response = await fetch(`${serverUrl}/api/validation/create-file-mapping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filePath, uri }),
      });

      const result = await response.json();

      if (result.success) {
        // Refresh the validation data
        Spicetify.showNotification(
          `File mapping created: ${matchInfo.artist} - ${matchInfo.title}`
        );
        // Clear selection to show the updated list
        setSelectedMismatch(null);
        setPossibleMatches([]);
        validateTrackMetadata();
      } else {
        Spicetify.showNotification(`Error: ${result.message}`, true);
      }
    } catch (error) {
      console.error("Error creating file mapping:", error);
      Spicetify.showNotification("Error creating file mapping", true);
    }
  };

  const regeneratePlaylist = async (playlistId: string) => {
    try {
      setIsLoading(true);
      console.log(`Regenerating playlist ${playlistId}`);

      const response = await fetch(`${serverUrl}/api/playlists/${playlistId}/regenerate`, {
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

      const response = await fetch(`${serverUrl}/api/playlists/generate`, {
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
        if (currentView === "playlist-structure" && onRefresh) {
          setTimeout(() => onRefresh(true), 1000);
        }
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

  const getProblematicTracksSummary = (): SummaryTrackIssue[] => {
    if (!playlistValidationResult) return [];

    const trackIssuesMap = new Map<string, SummaryTrackIssue>();

    // Process each playlist with issues
    playlistValidationResult.playlist_analysis
      .filter((playlist) => playlist.needs_update)
      .forEach((playlist) => {
        // Process missing tracks
        playlist.tracks_missing_from_m3u.forEach((track) => {
          const trackKey = `${track.id}`;
          if (!trackIssuesMap.has(trackKey)) {
            trackIssuesMap.set(trackKey, {
              id: track.id,
              title: track.title,
              artists: track.artists,
              album: track.album,
              playlistsCount: 0,
              playlistNames: [],
              isLocal: track.is_local || false,
              notDownloaded: false,
              missingFromM3u: true,
              unexpectedInM3u: false,
            });
          }

          const trackData = trackIssuesMap.get(trackKey)!;
          trackData.playlistsCount++;
          if (!trackData.playlistNames.includes(playlist.name)) {
            trackData.playlistNames.push(playlist.name);
          }
          trackData.missingFromM3u = true;
        });

        // Process unexpected tracks
        playlist.unexpected_tracks_in_m3u.forEach((track) => {
          const trackKey = `${track.id}`;
          if (!trackIssuesMap.has(trackKey)) {
            trackIssuesMap.set(trackKey, {
              id: track.id,
              title: track.title,
              artists: track.artists,
              album: track.album,
              playlistsCount: 0,
              playlistNames: [],
              isLocal: track.is_local || false,
              notDownloaded: false,
              missingFromM3u: false,
              unexpectedInM3u: true,
            });
          }

          const trackData = trackIssuesMap.get(trackKey)!;
          trackData.playlistsCount++;
          if (!trackData.playlistNames.includes(playlist.name)) {
            trackData.playlistNames.push(playlist.name);
          }
          trackData.unexpectedInM3u = true;
        });

        // Process not downloaded tracks
        playlist.not_downloaded_tracks?.forEach((track) => {
          const trackKey = `${track.id}`;
          if (!trackIssuesMap.has(trackKey)) {
            trackIssuesMap.set(trackKey, {
              id: track.id,
              title: track.title,
              artists: track.artists,
              album: track.album,
              playlistsCount: 0,
              playlistNames: [],
              isLocal: track.is_local || false,
              notDownloaded: true,
              missingFromM3u: false,
              unexpectedInM3u: false,
            });
          }

          const trackData = trackIssuesMap.get(trackKey)!;
          trackData.playlistsCount++;
          if (!trackData.playlistNames.includes(playlist.name)) {
            trackData.playlistNames.push(playlist.name);
          }
          trackData.notDownloaded = true;
        });
      });

    // Convert map to array
    const summaryArray = Array.from(trackIssuesMap.values());

    // Apply filtering
    let filteredSummary = summaryArray;
    if (trackSummaryFilter === "not-downloaded") {
      filteredSummary = summaryArray.filter((track) => track.notDownloaded);
    } else if (trackSummaryFilter === "missing-from-m3u") {
      filteredSummary = summaryArray.filter((track) => track.missingFromM3u);
    } else if (trackSummaryFilter === "unexpected-in-m3u") {
      filteredSummary = summaryArray.filter((track) => track.unexpectedInM3u);
    } else if (trackSummaryFilter === "local-files") {
      filteredSummary = summaryArray.filter((track) => track.isLocal);
    }

    // Apply sorting
    if (trackSummarySort === "playlists-desc") {
      filteredSummary.sort((a, b) => b.playlistsCount - a.playlistsCount);
    } else if (trackSummarySort === "playlists-asc") {
      filteredSummary.sort((a, b) => a.playlistsCount - b.playlistsCount);
    } else if (trackSummarySort === "title-asc") {
      filteredSummary.sort((a, b) => a.title.localeCompare(b.title));
    } else if (trackSummarySort === "title-desc") {
      filteredSummary.sort((a, b) => b.title.localeCompare(a.title));
    } else if (trackSummarySort === "artist-asc") {
      filteredSummary.sort((a, b) => a.artists.localeCompare(b.artists));
    } else if (trackSummarySort === "artist-desc") {
      filteredSummary.sort((a, b) => b.artists.localeCompare(a.artists));
    }

    return filteredSummary;
  };

  const handleSelectMismatch = (mismatch: PotentialMismatch | SearchResult) => {
    setSelectedMismatch(mismatch);
    findPossibleMatches(mismatch);
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

  const removeFileMapping = async (filePath: string) => {
    try {
      const response = await fetch(`${serverUrl}/api/validation/remove-file-mapping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filePath }),
      });

      const result = await response.json();

      if (result.success) {
        // Refresh the validation data
        // onRefresh(true);
        Spicetify.showNotification("File mapping removed successfully");
        // Refresh validation after removal
        // todo: make sure this is good. rename validateTrackMetadata + route
        setSelectedMismatch(null);
        setPossibleMatches([]);
        validateTrackMetadata();
      } else {
        Spicetify.showNotification(`Error: ${result.message}`, true);
      }
    } catch (error) {
      console.error("Error removing file mapping:", error);
      Spicetify.showNotification("Error removing file mapping", true);
    }
  };

  // TODO: just use removeFileMapping? and delete route for this?
  const removeDuplicateMapping = async (filePath: string, uri: string) => {
    try {
      const response = await fetch(`${serverUrl}/api/validation/remove-duplicate-mapping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filePath, uri }),
      });

      const result = await response.json();

      if (result.success) {
        // Refresh the validation data
        Spicetify.showNotification("Duplicate mapping removed successfully");
        setSelectedMismatch(null);
        setPossibleMatches([]);
        validateTrackMetadata();
      } else {
        Spicetify.showNotification(`Error: ${result.message}`, true);
      }
    } catch (error) {
      console.error("Error removing duplicate mapping:", error);
      Spicetify.showNotification("Error removing duplicate mapping", true);
    }
  };

  // TODO: remove this and all references -> replace with removeFileMapping
  const removeTrackId = async (filePath: string) => {
    try {
      const response = await fetch(`${serverUrl}/api/tracks/metadata`, {
        method: "DELETE",
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

  const getFilteredMismatchesByConfidence = (
    mismatches: PotentialMismatch[],
    threshold: number
  ) => {
    return mismatches.filter((mismatch) => mismatch.confidence <= threshold);
  };

  // Replace the setFilteredMismatches calls in updateFilteredMismatches function
  const updateFilteredMismatches = (
    mismatches: PotentialMismatch[],
    ignored: Set<string>,
    showIgnored: boolean
  ) => {
    // First filter by ignored status
    const ignoredFiltered = mismatches.filter((mismatch) => {
      const isIgnored = ignored.has(mismatch.full_path);
      return showIgnored ? isIgnored : !isIgnored;
    });

    // Then filter by confidence threshold
    const finalFiltered = getFilteredMismatchesByConfidence(ignoredFiltered, confidenceThreshold);

    setFilteredMismatches(finalFiltered);
    setHasMoreItems(finalFiltered.length > pageSize * page);

    // Select first item if none is selected and there are items to select
    if (!selectedMismatch && finalFiltered.length > 0) {
      handleSelectMismatch(finalFiltered[0]);
    }
  };

  const searchTracks = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);

    try {
      const url = `${serverUrl}/api/tracks/search?query=${encodeURIComponent(searchQuery)}${
        masterTracksDir ? `&masterTracksDir=${encodeURIComponent(masterTracksDir)}` : ""
      }`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
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
      const response = await fetch(`${serverUrl}/api/tracks`, {
        method: "DELETE",
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

  const exportShortTracksData = () => {
    const exportData = {
      confirmed_short_tracks: [...confirmedShortTracks],
      search_results: shortTracksSearchResults,
      export_date: new Date().toISOString(),
      min_track_length_minutes: minTrackLengthMinutes,
      version: "1.0",
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `short-tracks-data-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    Spicetify.showNotification("Short tracks data exported successfully");
  };

  const importShortTracksData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target?.result as string);

        // Validate the import data structure
        if (
          !importData.version ||
          !importData.confirmed_short_tracks ||
          !importData.search_results
        ) {
          Spicetify.showNotification("Invalid backup file format", true);
          return;
        }

        // Ask user for confirmation
        const confirmImport = window.confirm(
          `This will import ${importData.confirmed_short_tracks.length} confirmed tracks and ${
            Object.keys(importData.search_results).length
          } search results. Continue?`
        );

        if (confirmImport) {
          // Import confirmed tracks
          const newConfirmedTracks = new Set(importData.confirmed_short_tracks as string[]);
          setConfirmedShortTracks(newConfirmedTracks);
          localStorage.setItem(
            "tagify:confirmedShortTracks",
            JSON.stringify([...newConfirmedTracks])
          );

          // Import search results
          setShortTracksSearchResults(importData.search_results);

          Spicetify.showNotification(
            `Successfully imported ${
              importData.confirmed_short_tracks.length
            } confirmed tracks and ${Object.keys(importData.search_results).length} search results`
          );
        }
      } catch (error) {
        console.error("Error importing backup:", error);
        Spicetify.showNotification("Error importing backup file", true);
      }
    };
    reader.readAsText(file);

    // Reset the input
    event.target.value = "";
  };

  const clearAllShortTracksData = () => {
    setShowClearConfirmation(true);
  };

  const confirmClearAllData = () => {
    setConfirmedShortTracks(new Set());
    setShortTracksSearchResults({});
    localStorage.removeItem("tagify:confirmedShortTracks");
    localStorage.removeItem("tagify:shortTracksSearchResults");
    setShowClearConfirmation(false);
    Spicetify.showNotification("All short tracks data cleared");
  };

  const AllPlaylistsView = () => {
    const allPlaylists = getFilteredPlaylists();

    const getPlaylistStatusIcon = (playlist: PlaylistIssue) => {
      if (!playlist.has_m3u) {
        return (
          <span className={styles.statusMissing} title="Missing M3U file">
            ⚠️
          </span>
        );
      }
      if (playlist.needs_update) {
        return (
          <span className={styles.statusIssues} title="Has issues">
            ❌
          </span>
        );
      }
      return (
        <span className={styles.statusGood} title="No issues">
          ✅
        </span>
      );
    };

    const getPlaylistSummary = (playlist: PlaylistIssue) => {
      if (!playlist.has_m3u) {
        return "Missing M3U file";
      }
      if (!playlist.needs_update) {
        return "Up to date";
      }

      const issues = [];
      if (playlist.tracks_missing_from_m3u.length > 0) {
        issues.push(`${playlist.tracks_missing_from_m3u.length} missing`);
      }
      if (playlist.unexpected_tracks_in_m3u.length > 0) {
        issues.push(`${playlist.unexpected_tracks_in_m3u.length} unexpected`);
      }
      if (playlist.not_downloaded_tracks?.length > 0) {
        issues.push(`${playlist.not_downloaded_tracks.length} not downloaded`);
      }

      return issues.join(", ");
    };

    return (
      <div className={styles.allPlaylistsContainer}>
        <div className={styles.allPlaylistsList}>
          {allPlaylists.map((playlist, index) => (
            <div key={index} className={styles.allPlaylistItem}>
              <div className={styles.playlistStatusLine}>
                {getPlaylistStatusIcon(playlist)}
                <div className={styles.playlistInfo}>
                  <div className={styles.playlistName}>
                    {playlist.name}
                    {playlist.location && playlist.location !== "root" && (
                      <span className={styles.playlistLocation}>({playlist.location})</span>
                    )}
                  </div>
                  <div className={styles.playlistSummary}>
                    {getPlaylistSummary(playlist)}
                    <span className={styles.trackCounts}>
                      • DB: {playlist.total_associations}• Local: {playlist.tracks_with_local_files}
                      {playlist.has_m3u && ` • M3U: ${playlist.m3u_track_count}`}
                    </span>
                  </div>
                </div>
                <div className={styles.playlistActions}>
                  <button
                    className={styles.regenerateButton}
                    onClick={() => regeneratePlaylist(playlist.id)}
                    disabled={!playlist.has_m3u && playlist.total_associations === 0}
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const TrackIssuesSummary = () => {
    const problematicTracks = getProblematicTracksSummary();
    const issueTypes = {
      all: problematicTracks.length,
      "not-downloaded": problematicTracks.filter((t) => t.notDownloaded).length,
      "missing-from-m3u": problematicTracks.filter((t) => t.missingFromM3u).length,
      "unexpected-in-m3u": problematicTracks.filter((t) => t.unexpectedInM3u).length,
      "local-files": problematicTracks.filter((t) => t.isLocal).length,
    };

    return (
      <div className={styles.trackSummaryContainer}>
        <div className={styles.summaryHeader}>
          <h4>Problematic Tracks Summary ({problematicTracks.length} tracks)</h4>
          <div className={styles.summaryFilters}>
            <div className={styles.filterGroup}>
              <label>Filter by issue type:</label>
              <select
                value={trackSummaryFilter}
                onChange={(e) => setTrackSummaryFilter(e.target.value)}
                className={styles.filterSelect}
              >
                <option value="all">All Issues ({issueTypes.all})</option>
                <option value="not-downloaded">
                  Not Downloaded ({issueTypes["not-downloaded"]})
                </option>
                <option value="missing-from-m3u">
                  Missing from M3U ({issueTypes["missing-from-m3u"]})
                </option>
                <option value="unexpected-in-m3u">
                  Unexpected in M3U ({issueTypes["unexpected-in-m3u"]})
                </option>
                <option value="local-files">Local Files ({issueTypes["local-files"]})</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label>Sort by:</label>
              <select
                value={trackSummarySort}
                onChange={(e) => setTrackSummarySort(e.target.value)}
                className={styles.filterSelect}
              >
                <option value="playlists-desc">Most Affected Playlists</option>
                <option value="playlists-asc">Least Affected Playlists</option>
                <option value="title-asc">Title (A-Z)</option>
                <option value="title-desc">Title (Z-A)</option>
                <option value="artist-asc">Artist (A-Z)</option>
                <option value="artist-desc">Artist (Z-A)</option>
              </select>
            </div>
          </div>
        </div>

        {problematicTracks.length > 0 ? (
          <div className={styles.tracksList}>
            {problematicTracks.map((track, index) => (
              <div key={index} className={styles.summaryTrackItem}>
                <div className={styles.trackInfo}>
                  <div className={styles.trackTitle}>
                    <strong>{track.artists}</strong> - {track.title}
                    {track.isLocal && <span className={styles.localBadge}>Local File</span>}
                  </div>
                  {track.album && <div className={styles.trackAlbum}>{track.album}</div>}
                  <div className={styles.issueCount}>
                    <span className={styles.playlistCount}>
                      In {track.playlistsCount} playlist{track.playlistsCount !== 1 ? "s" : ""}
                    </span>
                    <div className={styles.issueTypes}>
                      {track.notDownloaded && (
                        <span className={styles.issueType}>Not Downloaded</span>
                      )}
                      {track.missingFromM3u && (
                        <span className={styles.issueType}>Missing from M3U</span>
                      )}
                      {track.unexpectedInM3u && (
                        <span className={styles.issueType}>Unexpected in M3U</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className={styles.playlistsList}>
                  <div className={styles.playlistsHeader}>Affected playlists:</div>
                  <div className={styles.playlistsNames}>
                    {track.playlistNames.slice(0, 3).join(", ")}
                    {track.playlistNames.length > 3 && (
                      <span className={styles.morePlaylistsBadge}>
                        +{track.playlistNames.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.noIssues}>No tracks matching the selected filter</div>
        )}
      </div>
    );
  };

  const ShortTracksView: React.FC<{
    shortTracks: ShortTrack[];
    onConfirmTrack: (filePath: string) => void;
    onSearchExtended: (track: ShortTrack) => void;
    serverUrl: string;
  }> = ({ shortTracks, onConfirmTrack, onSearchExtended, serverUrl }) => {
    const [selectedTrack, setSelectedTrack] = useState<ShortTrack | null>(null);

    return (
      <div className={styles.splitView}>
        <div className={styles.shortTracksList}>
          {shortTracks.map((track, index) => (
            <div
              key={index}
              className={`${styles.shortTrackItem} ${
                selectedTrack && selectedTrack.full_path === track.full_path ? styles.selected : ""
              }`}
              onClick={() => setSelectedTrack(track)}
            >
              <div className={styles.trackInfo}>
                <div className={styles.trackTitle}>
                  {track.artist} - {track.title}
                </div>
                <div className={styles.trackDuration}>{track.duration_formatted}</div>
                <div className={styles.trackFile}>{track.file}</div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.trackDetailPanel}>
          {selectedTrack ? (
            <div>
              <h3>Track Details</h3>
              <div className={styles.currentInfo}>
                <div>
                  <strong>Artist:</strong> {selectedTrack.artist}
                </div>
                <div>
                  <strong>Title:</strong> {selectedTrack.title}
                </div>
                <div>
                  <strong>Duration:</strong> {selectedTrack.duration_formatted}
                </div>
                <div>
                  <strong>File:</strong> {selectedTrack.file}
                </div>
              </div>

              <div className={styles.actionButtons}>
                <button
                  className={styles.primaryButton}
                  onClick={() => onSearchExtended(selectedTrack)}
                >
                  Search for Extended Versions
                </button>
                <button
                  className={styles.acceptButton}
                  onClick={() => onConfirmTrack(selectedTrack.full_path)}
                >
                  Confirm as Correct Length
                </button>
              </div>

              {selectedTrack.extended_versions_found.length > 0 && (
                <div className={styles.extendedVersions}>
                  <h4>Extended Versions Found:</h4>
                  {selectedTrack.extended_versions_found.map((version, idx) => (
                    <div key={idx} className={styles.extendedVersion}>
                      <div>
                        <strong>{version.title}</strong> - {version.duration_formatted}
                      </div>
                      <div>
                        Release: {version.release_title} ({version.release_year})
                      </div>
                      <div>Mix Type: {version.mix_type}</div>
                      <div>Labels: {version.labels.join(", ")}</div>
                      <a href={version.discogs_url} target="_blank" rel="noopener noreferrer">
                        View on Discogs
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className={styles.noSelection}>
              Select a short track to see details and search for extended versions.
            </div>
          )}
        </div>
      </div>
    );
  };

  const ConfirmedShortTracksView: React.FC<{
    confirmedTracks: ShortTrack[];
    onUnconfirmTrack: (filePath: string) => void;
  }> = ({ confirmedTracks, onUnconfirmTrack }) => {
    return (
      <div className={styles.confirmedTracksList}>
        {confirmedTracks.length > 0 ? (
          confirmedTracks.map((track, index) => (
            <div key={index} className={styles.confirmedTrackItem}>
              <div className={styles.trackInfo}>
                <div className={styles.trackTitle}>
                  {track.artist} - {track.title}
                </div>
                <div className={styles.trackDuration}>{track.duration_formatted}</div>
              </div>
              <button
                className={styles.removeButton}
                onClick={() => onUnconfirmTrack(track.full_path)}
              >
                Remove
              </button>
            </div>
          ))
        ) : (
          <div className={styles.noIssues}>
            No confirmed short tracks. Mark tracks as correct length to see them here.
          </div>
        )}
      </div>
    );
  };

  const ShortTracksSection: React.FC<{
    title: string;
    tracks: ShortTrack[];
    onConfirmTrack: (filePath: string) => void;
    onSearchExtended: (track: ShortTrack) => void;
    onMarkAsNeedsExtended?: (track: ShortTrack) => void;
    showSearchButton: boolean;
    onCreatePlaylist?: () => void;
    isCreatingPlaylist?: boolean;
    showCreatePlaylistButton?: boolean;
  }> = ({
    title,
    tracks,
    onConfirmTrack,
    onSearchExtended,
    onMarkAsNeedsExtended,
    showSearchButton,
    onCreatePlaylist,
    isCreatingPlaylist = false,
    showCreatePlaylistButton = false,
  }) => {
    const [selectedTrack, setSelectedTrack] = useState<ShortTrack | null>(null);

    useEffect(() => {
      // If we have a selected track but it's no longer in the tracks array,
      // try to find it by full_path and update the reference
      if (selectedTrack && !tracks.find((t) => t.full_path === selectedTrack.full_path)) {
        setSelectedTrack(null);
      } else if (selectedTrack) {
        // Update the selected track reference if the data has changed
        const updatedTrack = tracks.find((t) => t.full_path === selectedTrack.full_path);
        if (updatedTrack && updatedTrack !== selectedTrack) {
          setSelectedTrack(updatedTrack);
        }
      }
    }, [tracks, selectedTrack]);

    const getStatusIcon = (track: ShortTrack) => {
      switch (track.status_type) {
        case "searching":
          return <span className={styles.searchingIcon}>⏳</span>;
        case "extended_found":
          return <span className={styles.foundIcon}>✅</span>;
        case "no_extended":
          return <span className={styles.noExtendedIcon}>📋</span>;
        case "not_found":
          return <span className={styles.notFoundIcon}>❌</span>;
        case "error":
          return <span className={styles.errorIcon}>⚠️</span>;
        default:
          return null;
      }
    };

    return (
      <div className={styles.shortTracksSection}>
        {tracks.length > 0 ? (
          <div className={styles.splitView}>
            <div className={styles.tracksList}>
              <div
                className={
                  showCreatePlaylistButton
                    ? styles.sectionHeaderWithButton
                    : styles.sectionTitleContainer
                }
              >
                <h4 className={styles.sectionTitle}>
                  {title} ({tracks.length})
                </h4>
                {showCreatePlaylistButton && onCreatePlaylist && (
                  <button
                    className={styles.createPlaylistButton}
                    onClick={onCreatePlaylist}
                    disabled={isCreatingPlaylist || tracks.filter((t) => t.track_id).length === 0}
                    title={`Create playlist from ${
                      tracks.filter((t) => t.track_id).length
                    } tracks with TrackIDs`}
                  >
                    {isCreatingPlaylist ? "Creating..." : "Create Playlist"}
                  </button>
                )}
              </div>
              <div className={styles.tracksContainer}>
                {tracks.map((track, index) => (
                  <div
                    key={track.full_path}
                    className={`${styles.shortTrackItem} ${
                      track.has_longer_versions ? styles.hasExtended : ""
                    } ${
                      selectedTrack && selectedTrack.full_path === track.full_path
                        ? styles.selected
                        : ""
                    }`}
                    onClick={() => setSelectedTrack(track)}
                  >
                    <div className={styles.trackInfo}>
                      <div className={styles.trackTitle}>
                        {track.artist} - {track.title}
                      </div>
                      <div className={styles.trackDuration}>{track.duration_formatted}</div>
                      {track.status_message && (
                        <div className={styles.statusMessage}>
                          {getStatusIcon(track)} {track.status_message}
                        </div>
                      )}
                      {track.has_longer_versions && (
                        <div className={styles.extendedCount}>
                          {track.extended_versions_found.length} extended version(s) found
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.trackDetailPanel}>
              {selectedTrack ? (
                <div>
                  <h3>Track Details</h3>
                  <div className={styles.currentInfo}>
                    <div>
                      <strong>Artist:</strong> {selectedTrack.artist}
                    </div>
                    <div>
                      <strong>Title:</strong> {selectedTrack.title}
                    </div>
                    <div>
                      <strong>Duration:</strong> {selectedTrack.duration_formatted}
                    </div>
                    <div>
                      <strong>File:</strong> {selectedTrack.file}
                    </div>
                    {selectedTrack.status_message && (
                      <div>
                        <strong>Status:</strong> {selectedTrack.status_message}
                      </div>
                    )}
                    {selectedTrack.total_versions_found &&
                      selectedTrack.total_versions_found > 0 && (
                        <div>
                          <strong>Total Versions Found:</strong>{" "}
                          {selectedTrack.total_versions_found}
                        </div>
                      )}
                  </div>

                  <div className={styles.actionButtons}>
                    {showSearchButton && (
                      <button
                        className={styles.primaryButton}
                        onClick={() => onSearchExtended(selectedTrack)}
                        disabled={selectedTrack.status_type === "searching"}
                      >
                        {selectedTrack.status_type === "searching"
                          ? "Searching..."
                          : "Search for Extended Versions"}
                      </button>
                    )}
                    {onMarkAsNeedsExtended && (
                      <button
                        className={styles.secondaryButton}
                        onClick={() => onMarkAsNeedsExtended(selectedTrack)}
                        disabled={selectedTrack.manually_marked_extended}
                      >
                        {selectedTrack.manually_marked_extended
                          ? "Already Marked"
                          : "Needs Extended"}
                      </button>
                    )}
                    <button
                      className={styles.acceptButton}
                      onClick={() => onConfirmTrack(selectedTrack.full_path)}
                    >
                      Confirm as Correct Length
                    </button>
                  </div>

                  {selectedTrack.extended_versions_found.length > 0 && (
                    <div className={styles.extendedVersions}>
                      <h4>Extended Versions Found:</h4>
                      {selectedTrack.extended_versions_found.map((version, idx) => (
                        <div key={idx} className={styles.extendedVersion}>
                          <div>
                            <strong>{version.title}</strong> - {version.duration_formatted}
                          </div>
                          <div>
                            Release: {version.release_title} ({version.release_year})
                          </div>
                          <div>Mix Type: {version.mix_type}</div>
                          <div>Labels: {version.labels.join(", ")}</div>
                          <a href={version.discogs_url} target="_blank" rel="noopener noreferrer">
                            View on Discogs
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.noSelection}>Select a track to see details and options.</div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.noIssues}>No tracks in this category.</div>
        )}
      </div>
    );
  };

  const renderShortTracksSection = () => {
    switch (shortTracksSection) {
      case "unsearched":
        return (
          <ShortTracksSection
            title="Unsearched Tracks"
            tracks={unsearchedTracks}
            onConfirmTrack={confirmShortTrack}
            onSearchExtended={searchExtendedVersions}
            showSearchButton={true}
          />
        );
      case "no-extended":
        return (
          <ShortTracksSection
            title="No Extended Versions Found"
            tracks={tracksWithoutExtended}
            onConfirmTrack={confirmShortTrack}
            onSearchExtended={searchExtendedVersions}
            onMarkAsNeedsExtended={markAsNeedsExtended}
            showSearchButton={true}
          />
        );
      case "extended-found":
        return (
          <ShortTracksSection
            title="Extended Versions Found"
            tracks={tracksWithExtended}
            onConfirmTrack={confirmShortTrack}
            onSearchExtended={searchExtendedVersions}
            onCreatePlaylist={createPlaylistFromExtendedTracks}
            isCreatingPlaylist={isCreatingPlaylist}
            showSearchButton={false}
            showCreatePlaylistButton={true}
          />
        );
      case "confirmed-short":
        return (
          <ConfirmedShortTracksView
            confirmedTracks={confirmedShortTracksList}
            onUnconfirmTrack={unconfirmShortTrack}
          />
        );
      default:
        return null;
    }
  };

  const PlaylistCreationResultModal: React.FC<{
    result: any;
    onClose: () => void;
  }> = ({ result, onClose }) => {
    return (
      <Portal>
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Playlist Creation Results</h3>
              <button className={styles.modalCloseButton} onClick={onClose}>
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.playlistInfo}>
                <h4>Playlist: {result.playlist_name}</h4>
                <p>
                  <strong>Successfully added:</strong> {result.tracks_added} /{" "}
                  {result.tracks_requested} tracks
                </p>
                <a
                  href={result.playlist_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.playlistLink}
                >
                  Open in Spotify
                </a>
              </div>

              {result.failed_tracks_count > 0 && (
                <div className={styles.failedTracksSection}>
                  <h4>Failed Tracks ({result.failed_tracks_count})</h4>
                  <div className={styles.failedTracksList}>
                    {result.failed_tracks.map((track: any, index: number) => (
                      <div key={index} className={styles.failedTrackItem}>
                        <div className={styles.trackInfo}>
                          <strong>
                            {track.artist} - {track.title}
                          </strong>
                          <div className={styles.trackAlbum}>{track.album}</div>
                          <div className={styles.trackId}>Track ID: {track.track_id}</div>
                        </div>
                        <div className={styles.errorInfo}>
                          <strong>Error:</strong> {track.error}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.modalActions}>
                <button className={styles.primaryButton} onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleWithStatus}>
          <h2>Track & Playlist Validation</h2>
          <span className={styles.lastUpdated}>{getLastUpdatedText()}</span>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.refreshButton}
            onClick={handleManualRefresh}
            disabled={isLoading}
          >
            {isLoading ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>
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
                  <span className={styles.label}>Files with Mapping:</span>
                  <span className={styles.value}>
                    {trackValidationResult.summary.files_with_track_id}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Files without Mapping:</span>
                  <span className={styles.value}>
                    {trackValidationResult.summary.files_without_track_id}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Potential Mismatches:</span>
                  <span
                    className={`${styles.value} ${
                      getFilteredMismatchesByConfidence(
                        trackValidationResult?.potential_mismatches || [],
                        confidenceThreshold
                      ).length > 0
                        ? styles.warning
                        : ""
                    }`}
                  >
                    {
                      getFilteredMismatchesByConfidence(
                        trackValidationResult?.potential_mismatches || [],
                        confidenceThreshold
                      ).length
                    }{" "}
                    / {trackValidationResult?.summary.potential_mismatches || 0}
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

              {/* POTENTIAL MISMATCHES BUTTON */}
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
                {/* MISSING MAPPING BUTTON */}
                <button
                  className={`${styles.tab} ${currentSection === "missing" ? styles.active : ""}`}
                  onClick={() => {
                    setCurrentSection("missing");
                    setSelectedDuplicateTrackId(null); // TOOD: REMOVE or replace this
                    setSelectedMismatch(null);

                    // Select first item if available
                    if (filesMissingTrackId.length > 0) {
                      handleSelectMismatch(filesMissingTrackId[0]);
                    }
                  }}
                >
                  Missing Mapping ({filesMissingTrackId.length})
                </button>
                {/* CONFIRMED TRACKS BUTTON */}
                <button
                  className={`${styles.tab} ${currentSection === "ignored" ? styles.active : ""}`}
                  onClick={() => {
                    setCurrentSection("ignored");
                    setSelectedDuplicateTrackId(null);
                    setSelectedMismatch(null);

                    // Show all ignored tracks (no confidence filtering)
                    const allIgnoredTracks =
                      trackValidationResult?.potential_mismatches.filter((mismatch) =>
                        ignoredTrackPaths.has(mismatch.full_path)
                      ) || [];

                    setFilteredMismatches(allIgnoredTracks);

                    if (allIgnoredTracks.length > 0) {
                      handleSelectMismatch(allIgnoredTracks[0]);
                    }
                  }}
                >
                  Confirmed Tracks ({ignoredTrackPaths.size})
                </button>
                {/* DUPLICATE MAPPINGS BUTTON */}
                <button
                  className={`${styles.tab} ${
                    currentSection === "duplicates" ? styles.active : ""
                  }`}
                  onClick={() => {
                    setCurrentSection("duplicates");
                    setSelectedMismatch(null);
                    setSelectedDuplicateTrackId(null);

                    // Select first duplicate URI if available
                    const duplicateUris = Object.keys(
                      trackValidationResult?.duplicate_track_ids || {}
                    );
                    if (duplicateUris.length > 0) {
                      setSelectedDuplicateTrackId(duplicateUris[0]);
                    }
                  }}
                >
                  Duplicate Mappings ({trackValidationResult?.summary.duplicate_track_ids || 0})
                </button>
                {/* SEARCH TRACKS BUTTON */}
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

              {currentSection === "duplicates" ? (
                // Show duplicate URI mappings
                <div className={styles.duplicatesContainer}>
                  <h3>Duplicate Mappings</h3>
                  {Object.keys(trackValidationResult?.duplicate_track_ids || {}).length > 0 ? (
                    <div className={styles.splitView}>
                      <div className={styles.duplicatesList}>
                        <h4>Tracks with Multiple File Mappings:</h4>
                        {Object.entries(trackValidationResult?.duplicate_track_ids || {}).map(
                          ([uri, duplicateInfo]) => (
                            <div
                              key={uri}
                              className={`${styles.duplicateItem} ${
                                selectedDuplicateTrackId === uri ? styles.selected : ""
                              }`}
                              onClick={() => setSelectedDuplicateTrackId(uri)}
                            >
                              <div className={styles.duplicateHeader}>
                                <strong>{duplicateInfo.track_title}</strong>
                                <span className={styles.fileCount}>
                                  ({duplicateInfo.files.length} files)
                                </span>
                              </div>
                              <div className={styles.duplicateUri}>URI: {uri}</div>
                            </div>
                          )
                        )}
                      </div>

                      <div className={styles.duplicateDetail}>
                        {selectedDuplicateTrackId &&
                          trackValidationResult?.duplicate_track_ids[selectedDuplicateTrackId] && (
                            <>
                              <h3>Files mapped to this track:</h3>
                              <h4>
                                {trackValidationResult.duplicate_track_ids[selectedDuplicateTrackId]
                                  ?.track_title || "Unknown Track"}
                              </h4>
                              <div className={styles.duplicateUri}>
                                <strong>URI:</strong> {selectedDuplicateTrackId}
                              </div>
                              <div className={styles.filesList}>
                                {trackValidationResult.duplicate_track_ids[
                                  selectedDuplicateTrackId
                                ]?.files.map((file, index) => (
                                  <div key={index} className={styles.fileItem}>
                                    <div className={styles.fileInfo}>
                                      <div className={styles.fileName}>{file.filename}</div>
                                      <div className={styles.fileMeta}>
                                        <span
                                          className={
                                            file.duration < 5 * 60
                                              ? styles.fileDurationShort
                                              : styles.fileDuration
                                          }
                                        >
                                          {file.duration_formatted}
                                        </span>
                                        <span className={styles.fileSize}>
                                          {file.file_size
                                            ? `${(file.file_size / (1024 * 1024)).toFixed(1)}MB`
                                            : "Unknown size"}
                                        </span>
                                        <span className={styles.fileModified}>
                                          {file.last_modified
                                            ? new Date(file.last_modified).toLocaleDateString()
                                            : "Unknown date"}
                                        </span>
                                      </div>
                                      <div className={styles.filePath}>{file.path}</div>
                                    </div>
                                    <button
                                      className={styles.removeButton}
                                      onClick={() =>
                                        removeDuplicateMapping(file.path, selectedDuplicateTrackId)
                                      }
                                      title="Remove this mapping"
                                    >
                                      Remove Mapping
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <div className={styles.duplicateWarning}>
                                <p>
                                  Having multiple files mapped to the same Spotify track may cause
                                  inconsistent playlist behavior. Consider removing duplicate
                                  mappings or keeping only the best quality file.
                                </p>
                              </div>
                            </>
                          )}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.noIssues}>
                      No duplicate mappings found! Each Spotify track is mapped to only one file.
                    </div>
                  )}
                </div>
              ) : currentSection === "missing" ? (
                // Missing Mapping section
                <div className={styles.mismatchesContainer}>
                  <h3>Files Missing Mapping</h3>

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
                                    <strong>Full Path:</strong> {selectedMismatch.full_path}
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
                                          {match.album && (
                                            <div className={styles.matchConfidence}>
                                              Album: {match.album}
                                            </div>
                                          )}
                                          <div className={styles.matchTrackId}>
                                            TrackId: {match.track_id}
                                          </div>
                                          <div className={styles.matchConfidence}>
                                            Confidence: {(match.confidence * 100).toFixed(2)}%
                                          </div>
                                        </div>
                                        <button
                                          className={styles.applyButton}
                                          onClick={() =>
                                            createFileMapping(
                                              selectedMismatch.full_path,
                                              match.uri,
                                              match
                                            )
                                          }
                                        >
                                          Create Mapping
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
                            Select a file missing mapping from the list to see options for creating
                            a mapping.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.noIssues}>
                      No files missing mapping found! All files have entries in the
                      FileTrackMappings table.
                    </div>
                  )}
                </div>
              ) : currentSection === "ignored" ? (
                // Confirmed Tracks section
                <div className={styles.mismatchesContainer}>
                  {trackValidationResult?.potential_mismatches.filter((mismatch) =>
                    ignoredTrackPaths.has(mismatch.full_path)
                  ).length > 0 ? (
                    <div className={styles.splitView}>
                      <div className={styles.mismatchList}>
                        {trackValidationResult.potential_mismatches
                          .filter((mismatch) => ignoredTrackPaths.has(mismatch.full_path))
                          .slice(0, page * pageSize)
                          .map((mismatch, index) => (
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
                                  <strong>Mapped to:</strong> {mismatch.track_info}
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

                        {trackValidationResult.potential_mismatches.filter((mismatch) =>
                          ignoredTrackPaths.has(mismatch.full_path)
                        ).length >
                          page * pageSize && (
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
                                <strong>URI:</strong> {selectedMismatch.uri}
                              </div>
                              <div>
                                <strong>Mapped to:</strong> {selectedMismatch.track_info}
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
                      No confirmed tracks found. Mark tracks as correctly mapped to see them here.
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
                      onKeyDown={(e) => e.key === "Enter" && searchTracks()}
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
                                  <strong>Mapped to:</strong> {result.track_info}
                                </div>
                                <div>
                                  <strong>URI:</strong> {result.uri || "No URI"}
                                </div>
                                <div>
                                  <strong>Confidence:</strong>{" "}
                                  {(result.confidence * 100).toFixed(2)}%
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
                                  <strong>Mapped to:</strong> {selectedMismatch.track_info}
                                </div>
                                <div>
                                  <strong>URI:</strong> {selectedMismatch.uri || "No URI"}
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
                                ></div>
                              </div>

                              <div className={styles.actionButtons}>
                                {selectedMismatch.uri && (
                                  <button
                                    className={styles.removeButton}
                                    onClick={() => removeFileMapping(selectedMismatch.full_path)}
                                  >
                                    Remove File Mapping
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
                                          Confidence: {(match.confidence * 100).toFixed(2)}%
                                        </div>
                                      </div>
                                      <button
                                        className={styles.applyButton}
                                        onClick={() =>
                                          createFileMapping(
                                            selectedMismatch.full_path,
                                            match.uri,
                                            match
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
                        onChange={(e) => {
                          setConfidenceThreshold(parseFloat(e.target.value));
                          if (trackValidationResult?.potential_mismatches) {
                            updateFilteredMismatches(
                              trackValidationResult.potential_mismatches,
                              ignoredTrackPaths,
                              false // don't show ignored tracks in this section
                            );
                          }
                        }}
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
                                  <strong>Mapped to:</strong> {mismatch.track_info}
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
                                      <strong>Mapped to:</strong> {selectedMismatch.track_info}
                                    </div>
                                    <div>
                                      <strong>URI:</strong> {selectedMismatch.uri}
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
                                          Mark as Correctly Mapped
                                        </button>
                                        <button
                                          className={styles.removeButton}
                                          onClick={() =>
                                            removeFileMapping(selectedMismatch.full_path)
                                          }
                                        >
                                          Remove File Mapping
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
                                        onClick={() =>
                                          removeFileMapping(selectedMismatch.full_path)
                                        }
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
                                              Confidence: {(match.confidence * 100).toFixed(2)}%
                                            </div>
                                          </div>
                                          <button
                                            className={styles.applyButton}
                                            onClick={() =>
                                              createFileMapping(
                                                selectedMismatch.full_path,
                                                match.uri,
                                                match
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
                          ? "No confirmed tracks found. Mark tracks as correctly mapped to see them here."
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
                <div className={styles.playlistHeader}>
                  <h3>Playlist Analysis</h3>
                  <div className={styles.viewButtons}>
                    <button
                      className={`${styles.viewButton} ${
                        currentView === "playlists" ? styles.active : ""
                      }`}
                      onClick={() => setCurrentView("playlists")}
                    >
                      Issues Only ({playlistValidationResult.summary.playlists_needing_update})
                    </button>
                    <button
                      className={`${styles.viewButton} ${
                        currentView === "tracks" ? styles.active : ""
                      }`}
                      onClick={() => setCurrentView("tracks")}
                    >
                      Track Summary
                    </button>
                    <button
                      className={`${styles.viewButton} ${
                        currentView === "playlist-structure" ? styles.active : ""
                      }`}
                      onClick={() => setCurrentView("playlist-structure")}
                    >
                      Playlist Structure
                    </button>
                    <button
                      className={`${styles.viewButton} ${
                        currentView === "all-playlists" ? styles.active : ""
                      }`}
                      onClick={() => setCurrentView("all-playlists")}
                    >
                      All Playlists ({playlistValidationResult.summary.total_playlists})
                    </button>
                  </div>
                </div>
                <div className={styles.searchBox}>
                  <input
                    type="text"
                    placeholder="Search playlists..."
                    value={playlistSearchQuery}
                    onChange={(e) => setPlaylistSearchQuery(e.target.value)}
                    className={styles.searchInput}
                  />
                  {playlistSearchQuery && (
                    <button
                      className={styles.clearSearchButton}
                      onClick={() => setPlaylistSearchQuery("")}
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
                {playlistValidationResult.playlist_analysis?.length > 0 ? (
                  currentView === "tracks" ? (
                    <TrackIssuesSummary />
                  ) : currentView === "all-playlists" ? (
                    <AllPlaylistsView />
                  ) : currentView === "playlist-structure" ? (
                    <PlaylistStructureView
                      serverUrl={serverUrl}
                      playlistsDir={playlistsDir}
                      masterTracksDir={masterTracksDir}
                      onRefresh={onRefresh}
                    />
                  ) : (
                    <div className={styles.playlistList}>
                      {getFilteredPlaylists()
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
                                        Math.abs(playlist.total_discrepancy) > 0
                                          ? styles.warning
                                          : ""
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
                  )
                ) : (
                  <div className={styles.noIssues}>No playlists found to analyze.</div>
                )}
              </div>
            </div>
          )}
          {currentTab === "short-tracks" && shortTracksValidationResult && (
            <div className={styles.shortTracksValidation}>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Total Files:</span>
                  <span className={styles.value}>
                    {shortTracksValidationResult.summary.total_files}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Short Tracks:</span>
                  <span
                    className={`${styles.value} ${
                      shortTracksValidationResult.summary.short_tracks > 0 ? styles.warning : ""
                    }`}
                  >
                    {shortTracksValidationResult.summary.short_tracks}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Minimum Length:</span>
                  <span className={styles.value}>
                    {shortTracksValidationResult.summary.min_length_minutes} minutes
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Confirmed Short Tracks:</span>
                  <span className={styles.value}>{confirmedShortTracks.size}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.label}>Search Results:</span>
                  <span className={styles.value}>
                    {Object.keys(shortTracksSearchResults).length}
                  </span>
                </div>
              </div>

              <div className={styles.actionButtons}>
                <button className={styles.primaryButton} onClick={exportShortTracksData}>
                  Export Backup File
                </button>
                <input
                  type="file"
                  accept=".json"
                  onChange={importShortTracksData}
                  className={styles.fileInput}
                  id="import-short-tracks-main"
                />
                <label htmlFor="import-short-tracks-main" className={styles.primaryButton}>
                  Import Backup File
                </label>
                <button className={styles.dangerButton} onClick={clearAllShortTracksData}>
                  Clear All Data
                </button>
                <button
                  className={styles.primaryButton}
                  onClick={searchAllUnsearchedTracks}
                  disabled={bulkSearchState.isRunning || unsearchedTracks.length === 0}
                >
                  {bulkSearchState.isRunning
                    ? `Searching... (${bulkSearchState.currentIndex + 1}/${
                        bulkSearchState.totalTracks
                      })`
                    : `Search All Unsearched (${unsearchedTracks.length})`}
                </button>
                {bulkSearchState.isRunning && (
                  <button className={styles.dangerButton} onClick={cancelBulkSearch}>
                    Cancel Search
                  </button>
                )}
              </div>

              {bulkSearchState.isRunning && (
                <div className={styles.bulkSearchProgress}>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${
                          (bulkSearchState.currentIndex / bulkSearchState.totalTracks) * 100
                        }%`,
                      }}
                    ></div>
                  </div>
                  <div className={styles.progressText}>
                    Searching track {bulkSearchState.currentIndex + 1} of{" "}
                    {bulkSearchState.totalTracks}
                    {bulkSearchState.currentTrack && (
                      <div className={styles.currentTrackText}>
                        {bulkSearchState.currentTrack.artist} - {bulkSearchState.currentTrack.title}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.tabs}>
                <button
                  className={`${styles.tab} ${
                    shortTracksSection === "unsearched" ? styles.active : ""
                  }`}
                  onClick={() => setShortTracksSection("unsearched")}
                >
                  Unsearched ({unsearchedTracks.length})
                </button>
                <button
                  className={`${styles.tab} ${
                    shortTracksSection === "no-extended" ? styles.active : ""
                  }`}
                  onClick={() => setShortTracksSection("no-extended")}
                >
                  No Extended Versions ({tracksWithoutExtended.length})
                </button>
                <button
                  className={`${styles.tab} ${
                    shortTracksSection === "extended-found" ? styles.active : ""
                  }`}
                  onClick={() => setShortTracksSection("extended-found")}
                >
                  Extended Versions Found ({tracksWithExtended.length})
                </button>
                <button
                  className={`${styles.tab} ${
                    shortTracksSection === "confirmed-short" ? styles.active : ""
                  }`}
                  onClick={() => setShortTracksSection("confirmed-short")}
                >
                  Confirmed Short Tracks ({confirmedShortTracks.size})
                </button>
              </div>

              {renderShortTracksSection()}
            </div>
          )}
          {showClearConfirmation && (
            <Portal>
              <div className={styles.modalOverlay}>
                <div className={styles.modal}>
                  <div className={styles.modalHeader}>
                    <h3 className={styles.modalTitle}>Confirm Clear All Data</h3>
                    <button
                      className={styles.modalCloseButton}
                      onClick={() => setShowClearConfirmation(false)}
                    >
                      ×
                    </button>
                  </div>
                  <div className={styles.modalBody}>
                    <p className={styles.warningText}>
                      This will permanently delete all confirmed short tracks (
                      {confirmedShortTracks.size}) and search results (
                      {Object.keys(shortTracksSearchResults).length}). This action cannot be undone.
                    </p>
                    <p>Are you sure you want to continue?</p>

                    <div className={styles.actionButtons}>
                      <button className={styles.dangerButton} onClick={confirmClearAllData}>
                        Yes, Clear All Data
                      </button>
                      <button
                        className={styles.primaryButton}
                        onClick={() => setShowClearConfirmation(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Portal>
          )}
        </>
      )}
      {playlistCreationResult?.show && (
        <PlaylistCreationResultModal
          result={playlistCreationResult.data}
          onClose={() => setPlaylistCreationResult(null)}
        />
      )}
    </div>
  );
};

export default ValidationPanel;
