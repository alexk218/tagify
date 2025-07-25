import React, { useEffect, useState } from "react";
import styles from "./TrackDetails.module.css";
import { TagCategory, TrackTag } from "../hooks/useTagData";
import ReactStars from "react-rating-stars-component";

interface TrackDetailsProps {
  track: {
    uri: string;
    name: string;
    artists: { name: string }[];
    album: { name: string };
  };
  trackData: {
    rating: number;
    energy: number;
    bpm: number | null;
    tags: TrackTag[];
    dateCreated?: number;
    dateModified?: number;
  };
  categories: TagCategory[];
  onSetRating: (rating: number) => void;
  onSetEnergy: (energy: number) => void;
  onSetBpm: (bpm: number | null) => void;
  onRemoveTag: (categoryId: string, subcategoryId: string, tagId: string) => void;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onFilterByTag: (tag: string) => void;
  onFilterByTagOnOff?: (tag: string) => void;
  onPlayTrack?: (uri: string) => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
  currentTrack?: any; // The currently playing track
  onSwitchToCurrentTrack?: (track: any) => void;
  onUpdateBpm: (trackUri: string) => Promise<number | null>;
}

interface TrackMetadata {
  releaseDate: string;
  trackLength: string;
  bpm: number | null;
  playCount: number | null;
  sourceContext: string | null;
  genres: string[];
}

