import React, { useState, useEffect, useRef } from "react";
import styles from "./TrackList.module.css";
import { parseLocalFileUri } from "@/utils/LocalFileParser";
import {
  TagCategory,
  SmartPlaylistCriteria,
  TrackTag,
} from "@/hooks/data/useTagData";
import CreatePlaylistModal from "@/components/modals/CreatePlaylistModal";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { TrackInfoCacheManager } from "@/utils/TrackInfoCache";
import { trackService } from "@/services/TrackService";
import {
  PAGINATION_BATCH_SIZE,
  SORT_OPTIONS,
  SORT_ORDERS,
  SortOption,
  SortOrder,
} from "@/constants/trackList";
import {
  SpotifyArtist,
  SpotifyBatchTracksResponse,
  SpotifyTrackResponse,
} from "@/types/SpotifyTypes";
import ReactStars from "react-rating-stars-component";
import SmartPlaylistModal from "@/components/modals/SmartPlaylistModal";
import { formatTimestamp } from "@/utils/formatters";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBoltLightning,
  faStar,
  faStarHalf,
} from "@fortawesome/free-solid-svg-icons";

export interface TrackData {
  rating: number;
  energy: number;
  bpm: number | null;
  resolvedTagNames: { displayName: string; fullTagId: string }[];
  dateCreated?: number;
  dateModified?: number;
}

interface SpotifyTrackInfo {
  name: string;
  artists: string;
  albumName: string;
  albumUri?: string | null;
  artistsData?: Array<{ name: string; uri: string }>;
}

interface TrackListProps {
  tracks: { [uri: string]: TrackData };
  categories: TagCategory[];
  activeTagFilters: string[];
  excludedTagFilters: string[];
  activeTrackUri: string | null;
  onRemoveTagFilter: (fullTagId: string) => void;
  onToggleTagIncludeExcludeOff: (fullTagId: string) => void;
  onToggleTagIncludeExclude: (fullTagId: string, isExcluded: boolean) => void;
  onToggleTagIncludeOff: (fullTagId: string) => void;
  onPlayTrack: (uri: string) => void;
  onTagTrack: (uri: string) => void;
  onClearTagFilters: () => void;
  onCreatePlaylist: (
    trackUris: string[],
    name: string,
    description: string,
    isPublic: boolean,
    isSmartPlaylist: boolean
  ) => Promise<string | null>;
  onCreateSmartPlaylist: (criteria: SmartPlaylistCriteria) => void;
  parseTagId: (
    fullTagId: string
  ) => { categoryId: string; subcategoryId: string; tagId: string } | null;
  smartPlaylists: SmartPlaylistCriteria[];
  onSetSmartPlaylists: (updatedPlaylists: SmartPlaylistCriteria[]) => void;
  onSyncPlaylist: (playlist: SmartPlaylistCriteria) => Promise<void>;
  onCleanupDeletedSmartPlaylists: () => Promise<void>;
  onExportSmartPlaylists: () => void;
  onImportSmartPlaylists: (data: SmartPlaylistCriteria[]) => void;
}

