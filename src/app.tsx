import React, { useCallback, useRef, useEffect, useMemo, useState } from "react";
import styles from "./app.module.css";
import "./styles/globals.css";
import packageJson from "@/package";
import { defaultTagData } from "@/constants/defaultTagData";
import {
  DataManager,
  ExportModal,
  MigrationResultModal,
  TagManager,
  TagSelector,
  ArtistMetadata,
  PlaylistMetadata,
  useTagData,
} from "@/features/tag-data";
import { PlaylistTrackApplyMode, TagDataStructure } from "@/types/tagData";
import {
  TrackDetails,
  TrackList,
  useSpicetifyHistory,
  useTrackState,
} from "@/features/track-session";
import { useFilterState } from "@/features/filter-state";
import {
  LocalTracksModal,
  PlaylistDetails,
  TaggedPlaylistsList,
  usePlaylistState,
} from "@/features/playlist-state";
import { ArtistDetails, TaggedArtistsList } from "@/features/artist-state";
import { useFontAwesome } from "./hooks/shared/useFontAwesome";
import { trackService } from "./services/TrackService";
import { UpdateBanner, useUpdateChecker } from "@/features/update-check";
import { MultiTrackDetails, useMultiTrackTagging } from "@/features/multi-track-tagging";
import { useSmartPlaylists } from "@/features/smart-playlists";
import {
  DiscoverySurveyModal,
  useDiscoverySurvey,
} from "@/features/discovery-survey";
import { PowerUserModal, usePowerUserModal } from "@/features/power-user";
import { useGlobalKeyboardShortcuts } from "./hooks/shared/useGlobalKeyboardShortcuts";
import { useMetadataBackfill } from "@/features/metadata-backfill";
import { graphqlRateLimiter } from "./utils/RateLimiter";
import { audioFeaturesRateLimiter } from "./services/AudioFeaturesService";
import { spotifyApiService } from "./services/SpotifyApiService";
import { pruneTagFilterFormula } from "@/utils/tagFilterGroups";
import { buildCategoryTree, buildValidTagIdSet } from "@/utils/tagTaxonomy";

const EMPTY_TRACK_DETAILS_DATA = {
  rating: 0,
  energy: 0,
  bpm: null,
  camelotKey: null,
  tagIds: [],
};

type AppView = "tracks" | "albums" | "playlists" | "artists";

const LAST_ACTIVE_VIEW_STORAGE_KEY = "tagify:lastActiveView";
const SHORTCUT_TARGET_STORAGE_KEY = "tagify:shortcutTarget";

function isAppView(value: string | null): value is AppView {
  return (
    value === "tracks" ||
    value === "albums" ||
    value === "playlists" ||
    value === "artists"
  );
}

function getPlaylistViewForUri(playlistUri: string): Extract<AppView, "albums" | "playlists"> {
  return playlistUri.startsWith("spotify:album:") ? "albums" : "playlists";
}

function getStoredActiveView(): AppView {
  try {
    const storedView = localStorage.getItem(LAST_ACTIVE_VIEW_STORAGE_KEY);
    return isAppView(storedView) ? storedView : "tracks";
  } catch {
    return "tracks";
  }
}

