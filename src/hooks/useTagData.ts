import { useState, useEffect, useRef } from "react";
import { TrackInfoCacheManager } from "../utils/TrackInfoCache";

export interface Tag {
  name: string;
  id: string;
}

export interface TagSubcategory {
  name: string;
  id: string;
  tags: Tag[];
}

export interface TagCategory {
  name: string;
  id: string;
  subcategories: TagSubcategory[];
}

export interface TrackTag {
  tagId: string;
  subcategoryId: string;
  categoryId: string;
}

export interface TrackData {
  rating: number;
  energy: number;
  bpm: number | null;
  tags: TrackTag[];
  dateCreated?: number;
  dateModified?: number;
}

export interface TagDataStructure {
  categories: TagCategory[];
  tracks: {
    [trackUri: string]: TrackData;
  };
}

// Default tag structure with 4 main categories
const defaultTagData: TagDataStructure = {
  categories: [
    {
      name: "Genre & Style",
      id: "genre-style",
      subcategories: [
        {
          name: "Primary Genres",
          id: "primary-genres",
          tags: [
            { name: "Rock", id: "rock" },
            { name: "Pop", id: "pop" },
            { name: "Hip-Hop", id: "hip-hop" },
            { name: "Electronic", id: "electronic" },
            { name: "Jazz", id: "jazz" },
            { name: "Classical", id: "classical" },
            { name: "Country", id: "country" },
            { name: "R&B", id: "rnb" },
          ],
        },
        {
          name: "Sub-genres",
          id: "sub-genres",
          tags: [
            { name: "Alternative", id: "alternative" },
            { name: "Indie", id: "indie" },
            { name: "Folk", id: "folk" },
            { name: "Funk", id: "funk" },
            { name: "Blues", id: "blues" },
            { name: "Reggae", id: "reggae" },
          ],
        },
        {
          name: "Era & Decade",
          id: "era-decade",
          tags: [
            { name: "Vintage", id: "vintage" },
            { name: "80s", id: "80s" },
            { name: "90s", id: "90s" },
            { name: "2000s", id: "2000s" },
            { name: "Modern", id: "modern" },
          ],
        },
      ],
    },
    {
      name: "Mood & Energy",
      id: "mood-energy",
      subcategories: [
        {
          name: "Energy Level",
          id: "energy-level",
          tags: [
            { name: "High Energy", id: "high-energy" },
            { name: "Upbeat", id: "upbeat" },
            { name: "Moderate", id: "moderate" },
            { name: "Chill", id: "chill" },
            { name: "Mellow", id: "mellow" },
            { name: "Slow", id: "slow" },
          ],
        },
        {
          name: "Emotional Tone",
          id: "emotional-tone",
          tags: [
            { name: "Happy", id: "happy" },
            { name: "Sad", id: "sad" },
            { name: "Angry", id: "angry" },
            { name: "Romantic", id: "romantic" },
            { name: "Nostalgic", id: "nostalgic" },
            { name: "Peaceful", id: "peaceful" },
            { name: "Dramatic", id: "dramatic" },
          ],
        },
        {
          name: "Atmosphere",
          id: "atmosphere",
          tags: [
            { name: "Dark", id: "dark" },
            { name: "Bright", id: "bright" },
            { name: "Dreamy", id: "dreamy" },
            { name: "Intense", id: "intense" },
            { name: "Mysterious", id: "mysterious" },
            { name: "Playful", id: "playful" },
          ],
        },
      ],
    },
    {
      name: "Musical Elements",
      id: "musical-elements",
      subcategories: [
        {
          name: "Vocals",
          id: "vocals",
          tags: [
            { name: "Male Vocals", id: "male-vocals" },
            { name: "Female Vocals", id: "female-vocals" },
            { name: "Duet", id: "duet" },
            { name: "Choir", id: "choir" },
            { name: "Instrumental", id: "instrumental" },
            { name: "Rap", id: "rap" },
          ],
        },
        {
          name: "Instruments",
          id: "instruments",
          tags: [
            { name: "Guitar", id: "guitar" },
            { name: "Piano", id: "piano" },
            { name: "Strings", id: "strings" },
            { name: "Brass", id: "brass" },
            { name: "Drums", id: "drums" },
            { name: "Synth", id: "synth" },
            { name: "Bass", id: "bass" },
          ],
        },
        {
          name: "Production Style",
          id: "production-style",
          tags: [
            { name: "Acoustic", id: "acoustic" },
            { name: "Electric", id: "electric" },
            { name: "Live Recording", id: "live-recording" },
            { name: "Studio", id: "studio" },
            { name: "Lo-fi", id: "lo-fi" },
            { name: "Polished", id: "polished" },
          ],
        },
      ],
    },
    {
      name: "Usage & Context",
      id: "usage-context",
      subcategories: [
        {
          name: "Activity",
          id: "activity",
          tags: [
            { name: "Workout", id: "workout" },
            { name: "Study", id: "study" },
            { name: "Party", id: "party" },
            { name: "Relaxation", id: "relaxation" },
            { name: "Driving", id: "driving" },
            { name: "Sleep", id: "sleep" },
          ],
        },
        {
          name: "Time & Season",
          id: "time-season",
          tags: [
            { name: "Morning", id: "morning" },
            { name: "Evening", id: "evening" },
            { name: "Summer", id: "summer" },
            { name: "Winter", id: "winter" },
            { name: "Holiday", id: "holiday" },
          ],
        },
        {
          name: "Social Context",
          id: "social-context",
          tags: [
            { name: "Solo Listening", id: "solo-listening" },
            { name: "Background Music", id: "background-music" },
            { name: "Dancing", id: "dancing" },
            { name: "Singing Along", id: "singing-along" },
            { name: "Focus Music", id: "focus-music" },
          ],
        },
      ],
    },
  ],
  tracks: {},
};

