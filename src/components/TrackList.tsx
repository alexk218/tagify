import React, { useState, useEffect, useRef } from "react";
import styles from "./TrackList.module.css";
import { parseLocalFileUri } from "../utils/LocalFileParser";
import { TagCategory } from "../hooks/useTagData";
import CreatePlaylistModal from "./CreatePlaylistModal";
import ReactStars from "react-rating-stars-component";
import { useLocalStorage } from "../hooks/useLocalStorage";

interface Tag {
  tag: string;
  category: string;
}

interface TrackData {
  rating: number;
  energy: number;
  bpm: number | null;
  tags: Tag[];
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
  onFilterByTag: (tag: string) => void;
  onRemoveFilter?: (tag: string) => void;
  onToggleFilterType?: (tag: string, isExcluded: boolean) => void;
  onTrackListTagClick?: (tag: string) => void;
  onPlayTrack: (uri: string) => void;
  onTagTrack?: (uri: string) => void;
  onClearTagFilters?: () => void;
  onCreatePlaylist?: (
    trackUris: string[],
    name: string,
    description: string,
    isPublic: boolean
  ) => void;
}

const TrackList: React.FC<TrackListProps> = ({
  tracks,
  categories,
  activeTagFilters,
  excludedTagFilters,
  activeTrackUri,
  onFilterByTag,
  onRemoveFilter,
  onToggleFilterType,
  onTrackListTagClick,
  onPlayTrack,
  onTagTrack,
  onClearTagFilters,
  onCreatePlaylist,
}) => {
  const [trackInfo, setTrackInfo] = useState<{ [uri: string]: SpotifyTrackInfo }>({});
  // Use the local filter state hook for search term
  const [searchTerm, setSearchTerm] = useLocalStorage<string>("tagify:trackSearchTerm", "");
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false);
  const [displayCount, setDisplayCount] = useState<number>(30); // Initial batch size
  const observerRef = useRef<HTMLDivElement>(null);

  // Advanced filtering states - now using useLocalStorage
  const [ratingFilters, setRatingFilters] = useLocalStorage<number[]>("tagify:ratingFilters", []);
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
  const [tagSearchTerm, setTagSearchTerm] = useLocalStorage<string>("tagify:tagListSearchTerm", "");
  const [bpmMinFilter, setBpmMinFilter] = useLocalStorage<number | null>(
    "tagify:bpmMinFilter",
    null
  );
  const [bpmMaxFilter, setBpmMaxFilter] = useLocalStorage<number | null>(
    "tagify:bpmMaxFilter",
    null
  );

  const allBpmValues = new Set<number>();
  Object.values(tracks).forEach((track) => {
    if (track.bpm !== null && track.bpm > 0) {
      allBpmValues.add(track.bpm);
    }
  });

  // Sort tags based on their position in the hierarchy
  const sortTags = (tags: Tag[]) => {
    // Build an index of tag positions in the category hierarchy
    const tagPositions: { [tagName: string]: string } = {};

    // Iterate through all categories to build position mapping
    categories.forEach((category, categoryIndex) => {
      category.subcategories.forEach((subcategory, subcategoryIndex) => {
        subcategory.tags.forEach((tag, tagIndex) => {
          // Create a sortable position string (pad with zeros for correct string sorting)
          const positionKey = `${String(categoryIndex).padStart(3, "0")}-${String(
            subcategoryIndex
          ).padStart(3, "0")}-${String(tagIndex).padStart(3, "0")}`;
          tagPositions[tag.name] = positionKey;
        });
      });
    });

    // Sort the tags by their positions. Default to end if not found
    return [...tags].sort((a, b) => {
      const posA = tagPositions[a.tag] || "999-999-999";
      const posB = tagPositions[b.tag] || "999-999-999";
      return posA.localeCompare(posB);
    });
  };

  // Fetch track info from Spotify on component mount and when tracks change
  useEffect(() => {
    const fetchTrackInfo = async () => {
      const trackUris = Object.keys(tracks);
      console.log("Fetching info for tracks:", trackUris.length);

      if (trackUris.length === 0) {
        console.log("No tracks to fetch info for");
        return;
      }

      const newTrackInfo: { [uri: string]: SpotifyTrackInfo } = {};

      // Separate local files from Spotify tracks
      const localFileUris: string[] = [];
      const spotifyTrackUris: string[] = [];

      trackUris.forEach((uri) => {
        if (uri.startsWith("spotify:local:")) {
          localFileUris.push(uri);
        } else if (uri.startsWith("spotify:track:")) {
          spotifyTrackUris.push(uri);
        }
      });

      console.log(
        `Found ${localFileUris.length} local files and ${spotifyTrackUris.length} Spotify tracks`
      );

      // Handle local files first
      localFileUris.forEach((uri) => {
        try {
          // Use our dedicated parser to extract meaningful metadata
          const parsedLocalFile = parseLocalFileUri(uri);

          newTrackInfo[uri] = {
            name: parsedLocalFile.title,
            artists: parsedLocalFile.artist,
            albumName: parsedLocalFile.album,
          };
        } catch (error) {
          console.error("Error parsing local file URI:", uri, error);
          newTrackInfo[uri] = {
            name: "Local Track",
            artists: "Local Artist",
            albumName: "Local File",
          };
        }
      });

      // Process Spotify tracks in batches of 20
      for (let i = 0; i < spotifyTrackUris.length; i += 20) {
        const batch = spotifyTrackUris.slice(i, i + 20);
        console.log(`Processing batch ${i / 20 + 1}, size ${batch.length}`);

        try {
          // Extract track IDs from URIs
          const trackIds = batch
            .map((uri) => {
              const parts = uri.split(":");
              return parts.length >= 3 && parts[1] === "track" ? parts[2] : null;
            })
            .filter(Boolean);

          if (trackIds.length === 0) {
            console.log("No valid track IDs in this batch");
            continue;
          }

          // Fetch track info
          const response = await Spicetify.CosmosAsync.get(
            `https://api.spotify.com/v1/tracks?ids=${trackIds.join(",")}`
          );

          if (response && response.tracks) {
            // Process the response
            response.tracks.forEach((track: any) => {
              if (track && track.id) {
                // Find the original URI for this track
                const uri = batch.find((u) => u.includes(track.id));
                if (uri) {
                  newTrackInfo[uri] = {
                    name: track.name,
                    artists: track.artists.map((a: any) => a.name).join(", "),
                    albumName: track.album?.name || "Unknown Album",
                    albumUri: track.album?.uri || null,
                    // Store full artist data for navigation
                    artistsData: track.artists.map((a: any) => ({
                      name: a.name,
                      uri: a.uri,
                    })),
                  };
                }
              }
            });
          } else {
            console.warn("Invalid response from Spotify API:", response);
          }
        } catch (error) {
          console.error("Error fetching track info for batch:", error);
        }
      }

      console.log("Track info fetched:", Object.keys(newTrackInfo).length, "tracks");
      setTrackInfo(newTrackInfo);
    };

    if (Object.keys(tracks).length > 0) {
      fetchTrackInfo();
    } else {
      console.log("No tracks available to fetch info for");
    }
  }, [tracks]);

  useEffect(() => {
    // Reset display count when filters change
    setDisplayCount(30);
  }, [
    activeTagFilters,
    searchTerm,
    ratingFilters,
    energyMinFilter,
    energyMaxFilter,
    bpmMinFilter,
    bpmMaxFilter,
  ]);

  const filterTagBySearch = (tag: string) => {
    if (!tagSearchTerm.trim()) return true;
    return tag.toLowerCase().includes(tagSearchTerm.toLowerCase());
  };

  const handleFilterTagClick = (tag: string, isExcluded: boolean) => {
    if (onToggleFilterType) {
      onToggleFilterType(tag, isExcluded);
    }
  };

  const handleRemoveFilter = (tag: string) => {
    if (onRemoveFilter) {
      onRemoveFilter(tag);
    }
  };

  // Filter tracks based on all applied filters
  const filteredTracks = Object.entries(tracks).filter(([uri, trackData]) => {
    const info = trackInfo[uri];

    // Skip if we don't have info for this track
    // But KEEP local files even if we have no info yet
    if (!info && !uri.startsWith("spotify:local:")) {
      return false;
    }

    // If it's a local file that we don't have info for yet, keep it visible
    // This ensures local files appear while metadata is still loading
    if (!info && uri.startsWith("spotify:local:")) {
      // Only apply tag/rating/energy/bpm filters since we can't search without metadata

      // Tag filters - include and exclude logic
      const matchesIncludeTags =
        activeTagFilters.length === 0 ||
        (isOrFilterMode
          ? // OR logic - track must have ANY of the selected tags
            activeTagFilters.some((tag) => trackData.tags.some((t) => t.tag === tag))
          : // AND logic - track must have ALL of the selected tags
            activeTagFilters.every((tag) => trackData.tags.some((t) => t.tag === tag)));

      // Exclude tags - track must NOT have ANY of these tags
      const matchesExcludeTags =
        excludedTagFilters.length === 0 ||
        !excludedTagFilters.some((tag) => trackData.tags.some((t) => t.tag === tag));

      // Rating filter
      const matchesRating =
        ratingFilters.length === 0 ||
        (trackData.rating > 0 && ratingFilters.includes(trackData.rating));

      // Energy range filter
      const matchesEnergyMin = energyMinFilter === null || trackData.energy >= energyMinFilter;
      const matchesEnergyMax = energyMaxFilter === null || trackData.energy <= energyMaxFilter;

      // BPM range filter
      const matchesBpmMin =
        bpmMinFilter === null || (trackData.bpm !== null && trackData.bpm >= bpmMinFilter);
      const matchesBpmMax =
        bpmMaxFilter === null || (trackData.bpm !== null && trackData.bpm <= bpmMaxFilter);

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

    // Tag filters - Combined include/exclude logic
    const matchesIncludeTags =
      activeTagFilters.length === 0 ||
      (isOrFilterMode
        ? // OR logic - track must have ANY of the selected tags
          activeTagFilters.some((tag) => trackData.tags.some((t) => t.tag === tag))
        : // AND logic - track must have ALL of the selected tags
          activeTagFilters.every((tag) => trackData.tags.some((t) => t.tag === tag)));

    // Exclude tags - track must NOT have ANY of these tags (always AND logic for exclusions)
    const matchesExcludeTags =
      excludedTagFilters.length === 0 ||
      !excludedTagFilters.some((tag) => trackData.tags.some((t) => t.tag === tag));

    // Rating filter
    const matchesRating =
      ratingFilters.length === 0 ||
      (trackData.rating > 0 && ratingFilters.includes(trackData.rating));

    // Energy range filter
    const matchesEnergyMin = energyMinFilter === null || trackData.energy >= energyMinFilter;
    const matchesEnergyMax = energyMaxFilter === null || trackData.energy <= energyMaxFilter;

    // BPM range filter
    const matchesBpmMin = bpmMinFilter === null || (trackData.bpm && trackData.bpm >= bpmMinFilter);
    const matchesBpmMax = bpmMaxFilter === null || (trackData.bpm && trackData.bpm <= bpmMaxFilter);

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
    const value = event.target.value === "" ? null : parseInt(event.target.value);
    setBpmMinFilter(value);

    // If max is less than min, adjust max
    if (value !== null && bpmMaxFilter !== null && value > bpmMaxFilter) {
      setBpmMaxFilter(value);
    }
  };

  const handleBpmMaxChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value);
    setBpmMaxFilter(value);

    // If min is greater than max, adjust min
    if (value !== null && bpmMinFilter !== null && bpmMinFilter > value) {
      setBpmMinFilter(value);
    }
  };

  // Sort filtered tracks by track name
  const allSortedTracks = [...filteredTracks].sort((a, b) => {
    const infoA = trackInfo[a[0]];
    const infoB = trackInfo[b[0]];

    if (!infoA || !infoB) return 0;

    // Sort by track name
    return infoA.name.localeCompare(infoB.name);
  });

  // get only the slice we want to display
  const sortedTracks = allSortedTracks.slice(0, displayCount);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && sortedTracks.length < filteredTracks.length) {
          // User has scrolled to the observer element
          setDisplayCount((prev) => Math.min(prev + 30, filteredTracks.length));
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
  }, [sortedTracks.length, filteredTracks.length]);

  const handleTrackItemTagClick = (tag: string) => {
    // If we have the special track list tag click handler, use it
    if (onTrackListTagClick) {
      onTrackListTagClick(tag);
      return;
    }

    // Otherwise fall back to the original logic
    onFilterByTag(tag);
  };

  const hasIncompleteTags = (trackData: any): boolean => {
    if (!trackData) return true;

    // Check if any of these are missing
    const missingRating = trackData.rating === 0 || trackData.rating === undefined;
    const missingEnergy = trackData.energy === 0 || trackData.energy === undefined;
    const missingTags = !trackData.tags || trackData.tags.length === 0;

    // Return true if any are missing
    return missingRating || missingEnergy || missingTags;
  };

  // Extract all unique tags from all tracks
  const allTags = new Set<string>();
  Object.values(tracks).forEach((track) => {
    track.tags.forEach(({ tag }) => {
      allTags.add(tag);
    });
  });

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
      prev.includes(rating) ? prev.filter((r) => r !== rating) : [...prev, rating]
    );
  };

  // Handle energy range filtering
  const handleEnergyMinChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value);
    setEnergyMinFilter(value);

    // If max is less than min, adjust max
    if (value !== null && energyMaxFilter !== null && value > energyMaxFilter) {
      setEnergyMaxFilter(value);
    }
  };

  const handleEnergyMaxChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value);
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
    if (onClearTagFilters) {
      onClearTagFilters();
    }
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

  const handleCreatePlaylist = (name: string, description: string, isPublic: boolean) => {
    if (filteredTracks.length === 0) return;

    // Extract URIs from the filtered tracks
    const trackUris = filteredTracks.map(([uri]) => uri);

    if (onCreatePlaylist) {
      onCreatePlaylist(trackUris, name, description, isPublic);
    }

    setShowCreatePlaylistModal(false);
  };

  const handleCreatePlaylistClick = () => {
    if (filteredTracks.length > 0) {
      setShowCreatePlaylistModal(true);
    }
  };

  const navigateToAlbum = (uri: string) => {
    try {
      // Check if this is a local file
      if (uri.startsWith("spotify:local:")) {
        // For local files, navigate to Local Files section
        Spicetify.Platform.History.push("/collection/local-files");
        return;
      }

      // For Spotify tracks, get the album URI
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

  // Navigate to artist
  const navigateToArtist = (artistName: string, trackUri: string) => {
    try {
      // Check if this is a local file
      if (trackUri.startsWith("spotify:local:")) {
        // For local files, we can't navigate to an artist
        Spicetify.showNotification("Cannot navigate to artist for local files", true);
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
      Spicetify.Platform.History.push(`/search/${encodeURIComponent(artistName)}/artists`);
    } catch (error) {
      console.error("Error navigating to artist:", error);
    }
  };

  // Play all tracks
  const playAllFilteredTracks = async () => {
    if (filteredTracks.length === 0) return;

    // Extract URIs from the filtered tracks
    const trackUris = filteredTracks.map(([uri]) => uri);

    // Separate local and Spotify tracks
    const localFileTracks = trackUris.filter((uri) => uri.startsWith("spotify:local:"));
    const spotifyTracks = trackUris.filter((uri) => !uri.startsWith("spotify:local:"));

    // Check if we have any playable tracks
    if (spotifyTracks.length === 0 && localFileTracks.length === 0) {
      Spicetify.showNotification("No playable tracks match the filters", true);
      return;
    }

    // Start with Spotify tracks if available, otherwise try local files
    const firstTrackToPlay = spotifyTracks.length > 0 ? spotifyTracks[0] : localFileTracks[0];
    let playSuccess = false;

    try {
      // Play the first track directly
      await Spicetify.Player.playUri(firstTrackToPlay);
      playSuccess = true;
    } catch (error) {
      console.error("Error playing first track:", error);

      // If first track was a Spotify track, try again with next track
      if (!firstTrackToPlay.startsWith("spotify:local:") && trackUris.length > 1) {
        try {
          await Spicetify.Player.playUri(trackUris[1]);
          playSuccess = true;
        } catch (secondError) {
          console.error("Failed to play second track:", secondError);
        }
      }
    }

    if (!playSuccess) {
      Spicetify.showNotification("Failed to start playback", true);
      return;
    }

    // Prepare all tracks for queue, in order of Spotify tracks first, then local files
    const remainingTracks = [...spotifyTracks.slice(1), ...localFileTracks];

    // Add remaining tracks to queue if there are any
    if (remainingTracks.length > 0) {
      try {
        const tracksToQueue = remainingTracks.map((uri) => ({ uri }));
        await Spicetify.addToQueue(tracksToQueue);
        Spicetify.showNotification(
          `Playing ${spotifyTracks.length + localFileTracks.length} tracks ` +
            `(${localFileTracks.length} local files)`
        );
      } catch (error) {
        console.error("Error adding tracks to queue:", error);
        Spicetify.showNotification("Started playback but failed to queue all tracks", true);
      }
    } else {
      Spicetify.showNotification(`Playing track`);
    }
  };

  return (
    <div className={styles.container}>
      {/* HEADER */}
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h2 className={styles.title}>Tagged Tracks</h2>
          <span className={styles.trackCount}>
            {activeFilterCount > 0 || searchTerm.trim() !== ""
              ? `${filteredTracks.length}/${Object.keys(tracks).length} tracks`
              : `${Object.keys(tracks).length} tracks`}
          </span>
        </div>
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

      {/* FILTER CONTROLS */}
      <div className={styles.filterControls}>
        <button
          className={`${styles.filterToggle} ${showFilterOptions ? styles.filterToggleActive : ""}`}
          onClick={() => setShowFilterOptions(!showFilterOptions)}
        >
          Filters{" "}
          {activeFilterCount > 0 && <span className={styles.filterBadge}>{activeFilterCount}</span>}
        </button>

        {activeFilterCount > 0 && (
          <>
            <div className={styles.filterModeToggle}>
              <span className={styles.filterModeLabel}>Match:</span>
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
          </>
        )}

        {/* Play All button */}
        {filteredTracks.length > 0 && (
          <button
            className={styles.playAllButton}
            onClick={playAllFilteredTracks}
            title={`Play all ${filteredTracks.length} tracks`}
          >
            Play All
          </button>
        )}

        {/* Create Playlist button */}
        {filteredTracks.length > 0 && (
          <button
            className={styles.createPlaylistButton}
            onClick={handleCreatePlaylistClick}
            title={`Create playlist with ${filteredTracks.length} tracks`}
          >
            Create Playlist
          </button>
        )}
      </div>

      {showFilterOptions && (
        <div className={styles.filterOptions}>
          {allRatings.size > 0 && (
            <div className={styles.filterSection}>
              <h3 className={styles.filterSectionTitle}>Rating</h3>
              <div className={styles.ratingFilters}>
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
                        emptyIcon={<i className="far fa-star"></i>}
                        halfIcon={<i className="fa fa-star-half-alt"></i>}
                        fullIcon={<i className="fa fa-star"></i>}
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
                <div className={styles.energyRangeFilter}>
                  <div className={styles.rangeControl}>
                    <label className={styles.rangeLabel}>From:</label>
                    <select
                      value={energyMinFilter === null ? "" : energyMinFilter.toString()}
                      onChange={handleEnergyMinChange}
                      className={styles.rangeSelect}
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

                  <div className={styles.rangeControl}>
                    <label className={styles.rangeLabel}>To:</label>
                    <select
                      value={energyMaxFilter === null ? "" : energyMaxFilter.toString()}
                      onChange={handleEnergyMaxChange}
                      className={styles.rangeSelect}
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
                <div className={styles.energyRangeFilter}>
                  <div className={styles.rangeControl}>
                    <label className={styles.rangeLabel}>From:</label>
                    <select
                      value={bpmMinFilter === null ? "" : bpmMinFilter.toString()}
                      onChange={handleBpmMinChange}
                      className={styles.rangeSelect}
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

                  <div className={styles.rangeControl}>
                    <label className={styles.rangeLabel}>To:</label>
                    <select
                      value={bpmMaxFilter === null ? "" : bpmMaxFilter.toString()}
                      onChange={handleBpmMaxChange}
                      className={styles.rangeSelect}
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

          {allTags.size > 0 && (
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
                {Array.from(allTags)
                  .sort()
                  .filter(filterTagBySearch)
                  .map((tag) => {
                    return (
                      <button
                        key={tag}
                        className={`${styles.tagFilter} ${
                          activeTagFilters.includes(tag) ? styles.active : ""
                        } ${excludedTagFilters.includes(tag) ? styles.excluded : ""}`}
                        onClick={() => onFilterByTag(tag)}
                        title={
                          activeTagFilters.includes(tag)
                            ? `Click to exclude "${tag}"`
                            : excludedTagFilters.includes(tag)
                            ? `Click to remove "${tag}" filter`
                            : `Click to include "${tag}"`
                        }
                      >
                        {excludedTagFilters.includes(tag)
                          ? "–"
                          : activeTagFilters.includes(tag)
                          ? "+"
                          : ""}{" "}
                        {tag}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Filters Display */}
      {(activeTagFilters.length > 0 || excludedTagFilters.length > 0) && (
        <div className={styles.activeFiltersDisplay}>
          {activeTagFilters.map((tag) => (
            <span
              key={tag}
              className={styles.activeFilterTag}
              onClick={() => handleFilterTagClick(tag, false)}
            >
              {tag}{" "}
              <button
                onClick={(e) => {
                  e.stopPropagation(); // Prevent triggering the parent's onClick
                  handleRemoveFilter(tag);
                }}
                className={styles.removeFilterButton}
                title="Remove filter"
              >
                ×
              </button>
            </span>
          ))}
          {excludedTagFilters.map((tag) => (
            <span
              key={tag}
              className={styles.excludedFilterTag}
              onClick={() => handleFilterTagClick(tag, true)} // Handle click on the tag
            >
              {tag}{" "}
              <button
                onClick={(e) => {
                  e.stopPropagation(); // Prevent triggering the parent's onClick
                  handleRemoveFilter(tag);
                }}
                className={styles.removeFilterButton}
                title="Remove filter"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* TRACK LIST */}
      <div className={styles.trackList}>
        {sortedTracks.length === 0 ? (
          <p className={styles.noTracks}>
            {Object.keys(tracks).length === 0
              ? "No tagged tracks yet. Start tagging your favorite tracks!"
              : "No tracks match your filters."}
          </p>
        ) : (
          sortedTracks.map(([uri, data]) => {
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
              // Use info as is (for Spotify tracks or already parsed local files)
              displayInfo = info || {
                name: "Unknown Track",
                artists: "Unknown Artist",
                albumName: "Unknown Album",
              };
            }

            // Sort tags based on their position in the category hierarchy
            const sortedTagsArray =
              categories && categories.length > 0 ? sortTags(data.tags) : data.tags;

            return (
              <div
                key={uri}
                id={`track-item-${uri}`}
                className={`${styles.trackItem} ${isActiveTrack ? styles.activeTrackItem : ""}`}
              >
                {/* Track info section - title and artist + buttons at top */}
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
                        <span style={{ fontSize: "0.8em", marginLeft: "6px", opacity: 0.7 }}>
                          (Local)
                        </span>
                      )}
                    </span>
                    {displayInfo.artists && displayInfo.artists !== "Local Artist" && (
                      <span className={styles.trackItemArtist}>
                        {/* Split artists and make each clickable */}
                        {!isLocalFile
                          ? displayInfo.artists.split(", ").map((artist, idx, arr) => (
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

                  {/* Action buttons now positioned at top right */}
                  <div className={styles.trackItemActions}>
                    <button
                      className={styles.actionButton}
                      onClick={() => onPlayTrack(uri)}
                      title={"Play this track"}
                    >
                      {"Play"}
                    </button>

                    {onTagTrack && (
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
                    )}
                  </div>
                </div>

                {/* New layout with two-row metadata section */}
                <div className={styles.trackItemMetaContainer}>
                  {/* Top row with fixed elements and action buttons */}
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
                            emptyIcon={<i className="far fa-star"></i>}
                            halfIcon={<i className="fa fa-star-half-alt"></i>}
                            fullIcon={<i className="fa fa-star"></i>}
                            activeColor="#ffd700"
                            color="var(--spice-button-disabled)"
                          />
                        </div>
                      )}

                      {data.energy > 0 && (
                        <div className={styles.trackItemEnergy}>{data.energy}</div>
                      )}

                      {data.bpm !== null && data.bpm > 0 && (
                        <div className={styles.trackItemBpm}>
                          <span title="BPM">{data.bpm}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom row just for tags that can wrap */}
                  {sortedTagsArray.length > 0 ? (
                    <div className={styles.trackItemTags}>
                      {sortedTagsArray.map(({ tag }, i) => (
                        <span
                          key={i}
                          className={`${styles.trackItemTag} ${
                            activeTagFilters.includes(tag) ? styles.activeTagFilter : ""
                          } ${excludedTagFilters.includes(tag) ? styles.excludedTagFilter : ""}`}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent track item click
                            handleTrackItemTagClick(tag); // Use our new handler
                          }}
                          title={
                            activeTagFilters.includes(tag)
                              ? `Click to remove "${tag}" from filters`
                              : excludedTagFilters.includes(tag)
                              ? `Click to remove "${tag}" from excluded filters`
                              : `Click to filter by "${tag}"`
                          }
                        >
                          {tag}
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
      {allSortedTracks.length > sortedTracks.length && (
        <div ref={observerRef} className={styles.loadMoreContainer}>
          <button
            className={styles.loadMoreButton}
            onClick={() => setDisplayCount((prev) => Math.min(prev + 30, allSortedTracks.length))}
          >
            Load More ({allSortedTracks.length - sortedTracks.length} remaining)
          </button>
        </div>
      )}
      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          trackCount={sortedTracks.length}
          localTrackCount={sortedTracks.filter(([uri]) => uri.startsWith("spotify:local:")).length}
          tags={activeTagFilters}
          onClose={() => setShowCreatePlaylistModal(false)}
          onCreatePlaylist={handleCreatePlaylist}
        />
      )}
    </div>
  );
};

export default TrackList;
