import React, { useState, useEffect, useRef } from "react";
import styles from "./ValidationPanel.module.css";
import { useLocalStorage } from "../hooks/useLocalStorage";

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
  const [possibleMatches, setPossibleMatches] = useState<any[]>([]);
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

  const [currentView, setCurrentView] = useState<"playlists" | "tracks" | "all-playlists">(
    "playlists"
  );
  const [trackSummaryFilter, setTrackSummaryFilter] = useState<string>("all");
  const [trackSummarySort, setTrackSummarySort] = useState<string>("playlists-desc");

  const [shortTracksValidationResult, setShortTracksValidationResult] =
    useState<ShortTracksValidationResult | null>(null);
  const [confirmedShortTracks, setConfirmedShortTracks] = useState<Set<string>>(
    new Set(JSON.parse(localStorage.getItem("tagify:confirmedShortTracks") || "[]") as string[])
  );

  const bulkSearchCancelRef = useRef(false);

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

  const [shortTracksSearchResults, setShortTracksSearchResults] = useLocalStorage<
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
      }
    >
  >("tagify:shortTracksSearchResults", {});

  const [showShortTracksBackup, setShowShortTracksBackup] = useState(false);

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

        const response = await fetch(`${serverUrl}/api/validation/track-metadata?${queryParams}`, {
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

  const getUnsearchedTracks = (): ShortTrack[] => {
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
  };

  const getTracksWithoutExtended = (): ShortTrack[] => {
    if (!shortTracksValidationResult) return [];

    return shortTracksValidationResult.short_tracks
      .filter((track) => !confirmedShortTracks.has(track.full_path))
      .map(mergeTrackWithStoredResults)
      .filter(
        (track) =>
          !track.has_longer_versions &&
          (track.status_type === "no_extended" || track.status_type === "not_found")
      );
  };

  const getTracksWithExtended = (): ShortTrack[] => {
    if (!shortTracksValidationResult) return [];

    return shortTracksValidationResult.short_tracks
      .filter((track) => !confirmedShortTracks.has(track.full_path))
      .map(mergeTrackWithStoredResults)
      .filter((track) => track.has_longer_versions);
  };

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
      };
    }

    return {
      ...track,
      status_type: "not_searched" as const,
      status_message: "Not searched yet",
      discogs_search_completed: false,
    };
  };

  const searchAllUnsearchedTracks = async () => {
    const unsearchedTracks = getUnsearchedTracks();

    if (unsearchedTracks.length === 0) {
      Spicetify.showNotification("No unsearched tracks found");
      return;
    }

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
  };

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
      const response = await fetch(`${serverUrl}/api/tracks/metadata`, {
        method: "PUT",
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
    const confirmClear = window.confirm(
      "This will clear all confirmed tracks and search results. This cannot be undone. Continue?"
    );

    if (confirmClear) {
      setConfirmedShortTracks(new Set());
      setShortTracksSearchResults({});
      localStorage.removeItem("tagify:confirmedShortTracks");
      Spicetify.showNotification("All short tracks data cleared");
    }
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
    showSearchButton: boolean;
  }> = ({ title, tracks, onConfirmTrack, onSearchExtended, showSearchButton }) => {
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
              <h4 className={styles.sectionTitle}>
                {title} ({tracks.length})
              </h4>
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

  const ShortTracksBackupPanel: React.FC<{
    onClose: () => void;
    onExport: () => void;
    onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onClear: () => void;
    confirmedCount: number;
    searchResultsCount: number;
  }> = ({ onClose, onExport, onImport, onClear, confirmedCount, searchResultsCount }) => {
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <h3 className={styles.modalTitle}>Short Tracks Data Backup</h3>
            <button className={styles.modalCloseButton} onClick={onClose}>
              ×
            </button>
          </div>
          <div className={styles.modalBody}>
            <div className={styles.backupStats}>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Confirmed Short Tracks:</span>
                <span className={styles.statValue}>{confirmedCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Search Results:</span>
                <span className={styles.statValue}>{searchResultsCount}</span>
              </div>
            </div>

            <div className={styles.backupActions}>
              <div className={styles.actionGroup}>
                <h4>Export Data</h4>
                <p>Download all confirmed tracks and search results as a backup file.</p>
                <button className={styles.primaryButton} onClick={onExport}>
                  Export Backup File
                </button>
              </div>

              <div className={styles.actionGroup}>
                <h4>Import Data</h4>
                <p>Import confirmed tracks and search results from a backup file.</p>
                <input
                  type="file"
                  accept=".json"
                  onChange={onImport}
                  className={styles.fileInput}
                  id="import-short-tracks"
                />
                <label htmlFor="import-short-tracks" className={styles.primaryButton}>
                  Import Backup File
                </label>
              </div>

              <div className={styles.actionGroup}>
                <h4>Clear All Data</h4>
                <p className={styles.warningText}>
                  This will permanently delete all confirmed tracks and search results.
                </p>
                <button className={styles.dangerButton} onClick={onClear}>
                  Clear All Data
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderShortTracksSection = () => {
    switch (shortTracksSection) {
      case "unsearched":
        return (
          <ShortTracksSection
            title="Unsearched Tracks"
            tracks={getUnsearchedTracks()}
            onConfirmTrack={confirmShortTrack}
            onSearchExtended={searchExtendedVersions}
            showSearchButton={true}
          />
        );
      case "no-extended":
        return (
          <ShortTracksSection
            title="No Extended Versions Found"
            tracks={getTracksWithoutExtended()}
            onConfirmTrack={confirmShortTrack}
            onSearchExtended={searchExtendedVersions}
            showSearchButton={true}
          />
        );
      case "extended-found":
        return (
          <ShortTracksSection
            title="Extended Versions Found"
            tracks={getTracksWithExtended()}
            onConfirmTrack={confirmShortTrack}
            onSearchExtended={searchExtendedVersions}
            showSearchButton={false}
          />
        );
      case "confirmed-short":
        return (
          <ConfirmedShortTracksView
            confirmedTracks={
              shortTracksValidationResult?.short_tracks
                .filter((track) => confirmedShortTracks.has(track.full_path))
                .map(mergeTrackWithStoredResults) || []
            }
            onUnconfirmTrack={unconfirmShortTrack}
          />
        );
      default:
        return null;
    }
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
                {/* MISSING TRACKID BUTTON */}
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
                  Missing TrackId ({filesMissingTrackId.length})
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
                {/* DUPLICATE TRACKID BUTTON */}
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
                <button
                  className={styles.primaryButton}
                  onClick={() => setShowShortTracksBackup(true)}
                >
                  Manage Backup Data
                </button>
                <button
                  className={styles.primaryButton}
                  onClick={searchAllUnsearchedTracks}
                  disabled={bulkSearchState.isRunning || getUnsearchedTracks().length === 0}
                >
                  {bulkSearchState.isRunning
                    ? `Searching... (${bulkSearchState.currentIndex + 1}/${
                        bulkSearchState.totalTracks
                      })`
                    : `Search All Unsearched (${getUnsearchedTracks().length})`}
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
                  Unsearched ({getUnsearchedTracks().length})
                </button>
                <button
                  className={`${styles.tab} ${
                    shortTracksSection === "no-extended" ? styles.active : ""
                  }`}
                  onClick={() => setShortTracksSection("no-extended")}
                >
                  No Extended Versions ({getTracksWithoutExtended().length})
                </button>
                <button
                  className={`${styles.tab} ${
                    shortTracksSection === "extended-found" ? styles.active : ""
                  }`}
                  onClick={() => setShortTracksSection("extended-found")}
                >
                  Extended Versions Found ({getTracksWithExtended().length})
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
          {showShortTracksBackup && (
            <ShortTracksBackupPanel
              onClose={() => setShowShortTracksBackup(false)}
              onExport={exportShortTracksData}
              onImport={importShortTracksData}
              onClear={clearAllShortTracksData}
              confirmedCount={confirmedShortTracks.size}
              searchResultsCount={Object.keys(shortTracksSearchResults).length}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ValidationPanel;