const STORAGE_KEY = "tagify:tagData";

export function useTagData() {
  const [tagData, setTagData] = useState<TagDataStructure>(defaultTagData);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const playlistAdditionTimeouts = useRef<Map<string, number>>(new Map());

  const saveToLocalStorage = (data: TagDataStructure) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      // Dispatch a custom event to notify extensions
      const event = new CustomEvent("tagify:dataUpdated", {
        detail: { type: "save" },
      });
      window.dispatchEvent(event);
      return true;
    } catch (error) {
      console.error("Tagify: Error saving to localStorage", error);
      return false;
    }
  };

  const loadFromLocalStorage = (): TagDataStructure | null => {
    try {
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (savedData) {
        return JSON.parse(savedData);
      }
    } catch (error) {
      console.error("Tagify: Error loading from localStorage", error);
    }
    return null;
  };

  const loadTagData = () => {
    setIsLoading(true);

    // Try loading from localStorage
    const localData = loadFromLocalStorage();
    if (localData && localData.categories && Array.isArray(localData.categories)) {
      setTagData(localData);
      setLastSaved(new Date());
    } else {
      // If no data in localStorage or data is invalid, use default
      setTagData(defaultTagData);
      // Save the default data to localStorage to prevent future issues
      saveToLocalStorage(defaultTagData);
    }

    setIsLoading(false);
  };

  const saveTagData = (data: TagDataStructure) => {
    const saved = saveToLocalStorage(data);
    if (saved) {
      setLastSaved(new Date());
    }
    return saved;
  };

  const exportBackup = () => {
    const jsonData = JSON.stringify(tagData, null, 2);
    const blob = new Blob([jsonData], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `tagify-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);

    Spicetify.showNotification("Backup saved in 'Downloads' folder");
  };

  const importBackup = (backupData: TagDataStructure) => {
    setTagData(backupData);
    saveTagData(backupData);
    Spicetify.showNotification("Data restored from backup");
  };

  // Load tag data on component mount
  useEffect(() => {
    loadTagData();
  }, []);

  // Auto-save when data changes
  useEffect(() => {
    if (!isLoading) {
      // Only save after initial load is complete
      const timer = setTimeout(() => {
        saveTagData(tagData);
      }, 2000); // Debounce for performance

      return () => clearTimeout(timer);
    }
  }, [tagData, isLoading]);

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear all pending timeouts when component unmounts
      playlistAdditionTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      playlistAdditionTimeouts.current.clear();
    };
  }, []);

  // ! CATEGORY MANAGEMENT

  const replaceCategories = (newCategories: TagCategory[]) => {
    // Clean up orphaned tags in tracks
    const updatedTracks = { ...tagData.tracks };

    Object.keys(updatedTracks).forEach((uri) => {
      const trackTags = updatedTracks[uri].tags;
      const validTags = trackTags.filter((tag) => {
        const category = newCategories.find((c) => c.id === tag.categoryId);
        if (!category) return false;

        const subcategory = category.subcategories.find((s) => s.id === tag.subcategoryId);
        if (!subcategory) return false;

        const tagExists = subcategory.tags.find((t) => t.id === tag.tagId);
        return !!tagExists;
      });

      updatedTracks[uri] = {
        ...updatedTracks[uri],
        tags: validTags,
      };

      // Remove track if it becomes empty after tag cleanup
      if (isTrackEmpty(updatedTracks[uri])) {
        TrackInfoCacheManager.removeTrackInfo(uri);
      }
    });

    setTagData({
      categories: newCategories,
      tracks: updatedTracks,
    });
  };

  // ! TRACK TAG MANAGEMENT

  // Ensure track data exists for a given URI
  const getOrCreateTrackData = (trackUri: string) => {
    if (!tagData.tracks[trackUri]) {
      const now = Date.now();
      const newTagData = {
        ...tagData,
        tracks: {
          ...tagData.tracks,
          [trackUri]: {
            rating: 0,
            energy: 0,
            bpm: null,
            tags: [],
            dateCreated: now,
            dateModified: now,
          },
        },
      };
      setTagData(newTagData);
      return newTagData;
    }
    return tagData;
  };

  const updateTrackWithTimestamp = (trackUri: string, updates: Partial<TrackData>) => {
    const currentData = getOrCreateTrackData(trackUri);
    const existingTrack = currentData.tracks[trackUri];

    const updatedTrack = {
      ...existingTrack,
      ...updates,
      dateModified: Date.now(),
      dateCreated: existingTrack.dateCreated || Date.now(),
    };

    setTagData({
      ...currentData,
      tracks: {
        ...currentData.tracks,
        [trackUri]: updatedTrack,
      },
    });
  };

  const fetchBPM = async (trackUri: string): Promise<number | null> => {
    try {
      // Skip local files
      if (trackUri.startsWith("spotify:local:")) {
        return null;
      }

      // Extract track ID
      const trackId = trackUri.split(":").pop();
      if (!trackId) return null;

      // Fetch audio features from Spotify API
      const audioFeatures = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/audio-features/${trackId}`
      );

      // Return rounded BPM value
      if (audioFeatures && audioFeatures.tempo) {
        return Math.round(audioFeatures.tempo);
      }
      return null;
    } catch (error) {
      console.error("Error fetching BPM:", error);
      return null;
    }
  };

  const updateBPM = async (trackUri: string) => {
    try {
      const bpm = await fetchBPM(trackUri);
      if (bpm !== null) {
        setBpm(trackUri, bpm);
      }
    } catch (error) {
      console.error("Error updating BPM:", error);
    }
  };

  const setBpm = (trackUri: string, bpm: number | null) => {
    // Ensure track data exists
    const currentData = getOrCreateTrackData(trackUri);
    const trackData = currentData.tracks[trackUri];

    // Check if this would make the track empty
    if (
      bpm === null &&
      trackData.rating === 0 &&
      trackData.energy === 0 &&
      trackData.tags.length === 0
    ) {
      TrackInfoCacheManager.removeTrackInfo(trackUri);

      // Create new state by removing this track
      const { [trackUri]: _, ...remainingTracks } = currentData.tracks;

      setTagData({
        ...currentData,
        tracks: remainingTracks,
      });
    } else {
      // Update state with modified track and timestamps
      const now = Date.now();
      setTagData({
        ...currentData,
        tracks: {
          ...currentData.tracks,
          [trackUri]: {
            ...trackData,
            bpm,
            dateCreated: trackData.dateCreated || now,
            dateModified: now,
          },
        },
      });
    }
  };

  const findCommonTags = (trackUris: string[]): TrackTag[] => {
    if (trackUris.length === 0) return [];

    // Get tags from the first track
    const firstTrackTags = tagData.tracks[trackUris[0]]?.tags || [];

    if (trackUris.length === 1) return firstTrackTags;

    // Check which tags exist in all tracks
    return firstTrackTags.filter((tag) => {
      return trackUris.every((uri) => {
        const trackTags = tagData.tracks[uri]?.tags || [];
        return trackTags.some(
          (t) =>
            t.categoryId === tag.categoryId &&
            t.subcategoryId === tag.subcategoryId &&
            t.tagId === tag.tagId
        );
      });
    });
  };

  const isTrackEmpty = (trackData: TrackData): boolean => {
    return (
      trackData.rating === 0 &&
      trackData.energy === 0 &&
      trackData.bpm === null &&
      trackData.tags.length === 0
    );
  };

  const toggleTagForTrack = (
    trackUri: string,
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => {
    // Ensure track data exists
    const currentData = getOrCreateTrackData(trackUri);
    const trackData = currentData.tracks[trackUri];

    // Find if tag already exists
    const existingTagIndex = trackData.tags.findIndex(
      (t) => t.categoryId === categoryId && t.subcategoryId === subcategoryId && t.tagId === tagId
    );

    let updatedTags;
    if (existingTagIndex >= 0) {
      // Remove tag if it exists
      updatedTags = [
        ...trackData.tags.slice(0, existingTagIndex),
        ...trackData.tags.slice(existingTagIndex + 1),
      ];
    } else {
      // Add tag if it doesn't exist
      updatedTags = [...trackData.tags, { categoryId, subcategoryId, tagId }];

      // Schedule adding to TAGGED playlist if this makes the track non-empty
      if (updatedTags.length === 1 && trackData.rating === 0 && trackData.energy === 0) {
        fetchBPM(trackUri)
          .then((bpm) => {
            if (bpm !== null) {
              setTagData((prevState) => {
                const currentTrackData = prevState.tracks[trackUri];
                if (!currentTrackData) return prevState;

                const now = Date.now();
                return {
                  ...prevState,
                  tracks: {
                    ...prevState.tracks,
                    [trackUri]: {
                      ...currentTrackData,
                      bpm: bpm,
                      dateCreated: currentTrackData.dateCreated || now,
                      dateModified: now,
                    },
                  },
                };
              });
            }
          })
          .catch((error) => {
            console.error("Error fetching BPM:", error);
          });
      }
    }

    // Prepare updated track data
    const now = Date.now();
    const updatedTrackData = {
      ...trackData,
      tags: updatedTags,
      dateCreated: trackData.dateCreated || now,
      dateModified: now,
    };

    // Check if the track is now empty
    if (isTrackEmpty(updatedTrackData)) {
      TrackInfoCacheManager.removeTrackInfo(trackUri);

      // Create new state by removing this track
      const { [trackUri]: _, ...remainingTracks } = currentData.tracks;

      setTagData({
        ...currentData,
        tracks: remainingTracks,
      });
    } else {
      // Update state with modified track
      setTagData({
        ...currentData,
        tracks: {
          ...currentData.tracks,
          [trackUri]: updatedTrackData,
        },
      });
    }
  };

  const toggleTagForMultipleTracks = (
    trackUris: string[],
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => {
    // Create a copy of the current tagData
    const updatedTagData = { ...tagData };
    const now = Date.now();

    // Check if all tracks have this tag
    const allHaveTag = trackUris.every((uri) => {
      const trackTags = updatedTagData.tracks[uri]?.tags || [];
      return trackTags.some(
        (t) => t.categoryId === categoryId && t.subcategoryId === subcategoryId && t.tagId === tagId
      );
    });

    // Process each track
    trackUris.forEach((uri) => {
      // Ensure track data exists
      if (!updatedTagData.tracks[uri]) {
        updatedTagData.tracks[uri] = {
          rating: 0,
          energy: 0,
          bpm: null,
          tags: [],
          dateCreated: now,
          dateModified: now,
        };
      }

      const trackData = updatedTagData.tracks[uri];
      const hasTag = trackData.tags.some(
        (t) => t.categoryId === categoryId && t.subcategoryId === subcategoryId && t.tagId === tagId
      );

      if (allHaveTag) {
        // Remove tag if all have it
        if (hasTag) {
          const existingTagIndex = trackData.tags.findIndex(
            (t) =>
              t.categoryId === categoryId && t.subcategoryId === subcategoryId && t.tagId === tagId
          );

          updatedTagData.tracks[uri] = {
            ...trackData,
            tags: [
              ...trackData.tags.slice(0, existingTagIndex),
              ...trackData.tags.slice(existingTagIndex + 1),
            ],
            dateCreated: trackData.dateCreated || now,
            dateModified: now,
          };

          if (
            updatedTagData.tracks[uri].tags.length === 0 &&
            updatedTagData.tracks[uri].rating === 0 &&
            updatedTagData.tracks[uri].energy === 0
          ) {
            TrackInfoCacheManager.removeTrackInfo(uri);
          }
        }
      } else {
        // Add tag if not all have it
        if (!hasTag) {
          updatedTagData.tracks[uri] = {
            ...trackData,
            tags: [...trackData.tags, { categoryId, subcategoryId, tagId }],
            dateCreated: trackData.dateCreated || now,
            dateModified: now,
          };
        }
      }
    });

    // Clean up empty tracks
    Object.keys(updatedTagData.tracks).forEach((uri) => {
      const trackData = updatedTagData.tracks[uri];
      if (trackData.rating === 0 && trackData.energy === 0 && trackData.tags.length === 0) {
        // Remove empty track
        const { [uri]: _, ...remainingTracks } = updatedTagData.tracks;
        updatedTagData.tracks = remainingTracks;
      }
    });

    // Update the state once with all changes
    setTagData(updatedTagData);
  };

  const setRating = (trackUri: string, rating: number) => {
    // Ensure track data exists
    const currentData = getOrCreateTrackData(trackUri);
    const trackData = currentData.tracks[trackUri];

    // If this is the first rating for an otherwise empty track, fetch BPM
    if (
      rating > 0 &&
      trackData.rating === 0 &&
      trackData.energy === 0 &&
      trackData.tags.length === 0
    ) {
      fetchBPM(trackUri)
        .then((bpm) => {
          if (bpm !== null) {
            setTagData((prevState) => {
              const currentTrackData = prevState.tracks[trackUri];
              if (!currentTrackData) return prevState;

              const now = Date.now();
              return {
                ...prevState,
                tracks: {
                  ...prevState.tracks,
                  [trackUri]: {
                    ...currentTrackData,
                    bpm: bpm,
                    dateCreated: currentTrackData.dateCreated || now,
                    dateModified: now,
                  },
                },
              };
            });
          }
        })
        .catch((error) => {
          console.error("Error fetching BPM:", error);
        });
    }

    // Check if this would make the track empty
    if (rating === 0 && trackData.energy === 0 && trackData.tags.length === 0) {
      TrackInfoCacheManager.removeTrackInfo(trackUri);

      // Create new state by removing this track
      const { [trackUri]: _, ...remainingTracks } = currentData.tracks;

      setTagData({
        ...currentData,
        tracks: remainingTracks,
      });
    } else {
      const now = Date.now();
      setTagData({
        ...currentData,
        tracks: {
          ...currentData.tracks,
          [trackUri]: {
            ...trackData,
            rating,
            dateCreated: trackData.dateCreated || now,
            dateModified: now,
          },
        },
      });
    }
  };

  // Set energy level for a track (0 means no energy rating)
  const setEnergy = (trackUri: string, energy: number) => {
    // Ensure track data exists
    const currentData = getOrCreateTrackData(trackUri);
    const trackData = currentData.tracks[trackUri];

    // If this is the first energy setting for an otherwise empty track, fetch BPM
    if (
      energy > 0 &&
      trackData.rating === 0 &&
      trackData.energy === 0 &&
      trackData.tags.length === 0
    ) {
      fetchBPM(trackUri)
        .then((bpm) => {
          if (bpm !== null) {
            setTagData((prevState) => {
              const currentTrackData = prevState.tracks[trackUri];
              if (!currentTrackData) return prevState;

              const now = Date.now();
              return {
                ...prevState,
                tracks: {
                  ...prevState.tracks,
                  [trackUri]: {
                    ...currentTrackData,
                    bpm: bpm,
                    dateCreated: currentTrackData.dateCreated || now,
                    dateModified: now,
                  },
                },
              };
            });
          }
        })
        .catch((error) => {
          console.error("Error fetching BPM:", error);
        });
    }

    // Check if this would make the track empty
    if (energy === 0 && trackData.rating === 0 && trackData.tags.length === 0) {
      TrackInfoCacheManager.removeTrackInfo(trackUri);

      // Create new state by removing this track
      const { [trackUri]: _, ...remainingTracks } = currentData.tracks;

      setTagData({
        ...currentData,
        tracks: remainingTracks,
      });
    } else {
      // Update state with modified track and timestamps
      const now = Date.now();
      setTagData({
        ...currentData,
        tracks: {
          ...currentData.tracks,
          [trackUri]: {
            ...trackData,
            energy,
            dateCreated: trackData.dateCreated || now,
            dateModified: now,
          },
        },
      });
    }
  };

  const findTagName = (categoryId: string, subcategoryId: string, tagId: string): string => {
    const category = tagData.categories.find((c) => c.id === categoryId);
    if (!category) return "";

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return "";

    const tag = subcategory.tags.find((t) => t.id === tagId);
    return tag ? tag.name : "";
  };

  // Export data for rekordbox integration
  const exportData = () => {
    const exportResult: any = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      tracks: {},
    };

    // Format track data for export
    Object.entries(tagData.tracks).forEach(([uri, data]) => {
      // Skip tracks that have no meaningful data
      if (data.rating === 0 && data.energy === 0 && (!data.tags || data.tags.length === 0)) {
        return;
      }

      const tagNames = data.tags
        .map((tag) => findTagName(tag.categoryId, tag.subcategoryId, tag.tagId))
        .filter((name) => name !== "");

      const energyComment = data.energy > 0 ? `Energy ${data.energy} - ` : "";
      const bpmComment = data.bpm !== null ? `BPM ${data.bpm} - ` : "";

      // Format for rekordbox
      exportResult.tracks[uri] = {
        rating: data.rating,
        energy: data.energy,
        bpm: data.bpm,
        tags: data.tags.map((tag) => ({
          categoryId: tag.categoryId,
          subcategoryId: tag.subcategoryId,
          tagId: tag.tagId,
          name: findTagName(tag.categoryId, tag.subcategoryId, tag.tagId),
        })),
        rekordbox_comment:
          tagNames.length > 0
            ? `${bpmComment}${energyComment}${tagNames.join(", ")}`
            : (bpmComment + energyComment).length > 0
            ? (bpmComment + energyComment).slice(0, -3)
            : "", // Remove trailing " - " if no tags
      };
    });

    return exportResult;
  };

  return {
    tagData,
    isLoading,
    lastSaved,

    // Track tag management
    toggleTagForTrack,
    setRating,
    setEnergy,
    setBpm,
    toggleTagForMultipleTracks,
    findCommonTags,

    // Category management
    replaceCategories,

    // Import/Export
    exportData,
    exportBackup,
    importBackup,
  };
}