const TrackDetails: React.FC<TrackDetailsProps> = ({
  track,
  trackData,
  categories,
  activeTagFilters,
  excludedTagFilters,
  onSetRating,
  onSetEnergy,
  onSetBpm,
  onRemoveTag,
  onFilterByTag,
  onFilterByTagOnOff,
  onPlayTrack,
  isLocked = false,
  onToggleLock,
  currentTrack,
  onSwitchToCurrentTrack,
  onUpdateBpm,
}: TrackDetailsProps) => {
  const [contextUri, setContextUri] = useState<string | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);
  const artistNames = track.artists ? track.artists.map((artist) => artist.name).join(", ") : "";
  const [albumCover, setAlbumCover] = useState<string | null>(null);
  const [isLoadingCover, setIsLoadingCover] = useState(true);
  const [trackMetadata, setTrackMetadata] = useState<TrackMetadata>({
    releaseDate: "",
    trackLength: "",
    bpm: null,
    playCount: null,
    sourceContext: null,
    genres: [],
  });
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [editBpmValue, setEditBpmValue] = useState<string>("");
  const [isRefreshingBpm, setIsRefreshingBpm] = useState(false);

  const handleToggleLock = () => {
    if (onToggleLock) {
      onToggleLock();
    }
  };

  // Format milliseconds to mm:ss
  const formatDuration = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Format date to YYYY-MM-DD
  const formatDate = (dateStr: string): string => {
    if (!dateStr) return "";

    // Check if we only have a year
    if (dateStr.length === 4) {
      return dateStr;
    }

    try {
      const date = new Date(dateStr);
      return date.toISOString().split("T")[0];
    } catch (e) {
      return dateStr;
    }
  };

  const formatTimestamp = (timestamp: number | undefined): string => {
    if (!timestamp) return "Unknown";
    const date = new Date(timestamp);

    return date.toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const handleBpmClick = () => {
    setIsEditingBpm(true);
    // initialize input field with current BPM value
    const currentBpm = trackData.bpm || trackMetadata.bpm;
    setEditBpmValue(currentBpm ? currentBpm.toString() : "");
  };

  const handleBpmSave = () => {
    const numericValue = parseInt(editBpmValue.trim());
    if (editBpmValue.trim() === "") {
      onSetBpm(null);
    } else if (isNaN(numericValue) || numericValue < 1 || numericValue > 300) {
      Spicetify.showNotification("BPM must be between 1 and 300", true);
      return;
    } else {
      onSetBpm(numericValue);
    }

    setIsEditingBpm(false);
  };

  const handleBpmCancel = () => {
    setIsEditingBpm(false);
    setEditBpmValue("");
  };

  const handleBpmKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBpmSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleBpmCancel();
    }
  };

  const handleBpmSaveMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent input blur
    handleBpmSave();
  };

  const handleBpmCancelMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent input blur
    handleBpmCancel();
  };

  const handleRefreshBpm = async () => {
    if (track.uri.startsWith("spotify:local:")) {
      Spicetify.showNotification("Cannot fetch BPM for local files", true);
      return;
    }

    setIsRefreshingBpm(true);
    try {
      const updatedBpm = await onUpdateBpm(track.uri);
      Spicetify.showNotification(`BPM updated to ${updatedBpm} from Spotify`);
    } catch (error) {
      console.error("Error refreshing BPM:", error);
      Spicetify.showNotification("Error fetching BPM from Spotify", true);
    } finally {
      setIsRefreshingBpm(false);
    }
  };

  // Fetch additional track metadata
  useEffect(() => {
    const fetchTrackMetadata = async () => {
      setIsLoadingMetadata(true);

      try {
        // Check if this is a local file
        if (track.uri.startsWith("spotify:local:")) {
          // For local files, we set limited metadata
          setTrackMetadata({
            releaseDate: "",
            trackLength: "",
            bpm: null,
            playCount: null,
            sourceContext: "Local Files",
            genres: [],
          });
          setIsLoadingMetadata(false);
          return;
        }

        // Extract track ID from URI for Spotify tracks
        const trackId = track.uri.split(":").pop();

        if (!trackId) {
          console.error("Invalid track URI:", track.uri);
          setIsLoadingMetadata(false);
          return;
        }

        // Fetch track info
        const trackInfo = await Spicetify.CosmosAsync.get(
          `https://api.spotify.com/v1/tracks/${trackId}`
        );

        // Fetch audio features for BPM
        const audioFeatures = await Spicetify.CosmosAsync.get(
          `https://api.spotify.com/v1/audio-features/${trackId}`
        );

        // Try to get source context from Spicetify
        let sourceContext = null;
        try {
          if (Spicetify.Player && Spicetify.Player.data) {
            const playerData = Spicetify.Player.data as any;

            if (playerData.context) {
              const playerContextUri = playerData.context.uri;
              // Store the context URI for navigation
              setContextUri(playerContextUri);

              // Parse the context URI
              const parts = playerContextUri.split(":");
              if (parts.length >= 3) {
                const contextType = parts[1];
                let contextName = "";

                // Special case for Liked Songs (collection)
                if (contextType === "collection" && parts.includes("tracks")) {
                  contextName = "Liked Songs";
                } else if (contextType === "playlist") {
                  try {
                    const playlistData = await Spicetify.CosmosAsync.get(
                      `https://api.spotify.com/v1/playlists/${parts[2]}`
                    );
                    contextName = playlistData.name || "";
                  } catch (e) {
                    contextName = "Playlist";
                  }
                } else if (contextType === "album") {
                  contextName = track.album.name;
                } else if (contextType === "artist") {
                  contextName = artistNames ? artistNames.split(",")[0] : "Artist";
                } else if (contextType === "user") {
                  contextName = "Liked Songs"; // Default for user context is often Liked Songs
                }

                // Simply use the context name without the type prefix
                sourceContext = contextName;
              }
            }
          }
        } catch (e) {
          console.error("Error getting source context:", e);
        }

        // Try to get artist genres
        let genres: string[] = [];

        if (trackInfo?.artists && trackInfo.artists.length > 0 && trackInfo.artists[0]?.id) {
          const artistId = trackInfo.artists[0].id;
          try {
            const artistInfo = await Spicetify.CosmosAsync.get(
              `https://api.spotify.com/v1/artists/${artistId}`
            );
            genres = artistInfo.genres || [];
          } catch (e) {
            console.error("Error fetching artist info:", e);
          }
        }

        let playCount = null;
        try {
          if (!track.uri.startsWith("spotify:local:")) {
            // Only try to get play count for Spotify tracks (not local files)
            playCount = await getTrackPlayCount(track.uri);
          }
        } catch (error) {
          console.error("Error fetching play count:", error);
        }

        setTrackMetadata({
          releaseDate: formatDate(trackInfo.album?.release_date || ""),
          trackLength: formatDuration(trackInfo.duration_ms || 0),
          bpm: audioFeatures?.tempo ? Math.round(audioFeatures.tempo) : null,
          playCount, // Add the play count here
          sourceContext,
          genres: genres.slice(0, 3),
        });
      } catch (error) {
        console.error("Error fetching track metadata:", error);

        // Set minimal metadata for error cases
        setTrackMetadata({
          releaseDate: "",
          trackLength: "",
          bpm: null,
          playCount: null,
          sourceContext: null,
          genres: [],
        });
      } finally {
        setIsLoadingMetadata(false);
      }
    };

    if (track.uri) {
      fetchTrackMetadata();
    }
  }, [track.uri, track.album.name, artistNames]);

  // Fetch album cover when track changes
  useEffect(() => {
    const fetchAlbumCover = async () => {
      setIsLoadingCover(true);

      try {
        // No album art for Local Files
        if (track.uri.startsWith("spotify:local:")) {
          setAlbumCover(null);
          setIsLoadingCover(false);
          return;
        }

        const trackId = track.uri.split(":").pop();

        if (!trackId) {
          console.error("Invalid track URI:", track.uri);
          setIsLoadingCover(false);
          return;
        }

        // Fetch track info to get album ID and cover
        const trackInfo = await Spicetify.CosmosAsync.get(
          `https://api.spotify.com/v1/tracks/${trackId}`
        );

        if (
          trackInfo &&
          trackInfo.album &&
          trackInfo.album.images &&
          trackInfo.album.images.length > 0
        ) {
          // Get medium size image (or the first available if medium doesn't exist)
          const image =
            trackInfo.album.images.find((img: any) => img.height === 300) ||
            trackInfo.album.images[0];
          setAlbumCover(image.url);
        } else {
          setAlbumCover(null);
        }
      } catch (error) {
        console.error("Error fetching album cover:", error);
        setAlbumCover(null);
      } finally {
        setIsLoadingCover(false);
      }
    };

    if (track.uri) {
      fetchAlbumCover();
    }
  }, [track.uri]);

  async function getTrackPlayCount(trackUri: string): Promise<number | null> {
    try {
      // Extract track ID and album ID
      const trackId = trackUri.split(":").pop();
      if (!trackId) return null;

      // First, get the track info to get the album ID
      const trackInfo = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/tracks/${trackId}`
      );

      if (!trackInfo || !trackInfo.album || !trackInfo.album.id) {
        console.error("Could not get album ID for track:", trackUri);
        return null;
      }

      const albumId = trackInfo.album.id;

      // Use GraphQL -> to get album data with play counts
      const { Locale, GraphQL } = Spicetify;
      const res = await GraphQL.Request(GraphQL.Definitions.getAlbum, {
        uri: `spotify:album:${albumId}`,
        locale: Locale.getLocale(),
        offset: 0,
        limit: 500,
      });

      if (!res.data?.albumUnion) {
        console.error("No albumUnion in response for album:", albumId);
        return null;
      }

      // Get tracks from the response
      const tracks = res.data.albumUnion.tracksV2 || res.data.albumUnion.tracks;
      if (!tracks?.items) {
        console.error("No track items found in album data");
        return null;
      }

      // Find our track in the album and get its play count
      const trackItem = tracks.items.find(
        (item: { track: { uri: string } }) => item.track && item.track.uri === trackUri
      );

      if (!trackItem || !trackItem.track) {
        console.error("Track not found in album data");
        return null;
      }

      const playcount = parseInt(trackItem.track.playcount, 10) || 0;
      return playcount;
    } catch (error) {
      console.error("Error fetching track play count:", error);
      return null;
    }
  }

  const handleTagClick = (tag: string) => {
    // If we have the special track list tag click handler, use it
    // This toggle tags ON/OFF in TrackDetails (no EXCLUDE)
    if (onFilterByTagOnOff) {
      onFilterByTagOnOff(tag);
      return;
    }

    // Otherwise fall back to the original logic
    if (activeTagFilters.includes(tag)) {
      onFilterByTag(tag);
    } else if (excludedTagFilters.includes(tag)) {
      onFilterByTag(tag);
    } else {
      onFilterByTag(tag);
    }
  };

  const handlePlayTrack = () => {
    if (onPlayTrack && track.uri) {
      onPlayTrack(track.uri);
    }
  };

  // Helper function to find tag name by ids
  const findTagInfo = (categoryId: string, subcategoryId: string, tagId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return null;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return null;

    const tag = subcategory.tags.find((t) => t.id === tagId);
    if (!tag) return null;

    return {
      categoryName: category.name,
      subcategoryName: subcategory.name,
      tagName: tag.name,
      tagOrder: subcategory.tags.findIndex((t) => t.id === tagId), // Add order information
    };
  };

  // Group tags by category and maintain original order
  const organizeTagsByCategory = () => {
    const groupedTags: {
      [categoryId: string]: {
        categoryName: string;
        categoryOrder: number;
        subcategories: {
          [subcategoryId: string]: {
            subcategoryName: string;
            subcategoryOrder: number;
            tags: {
              id: string;
              name: string;
              order: number;
            }[];
          };
        };
      };
    } = {};

    // First get all categories with their order in the original array
    categories.forEach((category, categoryIndex) => {
      groupedTags[category.id] = {
        categoryName: category.name,
        categoryOrder: categoryIndex,
        subcategories: {},
      };

      // Initialize subcategories with their order
      category.subcategories.forEach((subcategory, subcategoryIndex) => {
        groupedTags[category.id].subcategories[subcategory.id] = {
          subcategoryName: subcategory.name,
          subcategoryOrder: subcategoryIndex,
          tags: [],
        };
      });
    });

    // Now add the tags from the track data
    trackData.tags.forEach((tag) => {
      const tagInfo = findTagInfo(tag.categoryId, tag.subcategoryId, tag.tagId);
      if (!tagInfo) return;

      // Add the tag with its original order to ensure proper sorting later
      groupedTags[tag.categoryId].subcategories[tag.subcategoryId].tags.push({
        id: tag.tagId,
        name: tagInfo.tagName,
        order: tagInfo.tagOrder,
      });
    });

    // For each subcategory, sort tags by their original order
    Object.values(groupedTags).forEach((category) => {
      Object.values(category.subcategories).forEach((subcategory) => {
        subcategory.tags.sort((a, b) => a.order - b.order);
      });
    });

    return groupedTags;
  };

  const groupedTags = organizeTagsByCategory();

  const handleRemoveEnergy = () => {
    onSetEnergy(0);
  };

  // Navigation functions
  const navigateToAlbum = () => {
    try {
      if (track.uri.startsWith("spotify:local:")) {
        Spicetify.Platform.History.push("/collection/local-files");
        return;
      }

      // Extract album URI from track data or try to build it
      let albumUri = "";

      // Try to extract from track info if available
      if (
        Spicetify.Player &&
        Spicetify.Player.data &&
        Spicetify.Player.data.track &&
        Spicetify.Player.data.track.album &&
        Spicetify.Player.data.track.album.uri
      ) {
        albumUri = Spicetify.Player.data.track.album.uri;
      } else {
        // Try to extract album ID from track URI and build album URI
        const trackId = track.uri.split(":").pop();
        if (trackId) {
          // Get album ID
          Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/tracks/${trackId}`)
            .then((response) => {
              if (response && response.album && response.album.id) {
                const albumId = response.album.id;
                albumUri = `spotify:album:${albumId}`;

                // Navigate to album page
                Spicetify.Platform.History.push(`/album/${albumId}`);
              }
            })
            .catch((error) => {
              console.error("Error fetching album info:", error);
              Spicetify.showNotification("Couldn't navigate to album", true);
            });
          return; // Exit early since we're using async approach
        }
      }

      if (albumUri) {
        const albumId = albumUri.split(":").pop();
        if (albumId) {
          Spicetify.Platform.History.push(`/album/${albumId}`);
        }
      } else {
        console.error("Could not determine album URI");
        Spicetify.showNotification("Couldn't navigate to album", true);
      }
    } catch (error) {
      console.error("Error navigating to album:", error);
      Spicetify.showNotification("Error navigating to album", true);
    }
  };

  const navigateToArtist = (artistName: string) => {
    try {
      if (track.uri.startsWith("spotify:local:")) {
        Spicetify.showNotification("Cannot navigate to artist for local files", true);
        return;
      }

      // Try to get artist URI from track data
      if (track.artists && track.artists.length > 0) {
        const artist = track.artists.find((a) => a.name === artistName);
        if (artist && (artist as any).uri) {
          // If we have the artist URI directly
          const artistId = (artist as any).uri.split(":").pop();
          if (artistId) {
            Spicetify.Platform.History.push(`/artist/${artistId}`);
            return;
          }
        }
      }

      const trackId = track.uri.split(":").pop();
      if (trackId) {
        Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/tracks/${trackId}`)
          .then((response) => {
            if (response && response.artists) {
              const artist = response.artists.find((a: any) => a.name === artistName);
              if (artist && artist.id) {
                Spicetify.Platform.History.push(`/artist/${artist.id}`);
                return;
              }
            }

            // Fallback - search for the artist
            Spicetify.Platform.History.push(`/search/${encodeURIComponent(artistName)}/artists`);
          })
          .catch((error) => {
            console.error("Error finding artist:", error);
            Spicetify.Platform.History.push(`/search/${encodeURIComponent(artistName)}/artists`);
          });
      } else {
        Spicetify.Platform.History.push(`/search/${encodeURIComponent(artistName)}/artists`);
      }
    } catch (error) {
      console.error("Error navigating to artist:", error);
      Spicetify.showNotification("Error navigating to artist", true);
    }
  };

  // Navigate to context (playlist, album, etc.)
  const navigateToContext = () => {
    if (!contextUri) {
      Spicetify.showNotification("No context available to navigate to", true);
      return;
    }

    try {
      const parts = contextUri.split(":");
      if (parts.length < 3) {
        Spicetify.showNotification("Invalid context URI", true);
        return;
      }

      const contextType = parts[1];
      const contextId = parts[2];

      switch (contextType) {
        case "playlist":
          Spicetify.Platform.History.push(`/playlist/${contextId}`);
          break;
        case "album":
          Spicetify.Platform.History.push(`/album/${contextId}`);
          break;
        case "artist":
          Spicetify.Platform.History.push(`/artist/${contextId}`);
          break;
        case "show":
          Spicetify.Platform.History.push(`/show/${contextId}`);
          break;
        case "collection":
          // Special case for Liked Songs
          if (parts.includes("tracks")) {
            Spicetify.Platform.History.push("/collection/tracks");
          }
          break;
        case "user":
          // For user context, likely Liked Songs
          Spicetify.Platform.History.push("/collection/tracks");
          break;
        default:
          console.log(`Unsupported context type: ${contextType}`);
          Spicetify.showNotification(`Cannot navigate to ${contextType}`, true);
      }
    } catch (error) {
      console.error("Error navigating to context:", error);
      Spicetify.showNotification("Error navigating to context", true);
    }
  };

  const handleEnergyInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    onSetEnergy(value);
  };

  const handleEnergyClick = (e: React.MouseEvent<HTMLInputElement>) => {
    // Get the clicked position and calculate the corresponding energy value
    const sliderElement = e.currentTarget;
    const rect = sliderElement.getBoundingClientRect();
    const clickPosition = e.clientX - rect.left;
    const sliderWidth = rect.width;
    const percentage = clickPosition / sliderWidth;

    // Calculate energy value (1-10)
    const min = 1;
    const max = 10;
    let energy = Math.round(min + percentage * (max - min));

    energy = Math.max(min, Math.min(max, energy));

    onSetEnergy(energy);
  };

  return (
    <div className={styles.container}>
      {onToggleLock && (
        <div className={styles.lockControlContainer}>
          {isLocked && currentTrack && currentTrack.uri !== track.uri && (
            <button
              className={styles.switchTrackButton}
              onClick={() => {
                if (onSwitchToCurrentTrack) {
                  onSwitchToCurrentTrack(currentTrack);
                }
              }}
              title="Switch to currently playing track"
            >
              <span className={styles.buttonIcon}></span>
              Switch to current
            </button>
          )}

          <button
            className={`${styles.lockButton} ${isLocked ? styles.locked : styles.unlocked}`}
            onClick={handleToggleLock}
            title={isLocked ? "Unlock to follow currently playing track" : "Lock to this track"}
          >
            {isLocked ? "🔒" : "🔓"}
          </button>
        </div>
      )}
      <div className={styles.contentLayout}>
        {/* Left side - Track info with album art */}
        <div className={styles.trackInfoContainer}>
          {/* Wrap album cover and warning in a column container */}
          <div className={styles.albumSection}>
            <div className={styles.albumCoverContainer}>
              <div
                className={styles.albumCoverClickable}
                onClick={() => navigateToAlbum()}
                title={
                  track.uri?.startsWith("spotify:local:") ? "Go to Local Files" : "Go to album"
                }
              >
                {isLoadingCover ? (
                  <div className={styles.albumCoverPlaceholder}>
                    <div className={styles.albumCoverLoading}></div>
                  </div>
                ) : albumCover ? (
                  <img
                    src={albumCover}
                    alt={`${track.album?.name || "Album"} cover`}
                    className={styles.albumCover}
                  />
                ) : (
                  <div className={styles.albumCoverPlaceholder}>
                    <span className={styles.albumCoverIcon}>♫</span>
                  </div>
                )}
              </div>
              <button
                className={styles.playButton}
                onClick={handlePlayTrack}
                title={"Play this track"}
              >
                {"Play"}
              </button>
            </div>
          </div>

          <div className={styles.trackInfo}>
            <h2
              className={styles.trackTitle}
              onClick={() => navigateToAlbum()}
              title={track.uri?.startsWith("spotify:local:") ? "Go to Local Files" : "Go to album"}
            >
              {track.name || "Unknown Track"}
              {track.uri?.startsWith("spotify:local:") && (
                <span style={{ fontSize: "0.8em", opacity: 0.7, marginLeft: "6px" }}>(Local)</span>
              )}
            </h2>
            <p className={styles.trackArtist}>
              {track.artists && track.artists.length > 0
                ? track.artists.map((artist, idx, arr) => (
                    <React.Fragment key={idx}>
                      <span
                        className={`${styles.clickableArtist}`}
                        onClick={() => navigateToArtist(artist.name)}
                        title={`Go to ${artist.name}`}
                      >
                        {artist.name}
                      </span>
                      {idx < arr.length - 1 && ", "}
                    </React.Fragment>
                  ))
                : "Unknown Artist"}
            </p>
            <p className={styles.trackAlbum}>{track.album?.name || "Unknown Album"}</p>

            {/* New Track Metadata Section */}
            <div className={styles.trackMetadata}>
              {isLoadingMetadata ? (
                <div className={styles.metadataLoading}>Loading details...</div>
              ) : (
                <>
                  <div className={styles.metadataGrid}>
                    {trackMetadata.releaseDate && (
                      <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Released:</span>
                        <span className={styles.metadataValue}>{trackMetadata.releaseDate}</span>
                      </div>
                    )}

                    {trackMetadata.trackLength && (
                      <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Length:</span>
                        <span className={styles.metadataValue}>{trackMetadata.trackLength}</span>
                      </div>
                    )}

                    <div className={styles.metadataItem}>
                      <span className={styles.metadataLabel}>BPM:</span>
                      <div className={styles.bpmContainer}>
                        {isEditingBpm ? (
                          <div className={styles.bpmEditContainer}>
                            <input
                              type="number"
                              value={editBpmValue}
                              onChange={(e) => setEditBpmValue(e.target.value)}
                              onKeyDown={handleBpmKeyDown}
                              onBlur={handleBpmCancel}
                              className={styles.bpmEditInput}
                              placeholder="Enter BPM"
                              min="1"
                              max="300"
                              autoFocus
                            />
                            <button
                              className={styles.bpmSaveButton}
                              onMouseDown={handleBpmSaveMouseDown}
                              title="Save BPM"
                            >
                              ✓
                            </button>
                            <button
                              className={styles.bpmCancelButton}
                              onMouseDown={handleBpmCancelMouseDown}
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className={styles.bpmDisplayContainer}>
                            <span
                              className={`${styles.metadataValue} ${styles.editableBpm}`}
                              onClick={handleBpmClick}
                              title="Click to edit BPM"
                            >
                              {trackData.bpm || trackMetadata.bpm || "Unknown"}
                            </span>

                            {!track.uri.startsWith("spotify:local:") && (
                              <button
                                className={styles.bpmRefreshButton}
                                onClick={handleRefreshBpm}
                                disabled={isRefreshingBpm}
                                title="Fetch latest BPM from Spotify"
                              >
                                {isRefreshingBpm ? (
                                  <span className={styles.refreshSpinner}>⟳</span>
                                ) : (
                                  "↻"
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {trackMetadata.playCount !== null && (
                      <div className={styles.metadataItem}>
                        <span className={styles.metadataLabel}>Plays:</span>
                        <span className={styles.metadataValue}>
                          {trackMetadata.playCount.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {trackMetadata.sourceContext && (
                    <div className={styles.metadataContext}>
                      <span className={styles.metadataLabel}>Playing from:</span>{" "}
                      <span
                        className={`${styles.metadataValue} ${styles.contextLink}`}
                        onClick={() => navigateToContext()}
                        title="Go to source"
                      >
                        {trackMetadata.sourceContext}
                      </span>
                    </div>
                  )}

                  {/* Spotify genre tags */}
                  {/* {trackMetadata.genres.length > 0 && (
                    <div className={styles.metadataGenres}>
                      <span className={styles.metadataLabel}>Genres:</span>{" "}
                      <div className={styles.genreTags}>
                        {trackMetadata.genres.map((genre, index) => (
                          <span key={index} className={styles.genreTag}>
                            {genre}
                          </span>
                        ))}
                      </div>
                    </div>
                  )} */}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right side - Controls and metadata */}
        <div className={styles.controlsContainer}>
          {/* Rating */}
          <div className={styles.controlSection}>
            <label className={styles.label}>
              Rating: {trackData.rating > 0 ? trackData.rating : ""}
            </label>
            <div className={styles.ratingContainer}>
              <div className={styles.stars} key={`stars-${trackData.rating}`}>
                <ReactStars
                  count={5}
                  value={trackData.rating || 0}
                  onChange={(newRating: number) => onSetRating(newRating)}
                  size={24}
                  isHalf={true}
                  emptyIcon={<i className="far fa-star"></i>}
                  halfIcon={<i className="fa fa-star-half-alt"></i>}
                  fullIcon={<i className="fa fa-star"></i>}
                  activeColor="#ffd700"
                  color="var(--spice-button-disabled)"
                />
              </div>

              {trackData.rating > 0 && (
                <button
                  className={styles.clearButton}
                  onClick={() => onSetRating(0)}
                  aria-label="Clear rating"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Energy Level */}
          <div className={styles.controlSection}>
            <label className={styles.label}>
              Energy Level:
              {trackData.energy > 0 && (
                <span className={styles.energyValue}>{trackData.energy}</span>
              )}
            </label>
            <div className={styles.energyContainer}>
              <input
                type="range"
                min="1"
                max="10"
                value={trackData.energy || 5}
                data-is-set={trackData.energy > 0 ? "true" : "false"}
                className={`${styles.energySlider} ${
                  trackData.energy === 0 ? styles.energySliderUnset : ""
                }`}
                onChange={handleEnergyInput}
                onClick={handleEnergyClick}
                onDoubleClick={() => {
                  // Clear on double click
                  onSetEnergy(0);
                }}
              />
              {trackData.energy > 0 && (
                <button
                  className={styles.clearButton}
                  onClick={handleRemoveEnergy}
                  aria-label="Clear energy rating"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* TAGS SECTION */}
      <div className={styles.tagsSection}>
        {/* Timestamp metadata */}
        {(trackData.dateCreated || trackData.dateModified) && (
          <div className={styles.timestampMetadata}>
            <div className={styles.timestampRow}>
              {trackData.dateCreated && (
                <div
                  className={styles.timestampItem}
                  title={"Created: " + new Date(trackData.dateCreated).toLocaleString()}
                >
                  <span className={styles.timestampLabel}>Tagged:</span>
                  <span className={styles.timestampValue}>
                    {formatTimestamp(trackData.dateCreated)}
                  </span>
                </div>
              )}
              {trackData.dateModified && trackData.dateModified !== trackData.dateCreated && (
                <div
                  className={styles.timestampItem}
                  title={"Last updated: " + new Date(trackData.dateModified).toLocaleString()}
                >
                  <span className={styles.timestampLabel}>Updated:</span>
                  <span className={styles.timestampValue}>
                    {formatTimestamp(trackData.dateModified)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        {Object.values(groupedTags).every((category) =>
          Object.values(category.subcategories).every(
            (subcategory) => subcategory.tags.length === 0
          )
        ) ? (
          <p className={styles.noTags}>No tags applied</p>
        ) : (
          <div className={styles.tagCategories}>
            {/* Filter categories to only show those with tags */}
            {Object.entries(groupedTags)
              .filter(([, categoryData]) => {
                // Check if this category has any subcategories with tags
                return Object.values(categoryData.subcategories).some(
                  (subcategory) => subcategory.tags.length > 0
                );
              })
              .sort(([, a], [, b]) => a.categoryOrder - b.categoryOrder)
              .map(([categoryId, category]) => (
                <div key={categoryId} className={styles.tagCategory}>
                  <h4 className={styles.categoryName}>{category.categoryName}</h4>

                  {/* Only show subcategories that have tags */}
                  {Object.entries(category.subcategories)
                    .filter(([, subcategory]) => subcategory.tags.length > 0)
                    .sort(([, a], [, b]) => a.subcategoryOrder - b.subcategoryOrder)
                    .map(([subcategoryId, subcategory]) => (
                      <div key={subcategoryId} className={styles.tagSubcategory}>
                        <h5 className={styles.subcategoryName}>{subcategory.subcategoryName}</h5>

                        <div className={styles.tagList}>
                          {subcategory.tags.map((tag) => {
                            return (
                              <div
                                key={tag.id}
                                className={`${styles.tagItem} ${
                                  activeTagFilters.includes(tag.name) ? styles.tagFilter : ""
                                } ${
                                  excludedTagFilters.includes(tag.name) ? styles.tagExcluded : ""
                                }`}
                                onClick={() => handleTagClick(tag.name)}
                                title={
                                  activeTagFilters.includes(tag.name)
                                    ? `Click to remove filter for "${tag.name}"`
                                    : excludedTagFilters.includes(tag.name)
                                    ? `Click to remove "${tag.name}" filter`
                                    : `Click to include "${tag.name}"`
                                }
                              >
                                <span className={styles.tagName}>{tag.name}</span>
                                <button
                                  className={styles.removeTag}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveTag(categoryId, subcategoryId, tag.id);
                                  }}
                                  aria-label={`Remove tag ${tag.name}`}
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackDetails;