function App() {
  const [showTagManager, setShowTagManager] = useState<boolean>(false);
  const [expandedTagManagerCategoryIds, setExpandedTagManagerCategoryIds] =
    useState<string[] | undefined>(undefined);
  const [selectedTagManagerSubcategoryId, setSelectedTagManagerSubcategoryId] =
    useState<string | null | undefined>(undefined);
  const [showExport, setShowExport] = useState<boolean>(false);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [activeView, setActiveView] = useState<AppView>(getStoredActiveView);
  const [activePlaylistUri, setActivePlaylistUri] = useState<string | null>(null);
  const [activePlaylistMetadata, setActivePlaylistMetadata] =
    useState<PlaylistMetadata | null>(null);
  const [activeArtistUri, setActiveArtistUri] = useState<string | null>(null);
  const [activeArtistMetadata, setActiveArtistMetadata] =
    useState<ArtistMetadata | null>(null);
  const [isApplyingPlaylistTagsToTracks, setIsApplyingPlaylistTagsToTracks] =
    useState(false);

  // Create ref to hold tagData for smart playlists
  const tagDataRef = useRef<TagDataStructure>(defaultTagData);

  const {
    syncSmartPlaylistFull,
    syncTrackWithSmartPlaylists,
    syncMultipleTracksWithSmartPlaylists,
    createSmartPlaylist,
    cleanupDeletedSmartPlaylists,
    smartPlaylists,
    setSmartPlaylists,
    exportSmartPlaylists,
    importSmartPlaylists,
    resetSmartPlaylists,
  } = useSmartPlaylists({ tagDataRef });

  const {
    tagData,
    isLoading,
    lastSaved,
    loadTagData,
    applyShortcutTrackUpdate,
    applyShortcutPlaylistUpdate,
    applyShortcutArtistUpdate,
    lastUserTrackAddedEvent,
    migrationProgress,
    orchestratorResult,
    retryMigration,
    storageError,
    toggleTagSingleTrack,
    setRating,
    setEnergy,
    setBpm,
    setCamelotKey,
    updateBpm,
    applyBatchTagUpdates,
    findTagName,
    toggleTagPlaylist,
    setPlaylistRating,
    setPlaylistEnergy,
    refreshPlaylistMetadata,
    toggleTagArtist,
    setArtistRating,
    setArtistEnergy,
    refreshArtistMetadata,
    replaceTaxonomy,
    exportData,
    exportTagData,
    importTagData,
    resetTagData,
  } = useTagData({
    onSyncTrack: syncTrackWithSmartPlaylists,
    onSyncMultipleTracks: syncMultipleTracksWithSmartPlaylists,
  });

  // Keep ref synchronized with tagData state
  useEffect(() => {
    tagDataRef.current = tagData;
  }, [tagData]);

  useMetadataBackfill({
    enabled: !isLoading && !migrationProgress, // Only run after loading/migration complete
    onComplete: () => {
      loadTagData(); // reload state after metadata is backfilled (re-renders TrackList)
    },
  });

  const {
    includeTagClauses,
    clauseConnectors,
    activeTagFilters,
    excludedTagFilters,
    selectedClauseIndex,
    selectedClauseLane,
    setSelectedClauseIndex,
    addIncludeClause,
    removeIncludeClause,
    setIncludeClauseOperator,
    setClauseConnector,
    removeTagFilter,
    toggleTagIncludeOff,
    moveTagToClauseLane,
    clearTagFilters,
    pruneInvalidTagFilters,
    replaceTagFilterFormula,
  } = useFilterState("tracks");
  const albumFilterState = useFilterState("albums");
  const playlistFilterState = useFilterState("playlists");
  const artistFilterState = useFilterState("artists");
  const activeViewFilterState =
    activeView === "artists"
      ? artistFilterState
      : activeView === "albums"
        ? albumFilterState
      : activeView === "playlists"
        ? playlistFilterState
        : {
            activeTagFilters,
            excludedTagFilters,
          };

  const {
    showLocalTracksModal,
    setShowLocalTracksModal,
    localTracksForPlaylist,
    createdPlaylistInfo,
    createPlaylistFromFilters,
  } = usePlaylistState();

  const {
    currentlyPlayingTrack,
    setLockedTrack,
    isLocked,
    setIsLocked,
    toggleLock,
    handleSelectTrackForTagging,
    activeTrack,
  } = useTrackState();

  const {
    isMultiTagging,
    lockedMultiTrackUri,
    multiTagTracks,
    multiTrackDraftTags,
    setIsMultiTagging,
    setMultiTagTracks,
    setLockedMultiTrackUri,
    setMultiTrackDraftTags,
    cancelMultiTagging,
    selectedTagsForSelector,
    findCommonTagsFromDraft,
    findCommonStarRatingFromDraft,
    findCommonEnergyRatingFromDraft,
    toggleTagMultiTrackDraft,
    toggleStarRatingDraft,
    toggleEnergyRatingDraft,
    toggleCommonTagDraft,
    toggleTagForSpecificTrackDraft,
    calculateBatchChanges,
  } = useMultiTrackTagging({ tagData });

  // Set up history tracking and URL param handling
  useSpicetifyHistory({
    isMultiTagging,
    setIsMultiTagging,
    setMultiTagTracks,
    setLockedTrack,
    setIsLocked,
    setLockedMultiTrackUri,
    onSelectTrack: () => {
      setActiveView("tracks");
    },
    onSelectPlaylist: (playlistUri) => {
      const normalizedPlaylistUri =
        spotifyApiService.normalizePlaylistUri(playlistUri);
      setActivePlaylistUri(normalizedPlaylistUri);
      setActiveView(getPlaylistViewForUri(normalizedPlaylistUri));
    },
    onSelectArtist: (artistUri) => {
      setActiveArtistUri(spotifyApiService.normalizeArtistUri(artistUri));
      setActiveView("artists");
    },
  });

  const { updateInfo, dismissUpdate } = useUpdateChecker({
    currentVersion: packageJson.version,
    repoOwner: "alexk218",
    repoName: "tagify",
    checkOnMount: true,
    delayMs: 2000,
  });

  const { shouldShowSurvey, completeSurvey, skipSurvey } =
    useDiscoverySurvey(packageJson.version);
  const taggedTrackCount = useMemo(
    () => Object.keys(tagData.tracks).length,
    [tagData.tracks],
  );
  const categoryTree = useMemo(
    () => buildCategoryTree(tagData.taxonomy),
    [tagData.taxonomy],
  );
  const { shouldShowPowerUserModal, dismissPowerUserModal } = usePowerUserModal(
    {
      taggedTrackCount,
      lastUserTrackAddedEvent,
    },
  );

  useFontAwesome();

  // podcasts/audiobooks not allowed
  const isDisplayedTrackMusic = useMemo(() => {
    if (!activeTrack) return false;
    return (
      activeTrack.uri.startsWith("spotify:track:") ||
      activeTrack.uri.startsWith("spotify:local")
    );
  }, [activeTrack]);

  // causes state changes when applying ratings via shortcuts
  useGlobalKeyboardShortcuts({
    onShortcutTrackUpdate: applyShortcutTrackUpdate,
    onShortcutPlaylistUpdate: applyShortcutPlaylistUpdate,
    onShortcutArtistUpdate: applyShortcutArtistUpdate,
  });

  const playTrack = trackService.playTrack;
  const activeTrackUri = activeTrack?.uri ?? null;
  const activeTrackMetadata = useMemo(() => {
    if (!activeTrack) {
      return undefined;
    }

    return {
      name: activeTrack.name || "Unknown Track",
      artists:
        activeTrack.artists?.map((artist) => artist.name).join(", ") ||
        "Unknown Artist",
    };
  }, [activeTrack]);
  const activeTrackData = activeTrackUri
    ? tagData.tracks[activeTrackUri]
    : undefined;
  const activePlaylistData = activePlaylistUri
    ? tagData.playlists[activePlaylistUri]
    : undefined;
  const activeArtistData = activeArtistUri
    ? tagData.artists[activeArtistUri]
    : undefined;
  const activePlaylistViewType =
    activeView === "albums" ? "album" : activeView === "playlists" ? "playlist" : null;
  const activePlaylistMatchesView =
    !!activePlaylistUri &&
    ((activePlaylistViewType === "album" &&
      activePlaylistUri.startsWith("spotify:album:")) ||
      (activePlaylistViewType === "playlist" &&
        activePlaylistUri.startsWith("spotify:playlist:")));

  useEffect(() => {
    try {
      if (activeView === "albums" || activeView === "playlists") {
        localStorage.setItem(
          SHORTCUT_TARGET_STORAGE_KEY,
          JSON.stringify({
            view: "playlists",
            playlistUri: activePlaylistMatchesView ? activePlaylistUri : null,
            playlistMetadata: activePlaylistMatchesView
              ? {
                  name:
                    activePlaylistData?.name ||
                    activePlaylistMetadata?.name ||
                    undefined,
                  ownerName:
                    activePlaylistData?.ownerName ??
                    activePlaylistMetadata?.ownerName ??
                    null,
                  imageUrl:
                    activePlaylistData?.imageUrl ??
                    activePlaylistMetadata?.imageUrl ??
                    null,
                  description:
                    activePlaylistData?.description ??
                    activePlaylistMetadata?.description ??
                    null,
                  trackCount:
                    activePlaylistData?.trackCount ??
                    activePlaylistMetadata?.trackCount ??
                    null,
                  snapshotId:
                    activePlaylistData?.snapshotId ??
                    activePlaylistMetadata?.snapshotId ??
                    null,
                }
              : null,
          }),
        );
        return;
      }

      if (activeView === "artists") {
        localStorage.setItem(
          SHORTCUT_TARGET_STORAGE_KEY,
          JSON.stringify({
            view: "artists",
            artistUri: activeArtistUri,
            artistMetadata: activeArtistUri
              ? {
                  name:
                    activeArtistData?.name ||
                    activeArtistMetadata?.name ||
                    undefined,
                  imageUrl:
                    activeArtistData?.imageUrl ??
                    activeArtistMetadata?.imageUrl ??
                    null,
                  followerCount:
                    activeArtistData?.followerCount ??
                    activeArtistMetadata?.followerCount ??
                    null,
                  genres:
                    activeArtistData?.genres ??
                    activeArtistMetadata?.genres ??
                    [],
                }
              : null,
          }),
        );
        return;
      }

      localStorage.setItem(
        SHORTCUT_TARGET_STORAGE_KEY,
        JSON.stringify({ view: "tracks" }),
      );
    } catch {
      // Shortcut targeting is best-effort; the global service can still fall back to tracks.
    }
  }, [
    activeArtistData,
    activeArtistMetadata,
    activeArtistUri,
    activePlaylistData,
    activePlaylistMatchesView,
    activePlaylistMetadata,
    activePlaylistUri,
    activeView,
  ]);

  useEffect(() => {
    if (!activePlaylistUri) {
      setActivePlaylistMetadata(null);
      return;
    }

    const isAlbum = activePlaylistUri.startsWith("spotify:album:");
    const hasIncompleteAlbumMetadata =
      isAlbum &&
      (!activePlaylistData?.name ||
        activePlaylistData.name === "Unknown Album" ||
        !activePlaylistData.imageUrl);
    const hasCachedPlaylistMetadata =
      activePlaylistData &&
      !hasIncompleteAlbumMetadata &&
      (activePlaylistData.name ||
        activePlaylistData.ownerName !== undefined ||
        activePlaylistData.imageUrl !== undefined ||
        activePlaylistData.description !== undefined ||
        activePlaylistData.trackCount !== undefined ||
        activePlaylistData.snapshotId !== undefined);

    if (hasCachedPlaylistMetadata) {
      setActivePlaylistMetadata({
        name: activePlaylistData.name || "Unknown Playlist",
        ownerName: activePlaylistData.ownerName ?? null,
        imageUrl: activePlaylistData.imageUrl ?? null,
        description: activePlaylistData.description ?? null,
        trackCount: activePlaylistData.trackCount ?? null,
        snapshotId: activePlaylistData.snapshotId ?? null,
      });
      return;
    }

    let isCurrent = true;
    setActivePlaylistMetadata(null);

    spotifyApiService.getPlaylistMetadata(activePlaylistUri).then((metadata) => {
      if (!isCurrent || !metadata) {
        return;
      }

      setActivePlaylistMetadata({
        name: metadata.name,
        ownerName: metadata.ownerName,
        imageUrl: metadata.imageUrl,
        description: metadata.description,
        trackCount: metadata.trackCount,
        snapshotId: metadata.snapshotId,
      });
    });

    return () => {
      isCurrent = false;
    };
  }, [activePlaylistData, activePlaylistUri]);

  useEffect(() => {
    if (!activeArtistUri) {
      setActiveArtistMetadata(null);
      return;
    }

    const hasCachedArtistMetadata =
      activeArtistData &&
      (activeArtistData.name ||
        activeArtistData.imageUrl !== undefined ||
        activeArtistData.followerCount !== undefined ||
        activeArtistData.genres !== undefined);

    if (hasCachedArtistMetadata) {
      setActiveArtistMetadata({
        name: activeArtistData.name || "Unknown Artist",
        imageUrl: activeArtistData.imageUrl ?? null,
        followerCount: activeArtistData.followerCount ?? null,
        genres: activeArtistData.genres || [],
      });
      return;
    }

    let isCurrent = true;
    setActiveArtistMetadata(null);

    spotifyApiService.getArtistMetadata(activeArtistUri).then((metadata) => {
      if (!isCurrent || !metadata) {
        return;
      }

      setActiveArtistMetadata({
        name: metadata.name,
        imageUrl: metadata.imageUrl,
        followerCount: metadata.followerCount,
        genres: metadata.genres,
      });
    });

    return () => {
      isCurrent = false;
    };
  }, [activeArtistData, activeArtistUri]);

  const handleSetActiveTrackRating = useCallback(
    (rating: number) => {
      if (!activeTrackUri) {
        return;
      }

      setRating(activeTrackUri, rating, activeTrackMetadata);
    },
    [activeTrackMetadata, activeTrackUri, setRating],
  );

  const handleSetActiveTrackEnergy = useCallback(
    (energy: number) => {
      if (!activeTrackUri) {
        return;
      }

      setEnergy(activeTrackUri, energy, activeTrackMetadata);
    },
    [activeTrackMetadata, activeTrackUri, setEnergy],
  );

  const handleSetActiveTrackBpm = useCallback(
    (bpm: number | null) => {
      if (!activeTrackUri) {
        return;
      }

      setBpm(activeTrackUri, bpm);
    },
    [activeTrackUri, setBpm],
  );

  const handleSetActiveTrackCamelotKey = useCallback(
    (camelotKey: string | null) => {
      if (!activeTrackUri) {
        return;
      }

      setCamelotKey(activeTrackUri, camelotKey);
    },
    [activeTrackUri, setCamelotKey],
  );

  const handleRemoveActiveTrackTag = useCallback(
    (tagId: string) => {
      if (!activeTrackUri) {
        return;
      }

      toggleTagSingleTrack(activeTrackUri, tagId, activeTrackMetadata);
    },
    [activeTrackMetadata, activeTrackUri, toggleTagSingleTrack],
  );

  const handleRemoveActivePlaylistTag = useCallback(
    (tagId: string) => {
      if (!activePlaylistUri) {
        return;
      }

      toggleTagPlaylist(activePlaylistUri, tagId, activePlaylistMetadata || undefined);
    },
    [activePlaylistMetadata, activePlaylistUri, toggleTagPlaylist],
  );

  const handleRemoveActiveArtistTag = useCallback(
    (tagId: string) => {
      if (!activeArtistUri) {
        return;
      }

      toggleTagArtist(activeArtistUri, tagId, activeArtistMetadata || undefined);
    },
    [activeArtistMetadata, activeArtistUri, toggleTagArtist],
  );

  const handleSetActivePlaylistRating = useCallback(
    (rating: number) => {
      if (!activePlaylistUri) {
        return;
      }

      setPlaylistRating(
        activePlaylistUri,
        rating,
        activePlaylistMetadata || undefined,
      );
    },
    [activePlaylistMetadata, activePlaylistUri, setPlaylistRating],
  );

  const handleSetActivePlaylistEnergy = useCallback(
    (energy: number) => {
      if (!activePlaylistUri) {
        return;
      }

      setPlaylistEnergy(
        activePlaylistUri,
        energy,
        activePlaylistMetadata || undefined,
      );
    },
    [activePlaylistMetadata, activePlaylistUri, setPlaylistEnergy],
  );

  const handleSetActiveArtistRating = useCallback(
    (rating: number) => {
      if (!activeArtistUri) {
        return;
      }

      setArtistRating(activeArtistUri, rating, activeArtistMetadata || undefined);
    },
    [activeArtistMetadata, activeArtistUri, setArtistRating],
  );

  const handleSetActiveArtistEnergy = useCallback(
    (energy: number) => {
      if (!activeArtistUri) {
        return;
      }

      setArtistEnergy(activeArtistUri, energy, activeArtistMetadata || undefined);
    },
    [activeArtistMetadata, activeArtistUri, setArtistEnergy],
  );

  const handleSelectPlaylistForTagging = useCallback((playlistUri: string) => {
    const normalizedPlaylistUri = spotifyApiService.normalizePlaylistUri(playlistUri);
    setActivePlaylistUri(normalizedPlaylistUri);
    setActiveView(getPlaylistViewForUri(normalizedPlaylistUri));
  }, []);

  const handleSelectArtistForTagging = useCallback((artistUri: string) => {
    setActiveArtistUri(spotifyApiService.normalizeArtistUri(artistUri));
    setActiveView("artists");
  }, []);

  const handleOpenPlaylist = useCallback((playlistUri: string) => {
    if (playlistUri.startsWith("spotify:album:")) {
      const albumId = playlistUri.split(":").pop();
      if (albumId) {
        Spicetify.Platform.History.push(`/album/${albumId}`);
      }
      return;
    }

    const playlistId = spotifyApiService.extractPlaylistId(playlistUri);
    if (playlistId) {
      Spicetify.Platform.History.push(`/playlist/${playlistId}`);
    }
  }, []);

  const handleOpenArtist = useCallback((artistUri: string) => {
    const artistId = spotifyApiService.extractArtistId(artistUri);
    if (artistId) {
      Spicetify.Platform.History.push(`/artist/${artistId}`);
    }
  }, []);

  const handleRefreshActivePlaylistMetadata = useCallback(
    async (playlistUri: string) => {
      const refreshedPlaylistData = await refreshPlaylistMetadata(playlistUri);
      if (refreshedPlaylistData) {
        setActivePlaylistMetadata({
          name: refreshedPlaylistData.name || "Unknown Playlist",
          ownerName: refreshedPlaylistData.ownerName ?? null,
          imageUrl: refreshedPlaylistData.imageUrl ?? null,
          description: refreshedPlaylistData.description ?? null,
          trackCount: refreshedPlaylistData.trackCount ?? null,
          snapshotId: refreshedPlaylistData.snapshotId ?? null,
        });
      }
    },
    [refreshPlaylistMetadata],
  );

  const handleRefreshActiveArtistMetadata = useCallback(
    async (artistUri: string) => {
      const refreshedArtistData = await refreshArtistMetadata(artistUri);
      if (refreshedArtistData) {
        setActiveArtistMetadata({
          name: refreshedArtistData.name || "Unknown Artist",
          imageUrl: refreshedArtistData.imageUrl ?? null,
          followerCount: refreshedArtistData.followerCount ?? null,
          genres: refreshedArtistData.genres || [],
        });
      }
    },
    [refreshArtistMetadata],
  );

  const handleApplyPlaylistTagsToTracks = useCallback(
    async (
      playlistUri: string,
      applyMode: PlaylistTrackApplyMode = "tags",
    ) => {
      const normalizedPlaylistUri = spotifyApiService.normalizePlaylistUri(playlistUri);
      const isAlbum = normalizedPlaylistUri.startsWith("spotify:album:");
      const entityLabel = isAlbum ? "album" : "playlist";
      const playlistData = tagData.playlists[normalizedPlaylistUri];
      const playlistTagIds = playlistData?.tagIds || [];
      const playlistRating = playlistData?.rating || 0;
      const playlistEnergy = playlistData?.energy || 0;
      const shouldApplyAll = applyMode === "all";
      const shouldApplyTags = playlistTagIds.length > 0;
      const shouldApplyRating = shouldApplyAll && playlistRating > 0;
      const shouldApplyEnergy = shouldApplyAll && playlistEnergy > 0;

      if (applyMode === "tags" && !shouldApplyTags) {
        Spicetify.showNotification(`Add tags to this ${entityLabel} first`, true);
        return;
      }

      if (!shouldApplyTags && !shouldApplyRating && !shouldApplyEnergy) {
        Spicetify.showNotification(
          `Add ${entityLabel} tags, rating, or energy first`,
          true,
        );
        return;
      }

      const entityId = isAlbum
        ? spotifyApiService.extractAlbumId(normalizedPlaylistUri)
        : spotifyApiService.extractPlaylistId(normalizedPlaylistUri);
      if (!entityId) {
        Spicetify.showNotification(`Could not read ${entityLabel} ID`, true);
        return;
      }

      setIsApplyingPlaylistTagsToTracks(true);

      try {
        const trackUris = Array.from(
          new Set(
            isAlbum
              ? await spotifyApiService.getAllTrackUrisInAlbum(entityId)
              : await spotifyApiService.getAllTrackUrisInPlaylist(entityId),
          ),
        );

        if (trackUris.length === 0) {
          Spicetify.showNotification(`No tracks found in this ${entityLabel}`, true);
          return;
        }

        const playlistName = playlistData?.name || `this ${entityLabel}`;
        const appliedParts = [
          shouldApplyTags
            ? `${playlistTagIds.length} ${entityLabel} ${
                playlistTagIds.length === 1 ? "tag" : "tags"
              }`
            : null,
          shouldApplyRating ? `rating ${playlistRating}` : null,
          shouldApplyEnergy ? `energy ${playlistEnergy}` : null,
        ].filter((part): part is string => Boolean(part));
        const replacementWarning =
          shouldApplyRating || shouldApplyEnergy
            ? " Existing track rating/energy values may be replaced."
            : "";
        const confirmed = window.confirm(
          `Apply ${appliedParts.join(", ")} to ${trackUris.length} ${
            trackUris.length === 1 ? "track" : "tracks"
          } from "${playlistName}"? Existing track tags will be kept.${replacementWarning}`,
        );

        if (!confirmed) {
          return;
        }

        await applyBatchTagUpdates(
          trackUris.map((trackUri) => ({
            trackUri,
            toAdd: shouldApplyTags ? playlistTagIds : [],
            toRemove: [],
            ...(shouldApplyRating ? { newRating: playlistRating } : {}),
            ...(shouldApplyEnergy ? { newEnergy: playlistEnergy } : {}),
          })),
        );

        Spicetify.showNotification(
          `Applied ${appliedParts.join(", ")} to ${trackUris.length} tracks`,
        );
      } catch (error) {
        console.error(`Failed to apply ${entityLabel} values to tracks:`, error);
        Spicetify.showNotification(
          `Failed to apply ${entityLabel} values to tracks`,
          true,
        );
      } finally {
        setIsApplyingPlaylistTagsToTracks(false);
      }
    },
    [applyBatchTagUpdates, tagData.playlists],
  );

  const handleResetTagifyState = useCallback(async () => {
    await resetTagData();
    resetSmartPlaylists();
    setActivePlaylistUri(null);
    setActivePlaylistMetadata(null);
    setActiveArtistUri(null);
    setActiveArtistMetadata(null);
    setActiveView("tracks");
  }, [resetTagData, resetSmartPlaylists]);

  const handleReplaceTaxonomy = useCallback(
    (newTaxonomy: typeof tagData.taxonomy, _removedTagIds: string[]) => {
      const validTagIds = buildValidTagIdSet(newTaxonomy);

      replaceTaxonomy(newTaxonomy);
      pruneInvalidTagFilters(validTagIds);
      albumFilterState.pruneInvalidTagFilters(validTagIds);
      playlistFilterState.pruneInvalidTagFilters(validTagIds);
      artistFilterState.pruneInvalidTagFilters(validTagIds);
      setSmartPlaylists((currentPlaylists) =>
        currentPlaylists.map((playlist) => ({
          ...playlist,
          criteria: {
            ...playlist.criteria,
            ...(() => {
              const prunedFormula = pruneTagFilterFormula(
                {
                  clauses: playlist.criteria.includeTagClauses,
                  connectors: playlist.criteria.clauseConnectors,
                },
                validTagIds,
              );

              return {
                includeTagClauses: prunedFormula.clauses,
                clauseConnectors: prunedFormula.connectors,
              };
            })(),
          },
        })),
      );
    },
    [
      albumFilterState,
      artistFilterState,
      playlistFilterState,
      pruneInvalidTagFilters,
      replaceTaxonomy,
      setSmartPlaylists,
    ],
  );

  useEffect(() => {
    if (!orchestratorResult || isLoading) return;

    // Show modal if migrations ran OR if we're in fallback mode
    const shouldShow =
      !orchestratorResult.isFreshInstall &&
      (orchestratorResult.migrationsRun.length > 0 ||
        orchestratorResult.fallbackMode);

    if (shouldShow) {
      const timer = setTimeout(() => {
        setShowMigrationModal(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [orchestratorResult, isLoading]);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_ACTIVE_VIEW_STORAGE_KEY, activeView);
    } catch {
      // Ignore private-mode/storage failures; the app can still use in-memory state.
    }
  }, [activeView]);

  useEffect(() => {
    localStorage.setItem("tagify:appMounted", "true");

    return () => {
      localStorage.removeItem("tagify:appMounted");
    };
  }, []);

  // Hide topbar when app mounts - restore when app unmounts
  useEffect(() => {
    const topbar = document.querySelector(
      ".main-topBar-container",
    ) as HTMLElement;
    if (topbar) {
      topbar.style.visibility = "hidden";
    }

    return () => {
      const topbar = document.querySelector(
        ".main-topBar-container",
      ) as HTMLElement;
      if (topbar) {
        topbar.style.visibility = "";
      }
    };
  }, []);

  const trackTags = isMultiTagging
    ? selectedTagsForSelector || []
    : tagData.tracks[activeTrack?.uri || ""]?.tagIds || [];
  const playlistTags = activePlaylistUri
    ? tagData.playlists[activePlaylistUri]?.tagIds || []
    : [];
  const artistTags = activeArtistUri
    ? tagData.artists[activeArtistUri]?.tagIds || []
    : [];

  const handleToggleTag = (tagId: string) => {
    if (activeView === "artists" && activeArtistUri) {
      toggleTagArtist(activeArtistUri, tagId, activeArtistMetadata || undefined);
    } else if (
      (activeView === "albums" || activeView === "playlists") &&
      activePlaylistMatchesView &&
      activePlaylistUri
    ) {
      toggleTagPlaylist(activePlaylistUri, tagId, activePlaylistMetadata || undefined);
    } else if (isMultiTagging) {
      toggleTagMultiTrackDraft(tagId);
    } else if (activeTrack) {
      toggleTagSingleTrack(activeTrack.uri, tagId, {
        name: activeTrack.name || "Unknown Track",
        artists:
          activeTrack.artists?.map((a) => a.name).join(", ") ||
          "Unknown Artist",
      });
    }
  };

  const trackDataMap = useMemo(() => {
    return Object.fromEntries(
      multiTagTracks.map((track) => [
        track.uri,
        {
          tagIds: tagData.tracks[track.uri]?.tagIds || [],
          rating: tagData.tracks[track.uri]?.rating || 0,
          energy: tagData.tracks[track.uri]?.energy || 0,
        },
      ]),
    );
  }, [multiTagTracks, tagData.tracks]);

  useEffect(() => {
    // This creates a global reference for debugging in browser console
    (window as Window & { __TAGIFY_DEBUG__?: Record<string, unknown> })
      .__TAGIFY_DEBUG__ = {
      multiTrackDraftTags,
      isMultiTagging,
      lockedMultiTrackUri,
      multiTagTracks,
      tagData,
      smartPlaylists,
      includeTagClauses,
      clauseConnectors,
      activeTagFilters,
      excludedTagFilters,
      selectedClauseLane,
      currentlyPlayingTrack,
      activeTrack,
      activeView,
      activePlaylistUri,
      activePlaylistData,
      activeArtistUri,
      activeArtistData,
      selectedTagsForSelector,
      trackDataMap,
      rateLimiterStats: () => ({
        graphql: graphqlRateLimiter.getStats(),
        audioFeatures: audioFeaturesRateLimiter.getStats(),
      }),
    };
  }, [
    multiTrackDraftTags,
    isMultiTagging,
    lockedMultiTrackUri,
    multiTagTracks,
    tagData,
    smartPlaylists,
    includeTagClauses,
    clauseConnectors,
    activeTagFilters,
    excludedTagFilters,
    selectedClauseLane,
    currentlyPlayingTrack,
    activeTrack,
    activeView,
    activePlaylistUri,
    activePlaylistData,
    activeArtistUri,
    activeArtistData,
    selectedTagsForSelector,
    trackDataMap,
  ]);

  const isPlaylistEntityView = activeView === "albums" || activeView === "playlists";
  const currentPlaylistEntityType = activeView === "albums" ? "album" : "playlist";
  const currentPlaylistFilterState =
    activeView === "albums" ? albumFilterState : playlistFilterState;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>Tagify</h1>
        </div>
        <div className={styles.viewTabs} role="tablist" aria-label="Tagify views">
          <button
            className={`${styles.viewTab} ${
              activeView === "tracks" ? styles.viewTabActive : ""
            }`}
            onClick={() => setActiveView("tracks")}
            role="tab"
            aria-selected={activeView === "tracks"}
          >
            Tracks
          </button>
          <button
            className={`${styles.viewTab} ${
              activeView === "albums" ? styles.viewTabActive : ""
            }`}
            onClick={() => setActiveView("albums")}
            role="tab"
            aria-selected={activeView === "albums"}
          >
            Albums
          </button>
          <button
            className={`${styles.viewTab} ${
              activeView === "playlists" ? styles.viewTabActive : ""
            }`}
            onClick={() => setActiveView("playlists")}
            role="tab"
            aria-selected={activeView === "playlists"}
          >
            Playlists
          </button>
          <button
            className={`${styles.viewTab} ${
              activeView === "artists" ? styles.viewTabActive : ""
            }`}
            onClick={() => setActiveView("artists")}
            role="tab"
            aria-selected={activeView === "artists"}
          >
            Artists
          </button>
        </div>
      </div>

      {updateInfo?.hasUpdate && (
        <UpdateBanner updateInfo={updateInfo} onDismiss={dismissUpdate} />
      )}

      {storageError && (
        <div className={styles.errorBanner}>
          <p>⚠️ Storage Error: {storageError}</p>
          <p>Your data may not be saved. Please export a backup.</p>
        </div>
      )}

      {orchestratorResult?.fallbackMode && !showMigrationModal && (
        <div className={styles.fallbackBanner}>
          <span>⚠️ Using limited storage mode.</span>
          <button
            onClick={() => setShowMigrationModal(true)}
            className={styles.fallbackBannerButton}
          >
            Learn More
          </button>
        </div>
      )}

      {shouldShowSurvey && (
        <DiscoverySurveyModal
          onCompleteSurvey={completeSurvey}
          onSkipSurvey={skipSurvey}
        />
      )}

      {shouldShowPowerUserModal && (
        <PowerUserModal
          taggedTrackCount={taggedTrackCount}
          onClose={dismissPowerUserModal}
        />
      )}

      <DataManager
        onExportTagData={exportTagData}
        onImportTagData={importTagData}
        onExportRekordbox={() => setShowExport(true)}
        onResetTagifyData={handleResetTagifyState}
        onRetryMigration={retryMigration}
        lastSaved={lastSaved}
      />

      {isLoading ? (
        <div className={styles.loadingContainer}>
          <p className={styles.loadingText}>
            {migrationProgress
              ? `${migrationProgress.message} (${migrationProgress.current}%)`
              : "Loading tag data..."}
          </p>
        </div>
      ) : (
        <div className={styles.content}>
          {activeView === "tracks" ? (
            <>
              {isMultiTagging &&
              multiTagTracks.length > 0 &&
              multiTrackDraftTags ? (
                <MultiTrackDetails
                  tracks={multiTagTracks}
                  trackDataMap={trackDataMap}
                  onCancelTagging={cancelMultiTagging}
                  onPlayTrack={playTrack}
                  lockedTrackUri={lockedMultiTrackUri}
                  onLockTrack={setLockedMultiTrackUri}
                  multiTrackDraftTags={multiTrackDraftTags}
                  onSetMultiTrackDraftTags={setMultiTrackDraftTags}
                  onApplyBatchTagUpdates={applyBatchTagUpdates}
                  onFindCommonTagsFromDraft={findCommonTagsFromDraft}
                  onFindCommonStarRatingFromDraft={findCommonStarRatingFromDraft}
                  onFindCommonEnergyRatingFromDraft={
                    findCommonEnergyRatingFromDraft
                  }
                  onToggleStarRatingDraft={toggleStarRatingDraft}
                  onToggleEnergyRatingDraft={toggleEnergyRatingDraft}
                  onFindTagName={findTagName}
                  onToggleCommonTagDraft={toggleCommonTagDraft}
                  onToggleTagForSpecificTrackDraft={toggleTagForSpecificTrackDraft}
                  onCalculateBatchChanges={calculateBatchChanges}
                />
              ) : (
                activeTrack &&
                isDisplayedTrackMusic && (
                  <TrackDetails
                    displayedTrack={activeTrack}
                    currentlyPlayingTrack={currentlyPlayingTrack}
                    trackData={activeTrackData || EMPTY_TRACK_DETAILS_DATA}
                    taxonomy={tagData.taxonomy}
                    activeTagFilters={activeTagFilters}
                    excludedTagFilters={excludedTagFilters}
                    onSetRating={handleSetActiveTrackRating}
                    onSetEnergy={handleSetActiveTrackEnergy}
                    onSetBpm={handleSetActiveTrackBpm}
                    onSetCamelotKey={handleSetActiveTrackCamelotKey}
                    onRemoveTag={handleRemoveActiveTrackTag}
                    onToggleTagIncludeOff={toggleTagIncludeOff}
                    onPlayTrack={playTrack}
                    isLocked={isLocked}
                    onToggleLock={toggleLock}
                    onSwitchToCurrentTrack={setLockedTrack}
                    onUpdateBpm={updateBpm}
                  />
                )
              )}

              {(activeTrack || (isMultiTagging && multiTagTracks.length > 0)) &&
                isDisplayedTrackMusic && (
                  <TagSelector
                    categories={categoryTree}
                    customAccentsById={tagData.taxonomy.customAccentsById}
                    selectedTagIds={trackTags}
                    onToggleTag={handleToggleTag}
                    onOpenTagManager={() => setShowTagManager(true)}
                    targetType={isMultiTagging ? "tracks" : "track"}
                    isMultiTagging={isMultiTagging}
                    isLockedTrack={!!lockedMultiTrackUri}
                  />
                )}
              <TrackList
                tracks={tagData.tracks}
                taxonomy={tagData.taxonomy}
                includeTagClauses={includeTagClauses}
                clauseConnectors={clauseConnectors}
                activeTagFilters={activeTagFilters}
                excludedTagFilters={excludedTagFilters}
                selectedClauseIndex={selectedClauseIndex}
                activeTrackUri={activeTrack?.uri || null}
                onAddIncludeClause={addIncludeClause}
                onRemoveIncludeClause={removeIncludeClause}
                onSelectClause={setSelectedClauseIndex}
                onSetIncludeClauseOperator={setIncludeClauseOperator}
                onSetClauseConnector={setClauseConnector}
                onRemoveTagFilter={removeTagFilter}
                onToggleTagIncludeOff={toggleTagIncludeOff}
                onMoveTagToClauseLane={moveTagToClauseLane}
                onReplaceTagFilterFormula={replaceTagFilterFormula}
                onClearTagFilters={clearTagFilters}
                onPlayTrack={playTrack}
                onTagTrack={handleSelectTrackForTagging}
                onCreatePlaylist={createPlaylistFromFilters}
                onCreateSmartPlaylist={createSmartPlaylist}
                smartPlaylists={smartPlaylists}
                onSetSmartPlaylists={setSmartPlaylists}
                onSyncPlaylist={syncSmartPlaylistFull}
                onCleanupDeletedSmartPlaylists={cleanupDeletedSmartPlaylists}
                onExportSmartPlaylists={exportSmartPlaylists}
                onImportSmartPlaylists={importSmartPlaylists}
              />
            </>
          ) : isPlaylistEntityView ? (
            <>
              {activePlaylistMatchesView && activePlaylistUri && (
                <>
                  <PlaylistDetails
                    playlistUri={activePlaylistUri}
                    playlistData={activePlaylistData}
                    playlistMetadata={activePlaylistMetadata}
                    taxonomy={tagData.taxonomy}
                    activeTagFilters={currentPlaylistFilterState.activeTagFilters}
                    excludedTagFilters={
                      currentPlaylistFilterState.excludedTagFilters
                    }
                    onSetRating={handleSetActivePlaylistRating}
                    onSetEnergy={handleSetActivePlaylistEnergy}
                    onRemoveTag={handleRemoveActivePlaylistTag}
                    onToggleTagIncludeOff={
                      currentPlaylistFilterState.cycleTagIncludeExcludeOff
                    }
                    onOpenPlaylist={handleOpenPlaylist}
                    onRefreshMetadata={handleRefreshActivePlaylistMetadata}
                    onApplyTagsToTracks={handleApplyPlaylistTagsToTracks}
                    isApplyingTagsToTracks={isApplyingPlaylistTagsToTracks}
                  />
                  <TagSelector
                    categories={categoryTree}
                    customAccentsById={tagData.taxonomy.customAccentsById}
                    selectedTagIds={playlistTags}
                    onToggleTag={handleToggleTag}
                    onOpenTagManager={() => setShowTagManager(true)}
                    targetType={
                      activePlaylistUri.startsWith("spotify:album:")
                        ? "album"
                        : "playlist"
                    }
                    isMultiTagging={false}
                    isLockedTrack={false}
                  />
                </>
              )}
              <TaggedPlaylistsList
                playlists={tagData.playlists}
                entityType={currentPlaylistEntityType}
                taxonomy={tagData.taxonomy}
                includeTagClauses={currentPlaylistFilterState.includeTagClauses}
                clauseConnectors={currentPlaylistFilterState.clauseConnectors}
                activeTagFilters={currentPlaylistFilterState.activeTagFilters}
                excludedTagFilters={currentPlaylistFilterState.excludedTagFilters}
                activePlaylistUri={
                  activePlaylistMatchesView ? activePlaylistUri : null
                }
                onSelectPlaylist={handleSelectPlaylistForTagging}
                onOpenPlaylist={handleOpenPlaylist}
                onCycleTagFilter={
                  currentPlaylistFilterState.cycleTagIncludeExcludeOff
                }
                onRemoveTagFilter={currentPlaylistFilterState.removeTagFilter}
                onSetTagFilterOperator={(operator) =>
                  currentPlaylistFilterState.setIncludeClauseOperator(0, operator)
                }
                onClearTagFilters={currentPlaylistFilterState.clearTagFilters}
              />
            </>
          ) : (
            <>
              {activeArtistUri && (
                <>
                  <ArtistDetails
                    artistUri={activeArtistUri}
                    artistData={activeArtistData}
                    artistMetadata={activeArtistMetadata}
                    taxonomy={tagData.taxonomy}
                    activeTagFilters={artistFilterState.activeTagFilters}
                    excludedTagFilters={artistFilterState.excludedTagFilters}
                    onSetRating={handleSetActiveArtistRating}
                    onSetEnergy={handleSetActiveArtistEnergy}
                    onRemoveTag={handleRemoveActiveArtistTag}
                    onToggleTagIncludeOff={
                      artistFilterState.cycleTagIncludeExcludeOff
                    }
                    onOpenArtist={handleOpenArtist}
                    onRefreshMetadata={handleRefreshActiveArtistMetadata}
                  />
                  <TagSelector
                    categories={categoryTree}
                    customAccentsById={tagData.taxonomy.customAccentsById}
                    selectedTagIds={artistTags}
                    onToggleTag={handleToggleTag}
                    onOpenTagManager={() => setShowTagManager(true)}
                    targetType="artist"
                    isMultiTagging={false}
                    isLockedTrack={false}
                  />
                </>
              )}
              <TaggedArtistsList
                artists={tagData.artists}
                taxonomy={tagData.taxonomy}
                includeTagClauses={artistFilterState.includeTagClauses}
                clauseConnectors={artistFilterState.clauseConnectors}
                activeTagFilters={artistFilterState.activeTagFilters}
                excludedTagFilters={artistFilterState.excludedTagFilters}
                activeArtistUri={activeArtistUri}
                onSelectArtist={handleSelectArtistForTagging}
                onOpenArtist={handleOpenArtist}
                onCycleTagFilter={artistFilterState.cycleTagIncludeExcludeOff}
                onRemoveTagFilter={artistFilterState.removeTagFilter}
                onSetTagFilterOperator={(operator) =>
                  artistFilterState.setIncludeClauseOperator(0, operator)
                }
                onClearTagFilters={artistFilterState.clearTagFilters}
              />
            </>
          )}
        </div>
      )}
      {showTagManager && (
          <TagManager
            taxonomy={tagData.taxonomy}
            tracks={tagData.tracks}
            playlists={tagData.playlists}
            artists={tagData.artists}
            activeTagFilters={activeViewFilterState.activeTagFilters}
            excludedTagFilters={activeViewFilterState.excludedTagFilters}
            smartPlaylists={smartPlaylists}
            initialExpandedCategoryIds={expandedTagManagerCategoryIds}
            onExpandedCategoryIdsChange={setExpandedTagManagerCategoryIds}
            initialSelectedSubcategoryId={selectedTagManagerSubcategoryId}
            onSelectedSubcategoryIdChange={setSelectedTagManagerSubcategoryId}
            onClose={() => setShowTagManager(false)}
            onReplaceTaxonomy={handleReplaceTaxonomy}
          />
      )}

      {showExport && (
        <ExportModal data={exportData()} onClose={() => setShowExport(false)} />
      )}

      {showLocalTracksModal && (
        <LocalTracksModal
          localTracks={localTracksForPlaylist}
          playlistName={createdPlaylistInfo.name}
          playlistId={createdPlaylistInfo.id}
          onClose={() => setShowLocalTracksModal(false)}
        />
      )}

      {showMigrationModal && orchestratorResult && (
        <MigrationResultModal
          result={orchestratorResult}
          onClose={() => setShowMigrationModal(false)}
          onRetry={retryMigration}
        />
      )}
    </div>
  );
}

export default App;
