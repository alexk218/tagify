import React, { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./app.module.css";
import "./styles/globals.css";
import packageJson from "@/package";
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
import {
  TrackDetails,
  TrackList,
  useSpicetifyHistory,
  useTrackState,
} from "@/features/track-session";
import { useFilterState } from "@/features/filter-state";
import {
  buildAlbumTrackSummaries,
  LocalTracksModal,
  PlaylistDetails,
  TaggedPlaylistsList,
  usePlaylistState,
} from "@/features/playlist-state";
import { ArtistDetails, TaggedArtistsList } from "@/features/artist-state";
import { useFontAwesome } from "./hooks/shared/useFontAwesome";
import { trackService } from "./services/TrackService";
import { UpdateBanner, useUpdateChecker } from "@/features/update-check";
import { CommunityUpdates } from "@/features/community-updates/CommunityUpdates";
import { MultiTrackDetails, useMultiTrackTagging } from "@/features/multi-track-tagging";
import { useSmartPlaylists } from "@/features/smart-playlists";
import SmartPlaylistTagChoices from "@/features/smart-playlists/components/SmartPlaylistTagChoices";
import {
  type SmartPlaylistRecipeSelection,
  isSmartPlaylistRecipeBundle,
} from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { loadSmartPlaylistsFromStorage, clearExplicitSmartPlaylistClear } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import {
  DiscoverySurveyModal,
  useDiscoverySurvey,
  useTagifyUsage,
} from "@/features/discovery-survey";
import { PowerUserModal, usePowerUserModal } from "@/features/power-user";
import { useGlobalKeyboardShortcuts } from "./hooks/shared/useGlobalKeyboardShortcuts";
import {
  MetadataBackfillProgress,
  useMetadataBackfill,
} from "@/features/metadata-backfill";
import { graphqlRateLimiter } from "./utils/RateLimiter";
import { audioFeaturesRateLimiter } from "./services/AudioFeaturesService";
import { spotifyApiService } from "./services/SpotifyApiService";
import { pruneTagFilterFormula } from "@/utils/tagFilterGroups";
import { buildCategoryTree, buildValidTagIdSet } from "@/utils/tagTaxonomy";
import {
  CommunityOnboardingModal,
  CloudSyncModal,
  CloudRecoveryModal,
  CommunityWorkspace,
  isCloudRecoveryStatus,
  shouldShowCommunityOnboarding,
} from "@/features/community";
import { Users } from "lucide-react";
import { syncRuntime, type SyncStatus } from "@/services/sync/SyncRuntime";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";

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
  const [showCommunityWorkspace, setShowCommunityWorkspace] = useState(false);
  const [showCommunityOnboarding, setShowCommunityOnboarding] = useState(false);
  const [communityOnboardingLaunchContext, setCommunityOnboardingLaunchContext] =
    useState<"first-run" | "manual">("first-run");
  const [showCloudRecovery, setShowCloudRecovery] = useState(false);
  const [showCloudSync, setShowCloudSync] = useState(false);
  const [syncConnected, setSyncConnected] = useState(
    () => Boolean(getDesktopSyncConfiguration()),
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    () => window.TagifySync?.getStatus() || syncRuntime.getStatus(),
  );
  const [cloudRecoveryPending, setCloudRecoveryPending] = useState(
    () => {
      const runtime = window.TagifySync || syncRuntime;
      const status = runtime.getStatus();
      return isCloudRecoveryStatus(status) || (status !== "unlinked" && Boolean(runtime.getRecoveryPreview()));
    },
  );
  const [activeView, setActiveView] = useState<AppView>(getStoredActiveView);
  const [activePlaylistUri, setActivePlaylistUri] = useState<string | null>(null);
  const [activePlaylistMetadata, setActivePlaylistMetadata] =
    useState<PlaylistMetadata | null>(null);
  const [activeArtistUri, setActiveArtistUri] = useState<string | null>(null);
  const [activeArtistMetadata, setActiveArtistMetadata] =
    useState<ArtistMetadata | null>(null);
  const [requestedSmartPlaylistEditId, setRequestedSmartPlaylistEditId] =
    useState<string | null>(null);
  const [metadataBackfillProgress, setMetadataBackfillProgress] =
    useState<MetadataBackfillProgress | null>(null);

  const {
    syncSmartPlaylistFull,
    syncTrackWithSmartPlaylists,
    syncMultipleTracksWithSmartPlaylists,
    createSmartPlaylist,
    smartPlaylists,
    setSmartPlaylists,
    exportSmartPlaylists,
    resetSmartPlaylists,
  } = useSmartPlaylists();

  const {
    tagData,
    isLoading,
    lastSaved,
    loadTagData,
    refreshPersistedTagData,
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

  useMetadataBackfill({
    enabled: !isLoading && !migrationProgress, // Only run after loading/migration complete
    onProgress: setMetadataBackfillProgress,
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
    onEditSmartPlaylist: (playlistId) => {
      setRequestedSmartPlaylistEditId(playlistId);
      setActiveView("tracks");
    },
  });

  const { updateInfo, dismissUpdate } = useUpdateChecker({
    currentVersion: packageJson.version,
    repoOwner: "alexk218",
    repoName: "tagify",
    checkOnMount: true,
    delayMs: 2000,
  });

  const taggedTrackCount = useMemo(
    () => Object.keys(tagData.tracks).length,
    [tagData.tracks],
  );
  const categoryTree = useMemo(
    () => buildCategoryTree(tagData.taxonomy),
    [tagData.taxonomy],
  );
  const albumTrackSummaries = useMemo(
    () => buildAlbumTrackSummaries(tagData.tracks, tagData.taxonomy),
    [tagData.taxonomy, tagData.tracks],
  );
  const { shouldShowPowerUserModal, dismissPowerUserModal } = usePowerUserModal(
    {
      taggedTrackCount,
      lastUserTrackAddedEvent,
    },
  );

  useTagifyUsage(packageJson.version);
  const { shouldShowSurvey, completeSurvey, skipSurvey } = useDiscoverySurvey(packageJson.version, {
    lastUserTrackAddedEvent,
    canShowSurvey: !isLoading && !migrationProgress && !orchestratorResult?.fallbackMode &&
      !shouldShowPowerUserModal && !showCommunityOnboarding && !showCloudRecovery &&
      !cloudRecoveryPending && !showCloudSync && !showMigrationModal && !showTagManager &&
      !showExport && !showLocalTracksModal,
  });

  useFontAwesome();

  const openCommunityWorkspace = useCallback(() => {
    if (cloudRecoveryPending) {
      setShowCloudRecovery(true);
      return;
    }
    setShowCommunityWorkspace((current) => !current);
  }, [cloudRecoveryPending]);

  const selectAppView = useCallback((view: AppView) => {
    setActiveView(view);
    setShowCommunityWorkspace(false);
  }, []);

  const connectCommunity = useCallback(() => {
    if (cloudRecoveryPending) {
      setShowCloudRecovery(true);
      return;
    }
    setShowCloudSync(false);
    setCommunityOnboardingLaunchContext("manual");
    setShowCommunityOnboarding(true);
  }, [cloudRecoveryPending]);

  const openCloudSync = useCallback(() => {
    if (cloudRecoveryPending) {
      setShowCloudRecovery(true);
      return;
    }
    setShowCloudSync(true);
  }, [cloudRecoveryPending]);

  const disconnectCommunitySync = useCallback(async () => {
    await (window.TagifySync || syncRuntime).unlinkLocal();
  }, []);

  useEffect(() => {
    const handleSyncStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: SyncStatus }>).detail?.status || window.TagifySync?.getStatus() || syncRuntime.getStatus();
      const recoveryPending = isCloudRecoveryStatus(status) || (status !== "unlinked" && Boolean((window.TagifySync || syncRuntime).getRecoveryPreview()));
      setCloudRecoveryPending(recoveryPending);
      setSyncStatus(status);
      setSyncConnected(Boolean(getDesktopSyncConfiguration()));
      if (recoveryPending) {
        setShowCloudRecovery(true);
        setShowCloudSync(false);
        setShowCommunityWorkspace(false);
        setShowCommunityOnboarding(false);
      }
    };
    window.addEventListener("tagify:syncStatus", handleSyncStatus);
    handleSyncStatus(new CustomEvent("tagify:syncStatus", { detail: { status: window.TagifySync?.getStatus() } }));
    return () => window.removeEventListener("tagify:syncStatus", handleSyncStatus);
  }, []);

  useEffect(() => {
    if (cloudRecoveryPending) {
      setShowCommunityOnboarding(false);
      return;
    }
    if (
      isLoading ||
      migrationProgress ||
      orchestratorResult?.fallbackMode ||
      shouldShowSurvey ||
      shouldShowPowerUserModal
    ) return;
    const shouldShow = shouldShowCommunityOnboarding();
    if (shouldShow) setCommunityOnboardingLaunchContext("first-run");
    setShowCommunityOnboarding(shouldShow);
  }, [
    isLoading,
    migrationProgress,
    orchestratorResult?.fallbackMode,
    shouldShowSurvey,
    shouldShowPowerUserModal,
    cloudRecoveryPending,
  ]);

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
      albumName: activeTrack.album?.name,
      albumUri: activeTrack.album?.uri ?? null,
      albumImageUrl:
        activeTrack.album?.images?.[0]?.url ||
        null,
    };
  }, [activeTrack]);
  const activeTrackData = activeTrackUri
    ? tagData.tracks[activeTrackUri]
    : undefined;
  const activeTrackAlbumUri = activeTrack?.album?.uri ?? null;
  const activeTrackAlbumProgress = useMemo(
    () =>
      activeTrackAlbumUri?.startsWith("spotify:album:")
        ? {
            albumUri: activeTrackAlbumUri,
            taggedTrackCount:
              albumTrackSummaries.get(activeTrackAlbumUri)?.taggedTrackCount ?? 0,
            knownTrackCount: tagData.playlists[activeTrackAlbumUri]?.trackCount ?? null,
          }
        : null,
    [activeTrackAlbumUri, albumTrackSummaries, tagData.playlists],
  );
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

  const handleLoadPlaylistTrackUris = useCallback(async (playlistUri: string) => {
    const normalizedPlaylistUri = spotifyApiService.normalizePlaylistUri(playlistUri);
    if (normalizedPlaylistUri.startsWith("spotify:album:")) {
      const albumId = spotifyApiService.extractAlbumId(normalizedPlaylistUri);
      return albumId ? spotifyApiService.getAllTrackUrisInAlbum(albumId) : [];
    }

    const playlistId = spotifyApiService.extractPlaylistId(normalizedPlaylistUri);
    return playlistId ? spotifyApiService.getAllTrackUrisInPlaylist(playlistId) : [];
  }, []);

  const handleResetTagifyState = useCallback(async () => {
    await resetTagData();
    await resetSmartPlaylists();
    await (window.TagifySync || syncRuntime).replaceCloudWithCurrentLocalState();
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
      void setSmartPlaylists((currentPlaylists) =>
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
      ).catch((error) => {
        console.error("Could not update Smart Playlist filters after changing tags:", error);
        Spicetify.showNotification("Tagify couldn't update your Smart Playlists after changing tags. Please try again.", true);
      });
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

  const handleImportSmartPlaylists = useCallback(
    async (data: unknown, selections?: SmartPlaylistRecipeSelection[]) => {
      if (!isSmartPlaylistRecipeBundle(data) || !selections) {
        throw new Error("Choose a shared setup file and review its tags before adding it.");
      }
      const accountDatabase = getTagifyDatabaseName();
      await flushLocalPersistence();
      await loadSmartPlaylistsFromStorage();
      const installed = await indexedDBStorage.installSharedSmartPlaylistSetups(data, selections, accountDatabase);
      if (getTagifyDatabaseName() !== accountDatabase) throw new Error("Your account changed. Return to the account where you saved these setups.");
      if (installed.importedCount > 0) clearExplicitSmartPlaylistClear();
      try { await refreshPersistedTagData(); }
      catch (cause) { console.error("Saved shared setups could not be shown", cause); Spicetify.showNotification("Your setups were saved, but the view couldn’t refresh. Reopen Tagify to see them.", true); }
      window.dispatchEvent(new CustomEvent("tagify:smartPlaylistsUpdated", { detail: { playlists: installed.playlists } }));
      return {
        importedCount: installed.importedCount, skippedCount: installed.skippedCount,
        relinkedCount: 0, unresolvedCount: 0, verificationUnavailable: false,
        recipeImport: true, createdTagCount: installed.createdTagCount,
      };
    },
    [refreshPersistedTagData],
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
      // Album details let a newly tagged track count toward its album at once.
      toggleTagSingleTrack(activeTrack.uri, tagId, activeTrackMetadata);
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
  const isLibraryViewActive = !showCommunityWorkspace;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>Tagify</h1>
        </div>
        <div className={styles.viewTabs} role="tablist" aria-label="Tagify views">
          <button
            className={`${styles.viewTab} ${
              isLibraryViewActive && activeView === "tracks" ? styles.viewTabActive : ""
            }`}
            onClick={() => selectAppView("tracks")}
            role="tab"
            aria-selected={isLibraryViewActive && activeView === "tracks"}
          >
            Tracks
          </button>
          <button
            className={`${styles.viewTab} ${
              isLibraryViewActive && activeView === "albums" ? styles.viewTabActive : ""
            }`}
            onClick={() => selectAppView("albums")}
            role="tab"
            aria-selected={isLibraryViewActive && activeView === "albums"}
          >
            Albums
          </button>
          <button
            className={`${styles.viewTab} ${
              isLibraryViewActive && activeView === "playlists" ? styles.viewTabActive : ""
            }`}
            onClick={() => selectAppView("playlists")}
            role="tab"
            aria-selected={isLibraryViewActive && activeView === "playlists"}
          >
            Playlists
          </button>
          <button
            className={`${styles.viewTab} ${
              isLibraryViewActive && activeView === "artists" ? styles.viewTabActive : ""
            }`}
            onClick={() => selectAppView("artists")}
            role="tab"
            aria-selected={isLibraryViewActive && activeView === "artists"}
          >
            Artists
          </button>
        </div>
        <button
          className={`${styles.communityButton} ${showCommunityWorkspace ? styles.communityButtonActive : ""}`}
          onClick={openCommunityWorkspace}
          title="Open the Tagify Community workspace"
          aria-label="Open the Tagify Community workspace"
          aria-pressed={showCommunityWorkspace}
        >
          <Users size={15} aria-hidden="true" />
          <span>Community</span>
        </button>
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

      <CommunityUpdates enabled={
        !isLoading && !migrationProgress && !orchestratorResult?.fallbackMode &&
        !shouldShowSurvey && !shouldShowPowerUserModal && !showCommunityOnboarding &&
        !showCloudRecovery && !cloudRecoveryPending && !showCloudSync &&
        !showMigrationModal && !showTagManager && !showExport
      } />
      {metadataBackfillProgress && metadataBackfillProgress.total > 0 && (
        <div
          className={styles.backfillBanner}
          role="status"
          aria-live="polite"
        >
          <div className={styles.backfillSummary}>
            <span>Updating saved track details</span>
            <span>
              {metadataBackfillProgress.processed} / {metadataBackfillProgress.total}
            </span>
          </div>
          <progress
            className={styles.backfillProgress}
            value={metadataBackfillProgress.processed}
            max={metadataBackfillProgress.total}
            aria-label="Saved track detail update progress"
          />
          <span className={styles.backfillHint}>
            {metadataBackfillProgress.remaining > 0
              ? `${metadataBackfillProgress.remaining} more saved tracks will update next time you open Tagify.`
              : "You can keep using Tagify while saved track details update."}
          </span>
        </div>
      )}

      <SmartPlaylistTagChoices enabled={
        !isLoading && !migrationProgress && !orchestratorResult?.fallbackMode &&
        !shouldShowSurvey && !shouldShowPowerUserModal && !showCommunityOnboarding &&
        !showCloudRecovery && !cloudRecoveryPending && !showCloudSync &&
        !showMigrationModal && !showTagManager && !showExport
      } />

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

      {showCommunityOnboarding && (
        <CommunityOnboardingModal
          onClose={() => setShowCommunityOnboarding(false)}
          launchContext={communityOnboardingLaunchContext}
        />
      )}

      {showCloudRecovery && cloudRecoveryPending && (
        <CloudRecoveryModal onClose={() => setShowCloudRecovery(false)} />
      )}

      {showCloudSync && !cloudRecoveryPending && (
        <CloudSyncModal onClose={() => setShowCloudSync(false)} />
      )}

      <DataManager
        onExportTagData={exportTagData}
        onImportTagData={importTagData}
        onExportRekordbox={() => setShowExport(true)}
        onResetTagifyData={handleResetTagifyState}
        onRetryMigration={retryMigration}
        lastSaved={lastSaved}
      />

      {showCommunityWorkspace ? (
        <CommunityWorkspace
          onConnectCommunity={connectCommunity}
          onOpenCloudSync={openCloudSync}
          connected={syncConnected}
          status={syncStatus}
          connectedAccountId={getDesktopSyncConfiguration()?.accountId || null}
          connectedDeviceId={getDesktopSyncConfiguration()?.deviceId || null}
          onDisconnect={disconnectCommunitySync}
        />
      ) : isLoading ? (
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
                    albumProgress={activeTrackAlbumProgress}
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
                onExportSmartPlaylists={exportSmartPlaylists}
                onImportSmartPlaylists={handleImportSmartPlaylists}
                requestedSmartPlaylistEditId={requestedSmartPlaylistEditId}
                onSmartPlaylistEditRequestHandled={() =>
                  setRequestedSmartPlaylistEditId(null)
                }
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
                    albumTrackSummary={
                      activePlaylistUri.startsWith("spotify:album:")
                        ? albumTrackSummaries.get(activePlaylistUri)
                        : undefined
                    }
                    tracks={tagData.tracks}
                    taxonomy={tagData.taxonomy}
                    activeTagFilters={currentPlaylistFilterState.activeTagFilters}
                    excludedTagFilters={
                      currentPlaylistFilterState.excludedTagFilters
                    }
                    onSetRating={handleSetActivePlaylistRating}
                    onSetEnergy={handleSetActivePlaylistEnergy}
                    onRemoveTag={handleRemoveActivePlaylistTag}
                    onToggleTagIncludeOff={
                      currentPlaylistFilterState.toggleBasicTagFilter
                    }
                    onOpenPlaylist={handleOpenPlaylist}
                    onRefreshMetadata={handleRefreshActivePlaylistMetadata}
                    onLoadTrackUris={handleLoadPlaylistTrackUris}
                    onApplyTrackUpdates={applyBatchTagUpdates}
                    onTagTrack={(trackUri) => {
                      void handleSelectTrackForTagging(trackUri);
                      selectAppView("tracks");
                    }}
                    onSetTrackRating={(trackUri, rating, metadata) => {
                      void setRating(trackUri, rating, metadata);
                    }}
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
                tracks={tagData.tracks}
                albumTrackSummaries={albumTrackSummaries}
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
                onToggleTagFilter={currentPlaylistFilterState.toggleBasicTagFilter}
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
                    onToggleTagIncludeOff={artistFilterState.toggleBasicTagFilter}
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
                onToggleTagFilter={artistFilterState.toggleBasicTagFilter}
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