const TrackList: React.FC<TrackListProps> = ({
  tracks,
  categories,
  activeTagFilters,
  excludedTagFilters,
  activeTrackUri,
  onToggleTagIncludeExcludeOff,
  onRemoveTagFilter,
  onToggleTagIncludeExclude,
  onToggleTagIncludeOff,
  onPlayTrack,
  onTagTrack,
  onClearTagFilters,
  onCreatePlaylist,
  onCreateSmartPlaylist,
  parseTagId,
  smartPlaylists,
  onSetSmartPlaylists,
  onSyncPlaylist,
  onCleanupDeletedSmartPlaylists,
  onExportSmartPlaylists,
  onImportSmartPlaylists,
}) => {
  const [trackInfo, setTrackInfo] = useState<{
    [uri: string]: SpotifyTrackInfo;
  }>({});
  const [searchTerm, setSearchTerm] = useLocalStorage<string>(
    "tagify:trackSearchTerm",
    ""
  );
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] =
    useState<boolean>(false);
  const [showSmartPlaylistModal, setShowSmartPlaylistModal] =
    useState<boolean>(false);
  const [displayCount, setDisplayCount] = useState<number>(
    PAGINATION_BATCH_SIZE
  ); // Initial batch size
  const observerRef = useRef<HTMLDivElement>(null);

  const [ratingFilters, setRatingFilters] = useLocalStorage<number[]>(
    "tagify:ratingFilters",
    []
  );
  const [energyMinFilter, setEnergyMinFilter] = useLocalStorage<number | null>(
    "tagify:energyMinFilter",
    null
  );
  const [energyMaxFilter, setEnergyMaxFilter] = useLocalStorage<number | null>(
    "tagify:energyMaxFilter",
    null
  );
  const [showFilterOptions, setShowFilterOptions] = useLocalStorage<boolean>(
    "tagify:showFilterOptions",
    false
  );
  const [isOrFilterMode, setIsOrFilterMode] = useLocalStorage<boolean>(
    "tagify:isOrFilterMode",
    false
  );
  const [tagSearchTerm, setTagSearchTerm] = useLocalStorage<string>(
    "tagify:tagListSearchTerm",
    ""
  );
  const [bpmMinFilter, setBpmMinFilter] = useLocalStorage<number | null>(
    "tagify:bpmMinFilter",
    null
  );
  const [bpmMaxFilter, setBpmMaxFilter] = useLocalStorage<number | null>(
    "tagify:bpmMaxFilter",
    null
  );
  const [sortBy, setSortBy] = useLocalStorage<SortOption>(
    "tagify:trackListSortBy",
    SORT_OPTIONS.DATE_MODIFIED
  );
  const [sortOrder, setSortOrder] = useLocalStorage<SortOrder>(
    "tagify:trackListSortOrder",
    SORT_ORDERS.DESC
  );

  const allBpmValues = new Set<number>();
  Object.values(tracks).forEach((track) => {
    if (track.bpm !== null && track.bpm > 0) {
      allBpmValues.add(track.bpm);
    }
  });

  // Sort tags based on their position in the hierarchy
  const sortTags = (tags: { displayName: string; fullTagId: string }[]) => {
    // Build an index of tag positions in the category hierarchy
    const tagPositions: { [tagName: string]: string } = {};

    // Iterate through all categories to build position mapping
    categories.forEach((category, categoryIndex) => {
      category.subcategories.forEach((subcategory, subcategoryIndex) => {
        subcategory.tags.forEach((tag, tagIndex) => {
          // Create a sortable position string
          // categoryIndex - subcategoryIndex - tagIndex => 000-000-000 format
          const positionKey = `${String(categoryIndex).padStart(
            3,
            "0"
          )}-${String(subcategoryIndex).padStart(3, "0")}-${String(
            tagIndex
          ).padStart(3, "0")}`;
          tagPositions[tag.name] = positionKey;
        });
      });
    });

    // Sort the tags by their positions. Default to end if not found
    return [...tags].sort((a, b) => {
      const posA = tagPositions[a.displayName] || "999-999-999";
      const posB = tagPositions[b.displayName] || "999-999-999";
      return posA.localeCompare(posB);
    });
  };

  const getSortedTracks = (
    tracksToSort: [string, TrackData][]
  ): [string, TrackData][] => {
    return [...tracksToSort].sort((a, b) => {
      const [uriA, dataA] = a;
      const [uriB, dataB] = b;
      const infoA = trackInfo[uriA];
      const infoB = trackInfo[uriB];

      let comparison = 0; // 0 = equal, negative = A comes first, positive = B comes first

      switch (sortBy) {
        case SORT_OPTIONS.ALPHABETICAL: {
          if (!infoA || !infoB) return 0;
          comparison = infoA.name.localeCompare(infoB.name);
          break;
        }

        case SORT_OPTIONS.DATE_CREATED: {
          const createdA = dataA.dateCreated || 0;
          const createdB = dataB.dateCreated || 0;
          comparison = createdA - createdB;
          break;
        }

        case SORT_OPTIONS.DATE_MODIFIED: {
          const modifiedA = dataA.dateModified || 0;
          const modifiedB = dataB.dateModified || 0;
          comparison = modifiedA - modifiedB;
          break;
        }

        case SORT_OPTIONS.RATING: {
          comparison = dataA.rating - dataB.rating;
          break;
        }

        case SORT_OPTIONS.ENERGY: {
          comparison = dataA.energy - dataB.energy;
          break;
        }
        case SORT_OPTIONS.BPM: {
          const bpmA = dataA.bpm || 0;
          const bpmB = dataB.bpm || 0;
          comparison = bpmA - bpmB;
          break;
        }

        default:
          return 0;
      }

      return sortOrder === SORT_ORDERS.DESC ? -comparison : comparison;
    });
  };

  // Fetch track info on component mount and when tracks change (from Spotify or cache)
  useEffect(() => {
    const loadTrackInfo = async () => {
      const trackUris = Object.keys(tracks);
      if (trackUris.length === 0) return;

      const localFileUris = trackUris.filter((uri) =>
        uri.startsWith("spotify:local:")
      );
      const spotifyTrackUris = trackUris.filter((uri) =>
        uri.startsWith("spotify:track:")
      );

      const newTrackInfo: { [uri: string]: SpotifyTrackInfo } = {};

      // Handle local files
      localFileUris.forEach((uri) => {
        const parsedLocalFile = parseLocalFileUri(uri);
        newTrackInfo[uri] = {
          name: parsedLocalFile.title,
          artists: parsedLocalFile.artist,
          albumName: parsedLocalFile.album,
        };
      });

      // Check cache for Spotify tracks
      const { cached, missing } =
        TrackInfoCacheManager.getCachedUris(spotifyTrackUris);

      // Load cached data immediately
      cached.forEach((uri) => {
        const cachedInfo = TrackInfoCacheManager.getTrackInfo(uri);
        if (cachedInfo) {
          newTrackInfo[uri] = {
            name: cachedInfo.name,
            artists: cachedInfo.artists,
            albumName: cachedInfo.albumName,
            albumUri: cachedInfo.albumUri,
            artistsData: cachedInfo.artistsData,
          };
        }
      });

      // Update state with cached data first
      setTrackInfo(newTrackInfo);

      // Fetch missing tracks only
      if (missing.length > 0) {
        await fetchAndCacheMissingTracks(missing, newTrackInfo, setTrackInfo);
      }

      // Cleanup orphaned entries (run occasionally, not every render)
      const shouldCleanup = Math.random() < 0.1; // 10% chance
      if (shouldCleanup) {
        TrackInfoCacheManager.cleanupOrphanedEntries(trackUris);
      }
    };

    loadTrackInfo();
  }, [tracks]);

  const fetchAndCacheMissingTracks = async (
    missingUris: string[],
    currentTrackInfo: { [uri: string]: SpotifyTrackInfo },
    setTrackInfo: React.Dispatch<
      React.SetStateAction<{ [uri: string]: SpotifyTrackInfo }>
    >
  ) => {
    // Process in batches of 20
    for (let i = 0; i < missingUris.length; i += 20) {
      const batch = missingUris.slice(i, i + 20);

      try {
        const trackIds = batch.map((uri) => uri.split(":")[2]).filter(Boolean);
        const response = (await Spicetify.CosmosAsync.get(
          `https://api.spotify.com/v1/tracks?ids=${trackIds.join(",")}`
        )) as SpotifyBatchTracksResponse;

        if (response?.tracks) {
          const updatedTrackInfo = { ...currentTrackInfo };

          response.tracks.forEach((track: SpotifyTrackResponse | null) => {
            if (track?.id) {
              const uri = `spotify:track:${track.id}`;

              const trackInfo = {
                name: track.name,
                artists: track.artists
                  .map((a: SpotifyArtist) => a.name)
                  .join(", "),
                albumName: track.album?.name || "Unknown Album",
                albumUri: track.album?.uri || null,
                artistsData: track.artists.map((a: SpotifyArtist) => ({
                  name: a.name,
                  uri: a.uri,
                })),
              };

              // Cache the track info
              TrackInfoCacheManager.setTrackInfo(uri, {
                ...trackInfo,
                duration_ms: track.duration_ms,
                release_date: track.album?.release_date || "",
                cached_at: Date.now(),
              });

              updatedTrackInfo[uri] = trackInfo;
            }
          });

          setTrackInfo(updatedTrackInfo);
        }
      } catch (error) {
        console.error("Error fetching batch:", error);
      }
    }
  };

  useEffect(() => {
    // Reset display count when filters change
    setDisplayCount(PAGINATION_BATCH_SIZE);
  }, [
    activeTagFilters,
    searchTerm,
    ratingFilters,
    energyMinFilter,
    energyMaxFilter,
    bpmMinFilter,
    bpmMaxFilter,
  ]);

  const filterTagBySearch = (tagName: string) => {
    if (!tagSearchTerm || typeof tagSearchTerm !== "string") return true;
    if (!tagSearchTerm.trim()) return true;
    return tagName.toLowerCase().includes(tagSearchTerm.toLowerCase());
  };

  // Filter tracks based on all applied filters
  const filteredTracks: [uri: string, trackData: TrackData][] = Object.entries(
    tracks
  ).filter(([uri, trackData]) => {
    const info = trackInfo[uri];
    const isLocalFile = uri.startsWith("spotify:local:");
    const hasMetadata = !!info;

    // Skip if we don't have info for this track
    // But KEEP local files even if we have no info yet
    if (!isLocalFile && !hasMetadata) {
      return false;
    }

    // If it's a local file that we don't have info for yet, keep it visible
    // This ensures local files appear while metadata is still loading
    if (isLocalFile && !hasMetadata) {
      // Only apply tag/rating/energy/bpm filters since we can't search without metadata
      const trackTagIds = trackData.resolvedTagNames.map(
        (tag) => tag.fullTagId
      );

      // Tag filters - include and exclude logic
      const matchesIncludeTags =
        activeTagFilters.length === 0 ||
        (isOrFilterMode
          ? // OR logic - track must have ANY of the selected tags
            activeTagFilters.some((filterId) => trackTagIds.includes(filterId))
          : // AND logic - track must have ALL of the selected tags
            activeTagFilters.every((filterId) =>
              trackTagIds.includes(filterId)
            ));

      // Exclude tags - track must NOT have ANY of these tags
      const matchesExcludeTags =
        excludedTagFilters.length === 0 ||
        !excludedTagFilters.some((filterId) => trackTagIds.includes(filterId));

      // Rating filter
      const matchesRating =
        ratingFilters.length === 0 ||
        (trackData.rating > 0 && ratingFilters.includes(trackData.rating));

      // Energy range filter
      const matchesEnergyMin =
        energyMinFilter === null || trackData.energy >= energyMinFilter;
      const matchesEnergyMax =
        energyMaxFilter === null || trackData.energy <= energyMaxFilter;

      // BPM range filter
      const matchesBpmMin =
        bpmMinFilter === null ||
        (trackData.bpm !== null && trackData.bpm >= bpmMinFilter);
      const matchesBpmMax =
        bpmMaxFilter === null ||
        (trackData.bpm !== null && trackData.bpm <= bpmMaxFilter);

      // If search term is empty, then return based on other filters
      // Otherwise, hide it since we can't search on local files without metadata yet
      return (
        searchTerm === "" &&
        matchesIncludeTags &&
        matchesExcludeTags &&
        matchesRating &&
        matchesEnergyMin &&
        matchesEnergyMax &&
        matchesBpmMin &&
        matchesBpmMax
      );
    }

    // For tracks with info (both Spotify and loaded local files)
    // Search term filter
    const matchesSearch =
      searchTerm === "" ||
      info.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      info.artists.toLowerCase().includes(searchTerm.toLowerCase());

    const trackTagIds = trackData.resolvedTagNames.map((tag) => tag.fullTagId);

    // Tag filters - Combined include/exclude logic
    const matchesIncludeTags =
      activeTagFilters.length === 0 ||
      (isOrFilterMode
        ? activeTagFilters.some((filterId) => trackTagIds.includes(filterId))
        : activeTagFilters.every((filterId) => trackTagIds.includes(filterId)));

    // Exclude tags - track must NOT have ANY of these tags (always AND logic for exclusions)
    const matchesExcludeTags =
      excludedTagFilters.length === 0 ||
      !excludedTagFilters.some((filterId) => trackTagIds.includes(filterId));

    // Rating filter
    const matchesRating =
      ratingFilters.length === 0 ||
      (trackData.rating > 0 && ratingFilters.includes(trackData.rating));

    // Energy range filter
    const matchesEnergyMin =
      energyMinFilter === null || trackData.energy >= energyMinFilter;
    const matchesEnergyMax =
      energyMaxFilter === null || trackData.energy <= energyMaxFilter;

    // BPM range filter
    const matchesBpmMin =
      bpmMinFilter === null || (trackData.bpm && trackData.bpm >= bpmMinFilter);
    const matchesBpmMax =
      bpmMaxFilter === null || (trackData.bpm && trackData.bpm <= bpmMaxFilter);

    return (
      matchesSearch &&
      matchesIncludeTags &&
      matchesExcludeTags &&
      matchesRating &&
      matchesEnergyMin &&
      matchesEnergyMax &&
      matchesBpmMin &&
      matchesBpmMax
    );
  });

  const handleBpmMinChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value =
      event.target.value === "" ? null : parseInt(event.target.value);
    setBpmMinFilter(value);

    // If max is less than min, adjust max
    if (value !== null && bpmMaxFilter !== null && value > bpmMaxFilter) {
      setBpmMaxFilter(value);
    }
  };

  const handleBpmMaxChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value =
      event.target.value === "" ? null : parseInt(event.target.value);
    setBpmMaxFilter(value);

    // If min is greater than max, adjust min
    if (value !== null && bpmMinFilter !== null && bpmMinFilter > value) {
      setBpmMinFilter(value);
    }
  };

  // Sort filtered tracks by track name
  const allSortedTracks = getSortedTracks(filteredTracks);
  // get only the slice we want to display
  const sortedTracksVisible = allSortedTracks.slice(0, displayCount);

  // See more tracklist elements on scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          sortedTracksVisible.length < filteredTracks.length
        ) {
          // User has scrolled to the observer element
          setDisplayCount((prev) =>
            Math.min(prev + PAGINATION_BATCH_SIZE, filteredTracks.length)
          );
        }
      },
      { threshold: 0.5 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => {
      if (observerRef.current) {
        observer.unobserve(observerRef.current);
      }
    };
  }, [sortedTracksVisible.length, filteredTracks.length]);

  const hasIncompleteTags = (trackData: TrackData): boolean => {
    if (!trackData) return true;

    // Check if any of these are missing
    const missingRating =
      trackData.rating === 0 || trackData.rating === undefined;
    const missingEnergy =
      trackData.energy === 0 || trackData.energy === undefined;
    const missingTags =
      !trackData.resolvedTagNames || trackData.resolvedTagNames.length === 0;

    // Return true if any are missing
    return missingRating || missingEnergy || missingTags;
  };

  // Extract all unique tags from all tracks
  const allUniqueTagsMap = new Map<string, string>();
  Object.values(tracks).forEach((track) => {
    track.resolvedTagNames.forEach(({ fullTagId, displayName }) => {
      allUniqueTagsMap.set(fullTagId, displayName);
    });
  });

  const activeTagDisplayNames = activeTagFilters.map(
    (fullTagId) => allUniqueTagsMap.get(fullTagId) || fullTagId
  );
  const excludedTagDisplayNames = excludedTagFilters.map(
    (fullTagId) => allUniqueTagsMap.get(fullTagId) || fullTagId
  );

  // Extract all possible rating values
  const allRatings = new Set<number>();
  Object.values(tracks).forEach((track) => {
    if (track.rating > 0) {
      allRatings.add(track.rating);
    }
  });

  // Extract all possible energy values
  const allEnergyLevels = new Set<number>();
  Object.values(tracks).forEach((track) => {
    if (track.energy > 0) {
      allEnergyLevels.add(track.energy);
    }
  });

  // Toggle a rating filter - now adds/removes from array
  const toggleRatingFilter = (rating: number) => {
    setRatingFilters((prev) =>
      prev.includes(rating)
        ? prev.filter((r) => r !== rating)
        : [...prev, rating]
    );
  };

  // Handle energy range filtering
  const handleEnergyMinChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value =
      event.target.value === "" ? null : parseInt(event.target.value);
    setEnergyMinFilter(value);

    // If max is less than min, adjust max
    if (value !== null && energyMaxFilter !== null && value > energyMaxFilter) {
      setEnergyMaxFilter(value);
    }
  };

  const handleEnergyMaxChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value =
      event.target.value === "" ? null : parseInt(event.target.value);
    setEnergyMaxFilter(value);

    // If min is greater than max, adjust min
    if (value !== null && energyMinFilter !== null && energyMinFilter > value) {
      setEnergyMinFilter(value);
    }
  };

  // Clear all filters
  const clearAllFilters = () => {
    setSearchTerm("");
    setTagSearchTerm(""); // Clear tag search as well
    onClearTagFilters();
    setRatingFilters([]);
    setEnergyMinFilter(null);
    setEnergyMaxFilter(null);
    setBpmMinFilter(null);
    setBpmMaxFilter(null);
  };

  // Calculate active filter count for badge
  const activeFilterCount =
    activeTagFilters.length +
    excludedTagFilters.length +
    (ratingFilters.length > 0 ? 1 : 0) +
    (energyMinFilter !== null || energyMaxFilter !== null ? 1 : 0) +
    (bpmMinFilter !== null || bpmMaxFilter !== null ? 1 : 0) +
    (searchTerm.trim() !== "" ? 1 : 0);

  const createSmartPlaylistCriteria = (
    playlistId: string,
    playlistName: string,
    trackUris: string[]
  ): SmartPlaylistCriteria => {
    const parseTagIds = (tagIds: string[]): TrackTag[] =>
      tagIds
        .map((tagId) => {
          const parsed = parseTagId(tagId);
          if (!parsed) return null;

          return {
            categoryId: parsed.categoryId,
            subcategoryId: parsed.subcategoryId,
            tagId: parsed.tagId,
          };
        })
        .filter((tag): tag is TrackTag => tag !== null);

    return {
      playlistId,
      playlistName,
      criteria: {
        activeTagFilters: parseTagIds(activeTagFilters),
        excludedTagFilters: parseTagIds(excludedTagFilters),
        ratingFilters,
        energyMinFilter,
        energyMaxFilter,
        bpmMinFilter,
        bpmMaxFilter,
        isOrFilterMode,
      },
      isActive: true,
      createdAt: Date.now(),
      lastSyncAt: Date.now(),
      smartPlaylistTrackUris: trackUris,
    };
  };

  const handleCreatePlaylist = async (
    playlistName: string,
    description: string,
    isPublic: boolean,
    isSmartPlaylist: boolean
  ) => {
    setShowCreatePlaylistModal(false);
    if (filteredTracks.length === 0) return;

    const trackUris: string[] = filteredTracks.map(([uri]) => uri);
    const playlistId: string | null = await onCreatePlaylist(
      trackUris,
      playlistName,
      description,
      isPublic,
      isSmartPlaylist
    );

    if (isSmartPlaylist && playlistId) {
      const smartPlaylistCriteria: SmartPlaylistCriteria =
        createSmartPlaylistCriteria(playlistId, playlistName, trackUris);
      onCreateSmartPlaylist(smartPlaylistCriteria);
    }
  };

  const handleCreatePlaylistClick = () => {
    if (filteredTracks.length > 0) {
      setShowCreatePlaylistModal(true);
    }
  };

  const handleSmartPlaylistClick = async () => {
    setShowSmartPlaylistModal(true);
    // onCleanupDeletedSmartPlaylists();
  };

  const navigateToAlbum = (uri: string) => {
    try {
      if (uri.startsWith("spotify:local:")) {
        Spicetify.Platform.History.push("/collection/local-files");
        return;
      }

      const info = trackInfo[uri];
      if (!info) return;

      // If we have a complete trackInfo object with album ID already, use it
      if (info.albumUri) {
        const albumId = info.albumUri.split(":").pop();
        if (albumId) {
          Spicetify.Platform.History.push(`/album/${albumId}`);
          return;
        }
      }

      // Otherwise extract track ID and get album info
      const trackId = uri.split(":").pop();
      if (!trackId) return;

      // Fetch track to get album
      Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/tracks/${trackId}`)
        .then((response) => {
          if (response && response.album && response.album.id) {
            Spicetify.Platform.History.push(`/album/${response.album.id}`);
          }
        })
        .catch((error) => {
          console.error("Error navigating to album:", error);
        });
    } catch (error) {
      console.error("Error navigating to album:", error);
    }
  };

  const navigateToArtist = (artistName: string, trackUri: string) => {
    try {
      if (trackUri.startsWith("spotify:local:")) {
        // For local files, we can't navigate to an artist
        Spicetify.showNotification(
          "Cannot navigate to artist for local files",
          true
        );
        return;
      }

      // Get track info to find artist
      const info = trackInfo[trackUri];
      if (!info) return;

      // If the info has an artistsData array with URIs, use it
      if (info.artistsData) {
        const artist = info.artistsData.find((a) => a.name === artistName);
        if (artist && artist.uri) {
          const artistId = artist.uri.split(":").pop();
          if (artistId) {
            Spicetify.Platform.History.push(`/artist/${artistId}`);
            return;
          }
        }
      }

      // Fallback - search for the artist
      Spicetify.Platform.History.push(
        `/search/${encodeURIComponent(artistName)}/artists`
      );
    } catch (error) {
      console.error("Error navigating to artist:", error);
    }
  };

  const playAllFilteredTracks = async (): Promise<void> => {
    if (allSortedTracks.length === 0) return;

    const trackUris = allSortedTracks.map(([uri]) => uri);
    await trackService.playAllFilteredTracks(trackUris);
  };
  return (
    <div className={styles.container}>
      <div className={styles.filterControlsGrid}>
        {/* HEADER */}
        <div className={styles.filterControlsLeftGrid}>
          <div className={styles.header}>
            <div className={styles.titleSection}>
              <h2 className={styles.title}>Tagged Tracks</h2>
              <span className={styles.trackCount}>
                {activeFilterCount > 0 || searchTerm.trim() !== ""
                  ? `${filteredTracks.length}/${
                      Object.keys(tracks).length
                    } tracks`
                  : `${Object.keys(tracks).length} tracks`}
              </span>
            </div>
          </div>
        </div>
        <div className={styles.filterControlsCenterGrid}>
          {/* Play All button */}
          <button
            className={styles.playAllButton}
            onClick={playAllFilteredTracks}
            {...(filteredTracks.length > 0 && {
              title: `Play all ${filteredTracks.length} tracks`,
            })}
            disabled={filteredTracks.length === 0}
          ></button>

          {/* Create Playlist button */}
          <button
            className={styles.createPlaylistButton}
            onClick={handleCreatePlaylistClick}
            {...(filteredTracks.length > 0 && {
              title: `Create playlist with ${filteredTracks.length} tracks`,
            })}
            disabled={filteredTracks.length === 0}
          >
            Create Playlist
          </button>

          {/* Smart Playlist button */}
          <button
            className={styles.smartPlaylistButton}
            onClick={handleSmartPlaylistClick}
            title={`Smart Playlists (${smartPlaylists.length})`}
          >
            {/* <i className="fa-solid fa-bolt-lightning"></i> */}

            <FontAwesomeIcon icon={faBoltLightning} />
          </button>
        </div>
        <div className={styles.filterControlsRightGrid}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder="Search tracks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={styles.searchInput}
            />
          </div>
        </div>
      </div>

      {/* FILTER CONTROLS */}
      <div className={styles.filterControlsGrid}>
        {/* Left zone - Filter toggle */}
        <div className={styles.filterControlsLeftGrid}>
          <button
            className={`${styles.filterToggle} ${
              showFilterOptions ? styles.filterToggleActive : ""
            }`}
            onClick={() => setShowFilterOptions(!showFilterOptions)}
          >
            Filters{" "}
            {activeFilterCount > 0 && (
              <span className={styles.filterBadge}>{activeFilterCount}</span>
            )}
          </button>
        </div>

        {/* Center zone - ALL/ANY */}
        {activeFilterCount > 0 && (
          <div className={styles.filterControlsCenterGrid}>
            <div className={styles.filterModeToggle}>
              <label className={"form-label"}>Match:</label>
              <button
                className={`${styles.filterModeButton} ${
                  !isOrFilterMode ? styles.activeFilterMode : ""
                }`}
                onClick={() => setIsOrFilterMode(false)}
                title="Tracks must match ALL selected filters (AND logic)"
              >
                ALL
              </button>
              <button
                className={`${styles.filterModeButton} ${
                  isOrFilterMode ? styles.activeFilterMode : ""
                }`}
                onClick={() => setIsOrFilterMode(true)}
                title="Tracks must match ANY selected filter (OR logic)"
              >
                ANY
              </button>
            </div>

            <button className={styles.clearFilters} onClick={clearAllFilters}>
              Clear All
            </button>
          </div>
        )}

        {/* Right zone - Sort controls */}
        <div className={styles.filterControlsRightGrid}>
          <label className={"form-label"}>Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className={"form-select"}
          >
            <option value={SORT_OPTIONS.DATE_MODIFIED}>Last updated</option>
            <option value={SORT_OPTIONS.DATE_CREATED}>Date created</option>
            <option value={SORT_OPTIONS.ALPHABETICAL}>Name</option>
            <option value={SORT_OPTIONS.RATING}>Rating</option>
            <option value={SORT_OPTIONS.ENERGY}>Energy</option>
            <option value={SORT_OPTIONS.BPM}>BPM</option>
          </select>

          <button
            className={styles.sortOrderButton}
            onClick={() =>
              setSortOrder(
                sortOrder == SORT_ORDERS.ASC
                  ? SORT_ORDERS.DESC
                  : SORT_ORDERS.ASC
              )
            }
            title={`Sort ${
              sortOrder === SORT_ORDERS.ASC ? "descending" : "ascending"
            }`}
          >
            {sortOrder === SORT_ORDERS.ASC ? "↑" : "↓"}
          </button>
        </div>
      </div>
      {showFilterOptions && (
        <div className={styles.filterOptions}>
          {allRatings.size > 0 && (
            <div className={styles.filterSection}>
              <h3 className={styles.filterSectionTitle}>Rating</h3>
              <div>
                {Array.from(allRatings)
                  .sort((a, b) => b - a)
                  .map((rating) => (
                    <button
                      key={`rating-${rating}`}
                      className={`${styles.ratingFilter} ${
                        ratingFilters.includes(rating) ? styles.active : ""
                      }`}
                      onClick={() => toggleRatingFilter(rating)}
                    >
                      <ReactStars
                        count={5}
                        value={rating}
                        edit={false}
                        size={14}
                        isHalf={true}
                        emptyIcon={<FontAwesomeIcon icon={faStar} />}
                        halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                        fullIcon={<FontAwesomeIcon icon={faStar} />}
                        activeColor="#ffd700"
                        color="rgba(255, 255, 255, 0.2)"
                      />
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Energy and BPM filters in a horizontal container */}
          <div className={styles.filterSectionsRow}>
            {allEnergyLevels.size > 0 && (
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>Energy Level</h3>
                <div className={styles.rangeFilter}>
                  <div className={"form-field"}>
                    <label className={"form-label"}>From:</label>
                    <select
                      value={
                        energyMinFilter === null
                          ? ""
                          : energyMinFilter.toString()
                      }
                      onChange={handleEnergyMinChange}
                      className={"form-select"}
                    >
                      <option value="">Any</option>
                      {Array.from(allEnergyLevels)
                        .sort((a, b) => a - b)
                        .map((energy) => (
                          <option key={`min-${energy}`} value={energy}>
                            {energy}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className={"form-field"}>
                    <label className={"form-label"}>To:</label>
                    <select
                      value={
                        energyMaxFilter === null
                          ? ""
                          : energyMaxFilter.toString()
                      }
                      onChange={handleEnergyMaxChange}
                      className={"form-select"}
                    >
                      <option value="">Any</option>
                      {Array.from(allEnergyLevels)
                        .sort((a, b) => a - b)
                        .map((energy) => (
                          <option key={`max-${energy}`} value={energy}>
                            {energy}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* BPM Range Filter */}
            {allBpmValues.size > 0 && (
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>BPM Range</h3>
                <div className={styles.rangeFilter}>
                  <div className={"form-field"}>
                    <label className={"form-label"}>From:</label>
                    <select
                      value={
                        bpmMinFilter === null ? "" : bpmMinFilter.toString()
                      }
                      onChange={handleBpmMinChange}
                      className={"form-select"}
                    >
                      <option value="">Any</option>
                      {Array.from(allBpmValues)
                        .sort((a, b) => a - b)
                        .map((bpm) => (
                          <option key={`min-${bpm}`} value={bpm}>
                            {bpm}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className={"form-field"}>
                    <label className={"form-label"}>To:</label>
                    <select
                      value={
                        bpmMaxFilter === null ? "" : bpmMaxFilter.toString()
                      }
                      onChange={handleBpmMaxChange}
                      className={"form-select"}
                    >
                      <option value="">Any</option>
                      {Array.from(allBpmValues)
                        .sort((a, b) => a - b)
                        .map((bpm) => (
                          <option key={`max-${bpm}`} value={bpm}>
                            {bpm}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {allUniqueTagsMap.size > 0 && (
            <div className={styles.filterSection}>
              <div className={styles.filterSectionHeader}>
                <h3 className={styles.filterSectionTitle}>Tags</h3>

                <div className={styles.tagSearch}>
                  <input
                    type="text"
                    placeholder="Search tags..."
                    value={tagSearchTerm}
                    onChange={(e) => setTagSearchTerm(e.target.value)}
                    className={styles.tagSearchInput}
                  />
                </div>
              </div>
              <div className={styles.tagFilters}>
                {Array.from(allUniqueTagsMap.entries())
                  .sort(([, nameA], [, nameB]) => nameA.localeCompare(nameB))
                  .filter(([, displayName]) => filterTagBySearch(displayName))
                  .map(([fullTagId, displayName]) => {
                    return (
                      <button
                        key={fullTagId}
                        className={`${styles.tagFilter} ${
                          activeTagFilters.includes(fullTagId)
                            ? styles.active
                            : ""
                        } ${
                          excludedTagFilters.includes(fullTagId)
                            ? styles.excluded
                            : ""
                        }`}
                        onClick={() => {
                          onToggleTagIncludeExcludeOff(fullTagId);
                        }}
                        title={
                          activeTagFilters.includes(fullTagId)
                            ? `Click to exclude "${displayName}"`
                            : excludedTagFilters.includes(fullTagId)
                            ? `Click to remove "${displayName}" filter`
                            : `Click to include "${displayName}"`
                        }
                      >
                        {excludedTagFilters.includes(fullTagId)
                          ? "–"
                          : activeTagFilters.includes(fullTagId)
                          ? "+"
                          : ""}{" "}
                        {displayName}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ACTIVE FILTERS */}
      <div className={styles.activeFiltersDisplay}>
        {activeTagFilters.length === 0 && excludedTagFilters.length === 0 ? (
          <span className={styles.noTagFilters}>No tag filters applied</span>
        ) : (
          <>
            {activeTagFilters.map((fullTagId) => {
              const displayName = allUniqueTagsMap.get(fullTagId) || fullTagId; // Fallback to ID if not found

              return (
                <span
                  key={fullTagId}
                  className={styles.activeFilterTag}
                  title={`Click to exclude "${displayName}"`}
                  onClick={() => onToggleTagIncludeExclude(fullTagId, false)}
                >
                  {displayName}{" "}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveTagFilter(fullTagId);
                    }}
                    className={styles.removeFilterButton}
                    title="Remove filter"
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {excludedTagFilters.map((fullTagId) => {
              const displayName = allUniqueTagsMap.get(fullTagId) || fullTagId;

              return (
                <span
                  key={fullTagId}
                  className={styles.excludedFilterTag}
                  title={`Click to include "${displayName}"`}
                  onClick={() => onToggleTagIncludeExclude(fullTagId, true)}
                >
                  {displayName}{" "}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveTagFilter(fullTagId);
                    }}
                    className={styles.removeFilterButton}
                    title="Remove filter"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </>
        )}
      </div>

      {/* TRACK LIST */}
      <div className={styles.trackList}>
        {sortedTracksVisible.length === 0 ? (
          <p className={styles.noTracks}>
            {Object.keys(tracks).length === 0
              ? "No tagged tracks yet. Start tagging your favorite tracks!"
              : "No tracks match your filters."}
          </p>
        ) : (
          sortedTracksVisible.map(([uri, data]) => {
            const trackData = tracks[uri];
            const info = trackInfo[uri];
            // Handle case when info isn't available yet (especially for local files)
            const isLocalFile = uri.startsWith("spotify:local:");

            const isActiveTrack = activeTrackUri === uri;

            // If no info and not a local file, skip this track
            if (!info && !isLocalFile) return null;

            // For local files without info yet, create temporary display info
            let displayInfo;
            if (!info && isLocalFile) {
              // Use our parser to get better display information
              const parsedLocalFile = parseLocalFileUri(uri);
              displayInfo = {
                name: parsedLocalFile.title,
                artists: parsedLocalFile.artist,
                albumName: parsedLocalFile.album,
              };
            } else {
              displayInfo = info || {
                name: "Unknown Track",
                artists: "Unknown Artist",
                albumName: "Unknown Album",
              };
            }

            // Sort tags based on their position in the category hierarchy (not alphabetically)
            const sortedTagsArray =
              categories && categories.length > 0
                ? sortTags(data.resolvedTagNames)
                : data.resolvedTagNames;

            return (
              <div
                key={uri}
                id={`track-item-${uri}`}
                className={`${styles.trackItem} ${
                  isActiveTrack ? styles.activeTrackItem : ""
                }`}
              >
                {/* TOP SECTION - title and artist + Play/Tag buttons */}
                <div className={styles.trackItemInfo}>
                  {/* Track title and artist on left */}
                  <div className={styles.trackItemTextInfo}>
                    <span
                      className={`${styles.trackItemTitle} ${
                        !isLocalFile ? styles.clickable : ""
                      } ${isActiveTrack ? styles.activeTrackTitle : ""}`}
                      onClick={() => !isLocalFile && navigateToAlbum(uri)}
                      title={!isLocalFile ? "Go to album" : undefined}
                    >
                      {hasIncompleteTags(tracks[uri]) && (
                        <span
                          className={styles.incompleteBullet}
                          title="This track has incomplete tags (missing rating, energy, or tags)"
                        >
                          ●
                        </span>
                      )}
                      {displayInfo.name}
                      {isLocalFile && (
                        <span
                          style={{
                            fontSize: "0.8em",
                            marginLeft: "6px",
                            opacity: 0.7,
                          }}
                        >
                          (Local)
                        </span>
                      )}
                    </span>
                    {displayInfo.artists &&
                      displayInfo.artists !== "Local Artist" && (
                        <span className={styles.trackItemArtist}>
                          {/* Split artists and make each clickable */}
                          {!isLocalFile
                            ? displayInfo.artists
                                .split(", ")
                                .map((artist, idx, arr) => (
                                  <React.Fragment key={idx}>
                                    <span
                                      className={styles.clickableArtist}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigateToArtist(artist, uri);
                                      }}
                                      title={`Go to ${artist}`}
                                    >
                                      {artist}
                                    </span>
                                    {idx < arr.length - 1 && ", "}
                                  </React.Fragment>
                                ))
                            : displayInfo.artists}
                        </span>
                      )}
                  </div>

                  {/* PLAY + TAG BUTTONS */}
                  <div className={styles.trackItemActions}>
                    <button
                      className={styles.actionButton}
                      onClick={() => onPlayTrack(uri)}
                      title={"Play this track"}
                    >
                      {"Play"}
                    </button>

                    <button
                      className={`${styles.actionButton} ${
                        isActiveTrack ? styles.activeTagButton : ""
                      }`}
                      onClick={() => onTagTrack(uri)}
                      title={
                        isActiveTrack
                          ? "Currently tagging this track"
                          : "Edit tags for this track"
                      }
                      disabled={isActiveTrack}
                    >
                      {isActiveTrack ? "Tagging" : "Tag"}
                    </button>
                  </div>
                </div>

                {/* TWO-ROW METADATA SECTION */}
                <div className={styles.trackItemMetaContainer}>
                  {/* TOP ROW - STAR RATING/ENERGY/BPM + TIMESTAMP */}
                  <div className={styles.trackItemMetaTop}>
                    <div className={styles.trackItemFixedMeta}>
                      {data.rating > 0 && (
                        <div className={styles.trackItemRating}>
                          <ReactStars
                            count={5}
                            value={data.rating}
                            edit={false}
                            size={16}
                            isHalf={true}
                            emptyIcon={<FontAwesomeIcon icon={faStar} />}
                            halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                            fullIcon={<FontAwesomeIcon icon={faStar} />}
                            activeColor="#ffd700"
                            color="var(--spice-button-disabled)"
                          />
                        </div>
                      )}

                      {data.energy > 0 && (
                        <div className={styles.trackItemEnergy}>
                          <span title="Energy">{data.energy}</span>
                        </div>
                      )}

                      {data.bpm !== null && data.bpm > 0 && (
                        <div className={styles.trackItemBpm}>
                          <span title="BPM">{data.bpm}</span>
                        </div>
                      )}

                      {/* Timestamp display */}
                      <div className={styles.trackItemTimestampsInline}>
                        {trackData.dateCreated && (
                          <div className={styles.timestampWithIcon}>
                            <span className={styles.timestampIcon}>📅</span>
                            <span
                              className={styles.trackItemTimestamp}
                              title={`Created: ${new Date(
                                trackData.dateCreated
                              ).toLocaleString()}`}
                            >
                              {formatTimestamp(trackData.dateCreated)}
                            </span>
                          </div>
                        )}
                        {trackData.dateModified && (
                          <div className={styles.timestampWithIcon}>
                            <span className={styles.timestampIcon}>✏️</span>
                            <span
                              className={styles.trackItemTimestamp}
                              title={`Last updated: ${new Date(
                                trackData.dateModified
                              ).toLocaleString()}`}
                            >
                              {formatTimestamp(trackData.dateModified)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* BOTTOM ROW - TRACK TAGS */}
                  {sortedTagsArray.length > 0 ? (
                    <div className={styles.trackItemTags}>
                      {sortedTagsArray.map((tag, i) => (
                        <span
                          key={i}
                          className={`${styles.trackItemTag} ${
                            activeTagFilters.includes(tag.fullTagId)
                              ? styles.activeTagFilter
                              : ""
                          } ${
                            excludedTagFilters.includes(tag.fullTagId)
                              ? styles.excludedTagFilter
                              : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent track item click
                            onToggleTagIncludeOff(tag.fullTagId);
                          }}
                          title={
                            activeTagFilters.includes(tag.fullTagId)
                              ? `Click to remove "${tag.displayName}" from filters`
                              : excludedTagFilters.includes(tag.fullTagId)
                              ? `Click to remove "${tag.displayName}" from excluded filters`
                              : `Click to filter by "${tag.displayName}"`
                          }
                        >
                          {tag.displayName}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.trackItemTags}>
                      <span className={styles.noTags}>No tags</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      {allSortedTracks.length > sortedTracksVisible.length && (
        <div ref={observerRef} className={styles.loadMoreContainer}>
          <button
            className={styles.loadMoreButton}
            onClick={() =>
              setDisplayCount((prev) =>
                Math.min(prev + PAGINATION_BATCH_SIZE, allSortedTracks.length)
              )
            }
          >
            Load More ({allSortedTracks.length - sortedTracksVisible.length}{" "}
            remaining)
          </button>
        </div>
      )}
      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          trackCount={allSortedTracks.length}
          localTrackCount={
            allSortedTracks.filter(([uri]) => uri.startsWith("spotify:local:"))
              .length
          }
          currentSearchTerm={searchTerm}
          activeTagDisplayNames={activeTagDisplayNames}
          excludedTagDisplayNames={excludedTagDisplayNames}
          isOrFilterMode={isOrFilterMode}
          energyMinFilter={energyMinFilter}
          energyMaxFilter={energyMaxFilter}
          ratingFilters={ratingFilters}
          bpmMinFilter={bpmMinFilter}
          bpmMaxFilter={bpmMaxFilter}
          onClose={() => setShowCreatePlaylistModal(false)}
          onCreatePlaylist={handleCreatePlaylist}
        />
      )}
      {showSmartPlaylistModal && (
        <SmartPlaylistModal
          smartPlaylists={smartPlaylists}
          tagCategories={categories}
          onUpdateSmartPlaylists={onSetSmartPlaylists}
          onSyncPlaylist={onSyncPlaylist}
          onExportSmartPlaylists={onExportSmartPlaylists}
          onImportSmartPlaylists={onImportSmartPlaylists}
          onCleanupDeletedSmartPlaylists={onCleanupDeletedSmartPlaylists}
          onClose={() => setShowSmartPlaylistModal(false)}
        />
      )}
    </div>
  );
};

export default TrackList;
