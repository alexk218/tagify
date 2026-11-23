import "@/features/onboarding/preview/installSandbox";
import { announceSavedTracks } from "@/extensions/extensionEdits";
import { useAutomaticRecordingReuse } from "@/features/recording-reuse/hooks/useAutomaticRecordingReuse";
import { useNearRecording } from "@/features/recording-reuse/hooks/useNearRecording";
import { useAlbumNearRecordings } from "@/features/recording-reuse/hooks/useAlbumNearRecordings";
import { useRecordingLibrary } from "@/features/recording-reuse/hooks/useRecordingLibrary";
import { RecordingConflicts } from "@/features/recording-reuse/components/RecordingConflicts";
import { recordingAnnotations } from "@/features/recording-reuse/utils/recordingReuse";
import { TrackEditHistoryControls } from "@/features/track-session/history/TrackEditHistoryControls";
import { useTrackEditHistory } from "@/features/track-session/history/useTrackEditHistory";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { usePlaylistTrackInsights, useArtistTrackInsights, playlistMembershipStore } from "@/features/track-insights";
import { useAlbumMembership, useAlbumTrackListLookups } from "@/features/playlist-state";
import { useRatingControlTheme } from "@/hooks/shared/useRatingControlTheme";
import { useProductAnalyticsView } from "@/features/product-analytics/useProductAnalyticsView";
import { recordProductInteraction, songsBucket } from "@/features/product-analytics/productAnalytics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./app.module.css";
import "./styles/globals.css";
import packageJson from "@/package";
import {
  DataManager,
  MigrationResultModal,
  TagManager,
  TagSelector,
  ArtistMetadata,
  PlaylistMetadata,
  dispatchTagDataUpdatedEvent,
  useTagData,
} from "@/features/tag-data";
import { countTagUses } from "@/features/tag-data/utils/tagSelector.sorting";
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
import { StatsLoading, StatsSheet, StatsWorkspace, useStatsBaseline, type StatsTrackSet } from "@/features/library-stats";
import { UpdateBanner, useUpdateChecker } from "@/features/update-check";
import { CommunityUpdates } from "@/features/community-updates/CommunityUpdates";
import type { CommunityLock } from "@/features/track-session/components/TrackDetailsCommunity";
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
  useSongDetailsFill,
} from "@/features/metadata-backfill";
import { graphqlRateLimiter } from "./utils/RateLimiter";
import { spotifyApiService } from "./services/SpotifyApiService";
import { revealElement } from "@/utils/revealElement";
import { communityPairing } from "@/features/community/communityPairing";
import { FirstRunTip, firstRunTipCopy } from "@/features/onboarding/components/FirstRunTip";
import type { HowToTipId } from "@/features/onboarding/firstRunTips";
import { useFirstRunTips } from "@/features/onboarding/hooks/useFirstRunTips";
import { TasteQuestion } from "@/features/onboarding/components/TasteQuestion";
import { useTasteQuestion } from "@/features/onboarding/hooks/useTasteQuestion";
import { useHowToTips } from "@/features/onboarding/hooks/useHowToTips";
import { howToTipCopy } from "@/features/onboarding/howToTips";
import type { CommunityMatch, CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import { OnboardingPreviewBanner } from "@/features/onboarding/preview/OnboardingPreviewBanner";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { isSameTagName } from "@tagify/community-contracts";
import { removeTags } from "@/features/tag-data/utils/tagManager.taxonomy";
import type { MergedTag } from "@/features/community/taggedByOthers/TaggedByOthersRows";
import { TagsTriedHere, tagIsUnused } from "@/features/community/taggedByOthers/tagsTriedHere";

// Invite to Community once a first tagging session has shown what tags are for.
const COMMUNITY_INVITE_MIN_TAGGED = 5;
import { buildTagGroupFilterIdSet, pruneTagFilterFormula } from "@/utils/tagFilterGroups";
import { buildCategoryTree, buildValidTagIdSet } from "@/utils/tagTaxonomy";
import {
  CommunityConnectPrompt,
  CommunityPublishPrompt,
  CommunityRatingSharingQuestion,
  CommunityOnboardingModal,
  CloudSyncModal,
  CloudRecoveryModal,
  CommunityShareDialog,
  CommunityWorkspace,
  isCloudRecoveryStatus,
  useCommunitySharing,
  type CommunityConnectEntry,
  type SharingSurface,
} from "@/features/community";
import { useReconnectionState } from "@/features/community/ReconnectionApproval";
import { othersTagsWaitForSharing } from "@/features/community/useCommunitySharing";
import { hidesEveryTag, setSharingLockReason } from "@/features/community/sharingLockReason";
import { communitySwitchOn } from "@/features/community/communitySwitches";
import { flushCommunityTagAddCredits, queueCommunityTagAddCredits } from "@/features/community/communityTagAddCredits";
import { flushLikedSaveCredits } from "@/features/community/communityLikedSaveCredits";
import { TaggedByOthersSection, USABLE_BEFORE_SHARING, type TaggedByOthersPreview } from "@/features/community/taggedByOthers/TaggedByOthersSection";
import {
  communityTeaserPreview,
  forgetCommunityTeaserPreview,
  recordCommunityTeaserConnectClicked,
  teaserRowsOf,
  type CommunityTeaserSurface,
} from "@/features/community/taggedByOthers/communityTeaserPreview";
import { RewindPrompt, REWIND_URL, useRewindPrompt } from "@/features/rewind";
import { AndroidReleaseNotice, CONNECT_FOR_PHONE_EVENT, SpotifyShareTip, openPhoneStore, recordPhoneAppStoreClicked, useAndroidReleaseNotice, useSpotifyShareTip } from "@/features/phone-app";
import { Users } from "lucide-react";
import { syncRuntime, type SyncStatus } from "@/services/sync/SyncRuntime";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import { openCommunityUrlSignedIn } from "@/features/community/communityWebsiteLink";
import { NotificationBell } from "@/features/community/notifications/NotificationBell";

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

/** Queues members' tags just added to a song so the people who put them there get credit on Community. */
function creditMembersTags(trackUri: string, names: readonly string[]) {
  const connection = getDesktopSyncConfiguration();
  if (connection) queueCommunityTagAddCredits(connection.accountId, trackUri, names);
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
  useRatingControlTheme();
  const [showTagManager, setShowTagManager] = useState<boolean>(false);
  const [expandedTagManagerCategoryIds, setExpandedTagManagerCategoryIds] =
    useState<string[] | undefined>(undefined);
  const [selectedTagManagerSubcategoryId, setSelectedTagManagerSubcategoryId] =
    useState<string | null | undefined>(undefined);
  const [showStats, setShowStats] = useState<boolean>(false);
  // Stats stays mounted after its first opening so it reopens exactly where the member left it.
  const [statsMounted, setStatsMounted] = useState<boolean>(false);
  // Tracks the member opened from Stats; the track list shows exactly these until cleared.
  const [statsTrackSet, setStatsTrackSet] = useState<(StatsTrackSet & { id: number; reveal: "list" | "track" }) | null>(null);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [showCommunityWorkspace, setShowCommunityWorkspace] = useState(false);
  // Where Community setup was opened from; null while it is closed.
  const [communitySetupEntry, setCommunitySetupEntry] = useState<CommunityConnectEntry | null>(null);
  const showCommunityOnboarding = communitySetupEntry !== null;
  const [showCloudRecovery, setShowCloudRecovery] = useState(false);
  const [showCloudSync, setShowCloudSync] = useState(false);
  // Where the sharing window was opened from; null while it is closed.
  const [shareSurface, setShareSurface] = useState<SharingSurface | null>(null);
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
  // Community switches; on unless Community turns one off (communitySwitches.ts).
  // Read again whenever sync reports, which is when Community's capability list can change.
  const taggedByOthersInTrackList = useMemo(() => communitySwitchOn("taggedByOthersTrackList"), [syncStatus, syncConnected]);
  const othersTagsSharingGate = useMemo(() => communitySwitchOn("othersTagsSharingGate"), [syncStatus, syncConnected]);
  // Not connected: a preview of how other members tagged some of their Liked Songs (switch starts off).
  const communityTeasers = useMemo(() => !syncConnected && communitySwitchOn("communityTeasers"), [syncStatus, syncConnected]);
  const communityTagSearchOn = useMemo(() => communitySwitchOn("communityTagSearch"), [syncStatus, syncConnected]);
  const communitySharing = useCommunitySharing({
    connected: syncConnected,
    status: syncStatus,
    active: showCommunityWorkspace || showCommunityOnboarding || showCloudSync || shareSurface !== null
      // The track list's "Tagged by others" and "N others" need to know whether the member shares their tags.
      || ((othersTagsSharingGate || taggedByOthersInTrackList) && activeView === "tracks"),
  });
  const tagsNotPublished = othersTagsWaitForSharing(syncConnected, communitySharing);
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
    importSmartPlaylists,
    resetSmartPlaylists,
  } = useSmartPlaylists();

  const {
    tagData,
    isLoading,
    refreshPersistedTagData,
    showSavedRecords,
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
    fillMissingAudioFeatures,
    updateBpm,
    applyBatchTagUpdates,
    findTagName,
    addTagPlaylist,
    toggleTagPlaylist,
    setPlaylistRating,
    setPlaylistEnergy,
    refreshPlaylistMetadata,
    addTagArtist,
    toggleTagArtist,
    setArtistRating,
    setArtistEnergy,
    refreshArtistMetadata,
    replaceTaxonomy,
    exportTagData,
    importTagData,
    resetTagData,
  } = useTagData({
    onSyncTrack: syncTrackWithSmartPlaylists,
    onSyncMultipleTracks: syncMultipleTracksWithSmartPlaylists,
  });

  useSongDetailsFill({
    enabled: !isLoading && !migrationProgress,
    onUpdated: () => {
      void refreshPersistedTagData().catch((error) => console.error("Tagify: Could not show updated song details", error));
    },
  });

  useMetadataBackfill({
    enabled: !isLoading && !migrationProgress, // Only run after loading/migration complete
    onProgress: setMetadataBackfillProgress,
    onComplete: () => {
      void refreshPersistedTagData().catch((error) => console.error("Tagify: Could not show updated song details", error));
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
  } = useTrackState(tagData.tracks);
  // Published with every tag hidden counts as keeping tags private (Alex, 2026-11-23), so the locks apply.
  const tagsAllHidden = useMemo(
    () => syncConnected && communitySharing.state === "public"
      && hidesEveryTag(tagData.tracks, tagData.taxonomy, communitySharing.policy),
    [syncConnected, communitySharing.state, communitySharing.policy, tagData.tracks, tagData.taxonomy],
  );
  const tagsNotShared = tagsNotPublished || tagsAllHidden;
  useEffect(() => setSharingLockReason(tagsAllHidden ? "all-hidden" : "private"), [tagsAllHidden]);

  const {
    isMultiTagging,
    lockedMultiTrackUri,
    multiTagTracks,
    multiTrackDraftTags,
    setIsMultiTagging,
    setMultiTagTracks,
    setLockedMultiTrackUri,
    setMultiTrackDraftTags,
    replaceMultiTrackDraft,
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
  // The most songs any one tag is on: the playlist tip waits until a filter has enough to show.
  const mostSongsOnOneTag = useMemo(() => {
    const counts = new Map<string, number>();
    for (const track of Object.values(tagData.tracks)) for (const tagId of new Set(track.tagIds)) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    return Math.max(0, ...counts.values());
  }, [tagData.tracks]);
  const ratedTrackCount = useMemo(() => Object.values(tagData.tracks).filter((track) => track.rating > 0 || track.energy > 0).length, [tagData.tracks]);
  // The people who put members' tags on a song earn curator points once sync has sent the tags.
  useEffect(() => {
    if (syncStatus !== "idle") return;
    void flushCommunityTagAddCredits(getDesktopSyncConfiguration(), (path, options) => syncRuntime.communityRequest(path, options));
    // Songs saved to Liked Songs from On Community that Community hasn't taken yet.
    void flushLikedSaveCredits(getDesktopSyncConfiguration(), (path, options) => syncRuntime.communityRequest(path, options));
  }, [syncStatus]);
  // Members' tags on a Liked Song become the member's own tags (the same-named one when they have it), then go on the song.
  const placeMembersTags = useCallback(async (match: CommunityMatch, tags: CommunityMatchTag[]) => {
    await flushLocalPersistence();
    const account = getTagifyDatabaseName();
    const tagIds: string[] = [];
    for (const tag of tags) tagIds.push((await indexedDBStorage.createCommunityTag(tag.label, tag.paths, account)).id);
    await refreshPersistedTagData();
    if (account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music before adding tags.");
    const albumImageUrl = match.track.album?.images?.[0]?.url;
    await applyBatchTagUpdates([{
      trackUri: match.track.uri,
      toAdd: tagIds,
      toRemove: [],
      // Tag origin: copied from other members' tags.
      tagMethod: "copied",
      trackDetails: { name: match.track.name, artists: match.track.artists.map((artist) => artist.name).join(", ") },
      albumDetails: {
        albumName: match.track.album?.name,
        albumUri: match.track.album?.uri ?? null,
        albumImageUrl: albumImageUrl?.startsWith("https://") ? albumImageUrl : null,
      },
    }]);
    creditMembersTags(match.track.uri, tags.map((tag) => tag.label));
  }, [applyBatchTagUpdates, refreshPersistedTagData]);
  // The same tags from Community's "Your songs, tagged by others".
  const addCommunityListTags = placeMembersTags;
  // "Tagged by others" in the track list: a members' tag goes on or comes off the song, locked in the
  // editor so Undo/Redo covers it like any edit there.
  const tagsTriedHere = useRef(new TagsTriedHere());
  const lockMembersSong = useCallback((match: CommunityMatch) => {
    void handleSelectTrackForTagging(match.track.uri, match.track as SpotifyTrack);
    trackEditHistory.select("single", [match.track.uri]);
  }, [handleSelectTrackForTagging]);
  const toggleMembersTag = useCallback(async (match: CommunityMatch, tag: MergedTag, on: boolean) => {
    const uri = match.track.uri;
    lockMembersSong(match);
    const albumImageUrl = match.track.album?.images?.[0]?.url;
    const metadata = {
      name: match.track.name,
      artists: match.track.artists.map((artist) => artist.name).join(", "),
      albumName: match.track.album?.name,
      albumUri: match.track.album?.uri ?? null,
      albumImageUrl: albumImageUrl?.startsWith("https://") ? albumImageUrl : null,
    };
    const same = (tagId: string) => tag.spellings.some((label) => isSameTagName(tagData.taxonomy.tagsById[tagId]?.name ?? "", label));
    if (!on) {
      for (const tagId of (tagData.tracks[uri]?.tagIds ?? []).filter(same)) await toggleTagSingleTrack(uri, tagId, metadata);
      return;
    }
    let tagId = Object.keys(tagData.taxonomy.tagsById).find(same);
    if (!tagId) {
      await flushLocalPersistence();
      const account = getTagifyDatabaseName();
      const created = await indexedDBStorage.createCommunityTag(tag.label, tag.paths, account);
      await refreshPersistedTagData();
      if (account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music before adding tags.");
      tagId = created.id;
      tagsTriedHere.current.note(tagId, uri);
    }
    await toggleTagSingleTrack(uri, tagId, metadata, "copied");
    creditMembersTags(uri, tag.spellings);
  }, [lockMembersSong, refreshPersistedTagData, tagData.taxonomy, tagData.tracks, toggleTagSingleTrack]);
  // Members' tags on a song in the track list, from its open Community details.
  const addTrackListCommunityTags = useCallback(async (uri: string, tags: CommunityMatchTag[]) => {
    const track = tagData.tracks[uri];
    await placeMembersTags({
      track: {
        uri,
        name: track?.name ?? "",
        artists: (track?.artists ?? "").split(", ").filter(Boolean).map((name) => ({ name })),
        album: {
          name: track?.albumName ?? "",
          uri: track?.albumUri ?? null,
          images: track?.albumImageUrl ? [{ url: track.albumImageUrl }] : [],
        },
        duration_ms: 0,
      },
      tags,
    }, tags);
  }, [placeMembersTags, tagData.tracks]);
  const openCommunityListSong = useCallback((uri: string) => {
    setShowCommunityWorkspace(false);
    setActiveView("tracks");
    void handleSelectTrackForTagging(uri);
  }, [handleSelectTrackForTagging]);
  const categoryTree = useMemo(
    () => buildCategoryTree(tagData.taxonomy),
    [tagData.taxonomy],
  );
  const albumMembership = useAlbumMembership();
  const albumTrackSummaries = useMemo(
    () => buildAlbumTrackSummaries(tagData.tracks, tagData.taxonomy, albumMembership),
    [tagData.taxonomy, tagData.tracks, albumMembership],
  );
  const playlistTrackInsights = usePlaylistTrackInsights(tagData.playlists, tagData.tracks, tagData.taxonomy,
    activeView === "playlists", activePlaylistUri);
  const artistTrackInsights = useArtistTrackInsights(tagData.tracks, tagData.taxonomy, activeView === "artists");
  const { shouldShowPowerUserModal, dismissPowerUserModal } = usePowerUserModal(
    {
      taggedTrackCount,
      lastUserTrackAddedEvent,
    },
  );

  useTagifyUsage(packageJson.version);
  // The Sync dialog opens over other screens, usually Community, so it is checked first.
  useProductAnalyticsView(isLoading ? null : showCloudSync && !cloudRecoveryPending ? "cloud_sync_opened" :
    showTagManager ? "tag_manager_opened" : showCommunityWorkspace ? "community_opened" : showStats ? "stats_opened" :
    showLocalTracksModal ? "local_files_opened" : `${activeView}_viewed`);
  const { shouldShowSurvey, completeSurvey, skipSurvey } = useDiscoverySurvey(packageJson.version, {
    lastUserTrackAddedEvent,
    canShowSurvey: !isLoading && !migrationProgress && !orchestratorResult?.fallbackMode &&
      !shouldShowPowerUserModal && !showCommunityOnboarding && !showCloudRecovery &&
      !cloudRecoveryPending && !showCloudSync && shareSurface === null && !showMigrationModal && !showTagManager &&
      !showStats && !showLocalTracksModal,
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

  const toggleStats = useCallback(() => {
    setStatsMounted(true);
    setShowStats((current) => !current);
  }, []);
  const closeStats = useCallback(() => setShowStats(false), []);
  const returnToStats = useCallback(() => { setStatsMounted(true); setShowStats(true); }, []);

  const statsBaseline = useStatsBaseline(tagData, statsMounted && !isLoading);

  // Stats actions close the sheet and show exactly the tracks behind the number in the Tracks view.
  // The track list scrolls itself into view; opening one song shows its details at the top instead.
  const appRootRef = useRef<HTMLDivElement>(null);
  const showStatsTracks = useCallback((set: StatsTrackSet, reveal: "list" | "track" = "list") => {
    setStatsTrackSet({ ...set, id: Date.now(), reveal });
    setShowStats(false);
    selectAppView("tracks");
    if (reveal === "track") requestAnimationFrame(() => revealElement(appRootRef.current));
  }, [selectAppView]);

  const connectCommunity = useCallback((entry: CommunityConnectEntry) => {
    if (cloudRecoveryPending) {
      setShowCloudRecovery(true);
      return;
    }
    setShowCloudSync(false);
    setCommunitySetupEntry(entry);
  }, [cloudRecoveryPending]);
  // The phone app panel and Mobile tagging ask for this: the phone apps only work with a Tagify account.
  useEffect(() => {
    const connectForPhone = () => connectCommunity("phone_app");
    window.addEventListener(CONNECT_FOR_PHONE_EVENT, connectForPhone);
    return () => window.removeEventListener(CONNECT_FOR_PHONE_EVENT, connectForPhone);
  }, [connectCommunity]);
  const connectFromTeaser = useCallback((surface: CommunityTeaserSurface) => {
    recordCommunityTeaserConnectClicked(surface);
    connectCommunity(`teaser_${surface}`);
  }, [connectCommunity]);

  // Asked once per Spotify session, and only once the track list is open, so Liked Songs aren't read for nothing.
  const [teaserPreview, setTeaserPreview] = useState<TaggedByOthersPreview | null>(null);
  const [teaserPreviewLoading, setTeaserPreviewLoading] = useState(false);
  useEffect(() => {
    if (syncConnected) {
      forgetCommunityTeaserPreview();
      setTeaserPreview(null);
      return;
    }
    if (!communityTeasers || activeView !== "tracks") return;
    let current = true;
    setTeaserPreviewLoading(true);
    void communityTeaserPreview().then((preview) => {
      if (current) setTeaserPreview(preview);
    }).finally(() => { if (current) setTeaserPreviewLoading(false); });
    return () => { current = false; setTeaserPreviewLoading(false); };
  }, [syncConnected, communityTeasers, activeView]);
  const teaserRows = useMemo(
    () => (communityTeasers && teaserPreview
      ? { others: teaserRowsOf(teaserPreview, USABLE_BEFORE_SHARING), found: teaserPreview.total, onConnect: () => connectFromTeaser("rows") }
      : undefined),
    [communityTeasers, teaserPreview, connectFromTeaser],
  );

  // A connection approved after its waiting screen closed (or approved from the B banner) opens setup
  // for the sharing choice.
  useEffect(() => communityPairing.onConnected((connection) => {
    setCommunitySetupEntry((current) => current ?? connection.entry);
  }), []);

  // A Spotify update signed this computer out, and Community is waiting for
  // the member to approve reconnecting it: Cloud Sync shows the code to check.
  const reconnection = useReconnectionState();

  // Someone not connected yet goes straight to Tagify account setup, the one way to sign in.
  const openCloudSync = useCallback(() => {
    if (cloudRecoveryPending) {
      setShowCloudRecovery(true);
      return;
    }
    if (!getDesktopSyncConfiguration() && !reconnection) {
      connectCommunity("sync");
      return;
    }
    setShowCloudSync(true);
  }, [cloudRecoveryPending, reconnection, connectCommunity]);

  const reconnectionShownFor = useRef<string | null>(null);
  useEffect(() => {
    if (reconnection?.status !== "waiting" || isLoading) return;
    if (reconnectionShownFor.current === reconnection.userCode) return;
    reconnectionShownFor.current = reconnection.userCode;
    openCloudSync();
  }, [reconnection, isLoading, openCloudSync]);

  const openCommunitySharing = useCallback((surface: SharingSurface) => {
    if (cloudRecoveryPending) {
      setShowCloudRecovery(true);
      return;
    }
    if (!getDesktopSyncConfiguration()) {
      connectCommunity("community");
      return;
    }
    setShowCloudSync(false);
    setShareSurface(surface);
  }, [cloudRecoveryPending, connectCommunity]);
  // Every Community-locked feature: not connected asks to connect, connected but not sharing their
  // tags asks to share them, with the same limit (Alex, 2026-11-22).
  const trackDetailsCommunityLock = useMemo<CommunityLock | undefined>(
    () => (communityTeasers ? { ask: "connect", onAct: () => connectFromTeaser("track_details") }
      : othersTagsSharingGate && tagsNotShared ? { ask: "share", onAct: () => openCommunitySharing("workspace") }
        : undefined),
    [communityTeasers, connectFromTeaser, othersTagsSharingGate, tagsNotShared, openCommunitySharing],
  );

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
        setShareSurface(null);
        setShowCommunityWorkspace(false);
        setCommunitySetupEntry(null);
      }
    };
    window.addEventListener("tagify:syncStatus", handleSyncStatus);
    handleSyncStatus(new CustomEvent("tagify:syncStatus", { detail: { status: window.TagifySync?.getStatus() } }));
    return () => window.removeEventListener("tagify:syncStatus", handleSyncStatus);
  }, []);

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
  // Moving on from a song ends its Undo history; tags tried on it that nothing uses then go away.
  useEffect(() => {
    const unused = tagsTriedHere.current.takeUnused(activeTrackUri, (tagId) => tagIsUnused(tagData, tagId, [...activeTagFilters, ...excludedTagFilters]));
    if (!unused.length) return;
    void (async () => {
      const account = getTagifyDatabaseName();
      await flushLocalPersistence();
      if (account !== getTagifyDatabaseName()) return;
      if (await indexedDBStorage.saveTaxonomy((current) => removeTags(current, unused))) await refreshPersistedTagData();
    })();
  // Only when the locked song changes.
  }, [activeTrackUri]);
  const activeTrackData = activeTrackUri
    ? tagData.tracks[activeTrackUri]
    : undefined;
  const activeTrackAlbumUri = activeTrack?.album?.uri ?? null;
  const activeAlbumLookup = useMemo(() => activeTrackAlbumUri ? [activeTrackAlbumUri] : [], [activeTrackAlbumUri]);
  useAlbumTrackListLookups(activeAlbumLookup);
  const activeTrackAlbumProgress = useMemo(
    () =>
      activeTrackAlbumUri?.startsWith("spotify:album:")
        ? {
            albumUri: activeTrackAlbumUri,
            taggedTrackCount:
              albumTrackSummaries.get(activeTrackAlbumUri)?.taggedTrackCount ?? 0,
            knownTrackCount: albumTrackSummaries.get(activeTrackAlbumUri)?.totalTrackCount ?? tagData.playlists[activeTrackAlbumUri]?.trackCount ?? null,
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
      activeArtistData && activeArtistData.name && activeArtistData.name !== "Unknown Artist";

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
    }).catch(() => { /* Saved edits remain usable while optional details are unavailable. */ });

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

  const handleFillActiveTrackAudioFeatures = useCallback(
    (features: { bpm: number | null; camelotKey: string | null }) => {
      if (activeTrackUri) fillMissingAudioFeatures(activeTrackUri, features);
    },
    [activeTrackUri, fillMissingAudioFeatures],
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
    (newTaxonomy: typeof tagData.taxonomy, removedTagIds: string[], base: typeof tagData.taxonomy) => {
      // Only tags the user removed leave filters and Smart Playlist rules;
      // tags created elsewhere meanwhile stay valid.
      const removed = new Set(removedTagIds);
      const validTagIds = new Set(
        [...buildValidTagIdSet(newTaxonomy), ...buildValidTagIdSet(tagData.taxonomy)].filter((tagId) => !removed.has(tagId)),
      );
      // Category terms ("Any Genre", "No Mood") stay while their category or
      // folder exists, including ones created elsewhere since this edit began.
      const baseGroupIds = base ? buildTagGroupFilterIdSet(base) : new Set<string>();
      buildTagGroupFilterIdSet(newTaxonomy).forEach((termId) => validTagIds.add(termId));
      buildTagGroupFilterIdSet(tagData.taxonomy).forEach((termId) => {
        if (!baseGroupIds.has(termId)) validTagIds.add(termId);
      });

      replaceTaxonomy(newTaxonomy, removedTagIds, base);
      if (removed.size === 0) return;
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
      tagData.taxonomy,
    ],
  );

  const handleImportSmartPlaylists = useCallback(
    async (data: unknown, selections?: SmartPlaylistRecipeSelection[]) => {
      if (Array.isArray(data)) return importSmartPlaylists(data);
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
    [refreshPersistedTagData, importSmartPlaylists],
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
  // Read by the tag picker's "Most Used" sort only when it recounts.
  const getTagUses = () => countTagUses(tagData);

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

  const editingMode = !showCommunityWorkspace && !isLoading && activeView === "tracks"
    ? isMultiTagging && multiTagTracks.length ? "bulk" : !isMultiTagging && activeTrack && isDisplayedTrackMusic ? "single" : null
    : null;
  const editingUris = editingMode === "bulk" ? multiTagTracks.map(track => track.uri) : editingMode === "single" && activeTrack ? [activeTrack.uri] : [];
  const editHistory = useTrackEditHistory(editingMode, editingUris, {
    draft: multiTrackDraftTags,
    replaceDraft: replaceMultiTrackDraft,
    onSaved: async changes => {
      await refreshPersistedTagData();
      dispatchTagDataUpdatedEvent("batchUpdate");
      void syncMultipleTracksWithSmartPlaylists(changes);
    },
  });
  const applySelectionBatch = async (updates: Parameters<typeof applyBatchTagUpdates>[0]) => {
    const session = trackEditHistory.capture("bulk", multiTagTracks.map(track => track.uri));
    if (!trackEditHistory.hold(session)) throw new Error("Wait for the current edit to finish, then try saving again.");
    try {
      await flushLocalPersistence();
      const before = (await indexedDBStorage.loadAllStrict()).tracks;
      if (session?.account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music before saving changes.");
      // Tag origin: one action applied to the selected songs.
      await applyBatchTagUpdates(updates.map((update) => ({ ...update, tagMethod: "bulk" })));
      const after = (await indexedDBStorage.loadAllStrict()).tracks;
      trackEditHistory.record(session, before, after, "saved");
      const retagged = [...new Set(updates.map(({ trackUri }) => trackUri))].filter((trackUri) => JSON.stringify(before[trackUri]?.tagIds ?? []) !== JSON.stringify(after[trackUri]?.tagIds ?? [])).length;
      const songs = songsBucket(retagged);
      if (songs) recordProductInteraction("bulk_tag_applied", { songs });
    } finally { trackEditHistory.release(session); }
  };

  const onRecordingsChanged = async (changes: Parameters<typeof syncMultipleTracksWithSmartPlaylists>[0], syncChanges = changes) => {
    const account = getTagifyDatabaseName();
    const latest = await indexedDBStorage.getRecordingTracks(Object.keys(changes), account);
    if (account !== getTagifyDatabaseName()) return;
    showSavedRecords({ tracks: Object.fromEntries(Object.keys(changes).map(uri => [uri, latest[uri] || null])) });
    announceSavedTracks(latest);
    if (Object.keys(syncChanges).length) void syncMultipleTracksWithSmartPlaylists(Object.fromEntries(Object.keys(syncChanges).map(uri => [uri, latest[uri] || null])));
  };
  const recordingConflicts = useRecordingLibrary(tagData.tracks, !isLoading && !migrationProgress && !orchestratorResult?.fallbackMode, onRecordingsChanged);
  const recordingReuseStatus = useAutomaticRecordingReuse(activeView === "tracks" && !isMultiTagging && isDisplayedTrackMusic ? activeTrack : null, tagData.tracks, onRecordingsChanged);
  const nearRecording = useNearRecording(activeView === "tracks" && !isMultiTagging && isDisplayedTrackMusic ? activeTrack : null, tagData.tracks, recordingReuseStatus, onRecordingsChanged);
  useAlbumNearRecordings(activeView === "tracks" && !isMultiTagging && isDisplayedTrackMusic ? activeTrack : null, tagData.tracks, nearRecording.hasCandidates || !!nearRecording.linked, onRecordingsChanged);

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
        spotify: graphqlRateLimiter.getStats(),
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
  // "What do you listen to?" for a new library.
  // It comes once, before the first-run tips, which start right after Continue or Skip.
  const tasteQuestion = useTasteQuestion({
    taxonomy: tagData.taxonomy,
    isLoading,
    taggedTrackCount,
    connected: syncConnected,
    restoreOnOffer: cloudRecoveryPending,
    showSavedTags: refreshPersistedTagData,
  });
  const showTasteQuestion = tasteQuestion.asking &&
    !migrationProgress && !orchestratorResult?.fallbackMode &&
    !shouldShowSurvey && !shouldShowPowerUserModal && !showCommunityOnboarding &&
    !showCloudRecovery && !showCloudSync && shareSurface === null &&
    !showMigrationModal && !showTagManager && !showStats &&
    activeView === "tracks" && !showCommunityWorkspace;
  // Optional prompts wait until loading, recovery, onboarding, the question above and Tagify's own dialogs are out of the way.
  const canShowOptionalPrompts =
    !isLoading && !migrationProgress && !orchestratorResult?.fallbackMode &&
    !shouldShowSurvey && !shouldShowPowerUserModal && !showCommunityOnboarding &&
    !showCloudRecovery && !cloudRecoveryPending && !showCloudSync && shareSurface === null &&
    !showMigrationModal && !showTagManager && !showStats && !tasteQuestion.asking;
  // First-run tour that points at the real controls, one at a time.
  const othersFound = communityTeasers && !syncConnected ? teaserPreview?.total ?? 0 : 0;
  const tipsEnabled = activeView === "tracks" && !showCommunityWorkspace && !reconnection;
  const firstRunTips = useFirstRunTips({
    enabled: canShowOptionalPrompts && tipsEnabled,
    songShowing: isDisplayedTrackMusic,
    songLocked: isLocked,
    taggedSongs: taggedTrackCount,
    ratedSongs: ratedTrackCount,
    tagManagerOpen: showTagManager,
    othersTab: taggedByOthersInTrackList,
  });
  // Later tips (a playlist from tags, Smart Playlists) come after the tour, each at its moment.
  const howToTip = useHowToTips({
    enabled: canShowOptionalPrompts && tipsEnabled,
    coreTipPending: firstRunTips.tip !== null,
    mostSongsOnOneTag,
    smartPlaylists: smartPlaylists.length,
  });
  // The playlist tip points at Filters until a tag filter is on, then at Create Playlist. While the
  // filter panel is open it steps aside so it doesn't cover the tags.
  const tagFilterOn = activeTagFilters.length > 0;
  const [tipFiltersOpened, setTipFiltersOpened] = useState(false);
  const laterTip = howToTip === "playlist" && !tagFilterOn && tipFiltersOpened ? null : howToTip;
  const coreTip = firstRunTips.tip;
  const currentTip = coreTip ?? laterTip;
  const tipHandlers = useMemo(() => (currentTip ? {
    onShown: () => firstRunTips.shown(currentTip),
    onGotIt: () => firstRunTips.gotIt(currentTip),
    onSkip: () => firstRunTips.skip(currentTip),
    // Opening Manage Tags, the Tagged by others tab or Smart Playlists is what those tips ask for;
    // Create Playlist is what the playlist tip asks for.
    onAnchorClick: currentTip === "manage" || currentTip === "others" || currentTip === "smart"
      ? () => firstRunTips.acted(currentTip)
      : currentTip === "playlist"
        ? (tagFilterOn ? () => firstRunTips.acted("playlist") : () => setTipFiltersOpened(true))
        : undefined,
  } : null), [currentTip, tagFilterOn, firstRunTips.shown, firstRunTips.gotIt, firstRunTips.skip, firstRunTips.acted]);
  // "Your Rewind 2026 is ready" takes the Community invitations' place while it applies, so two banners never stack.
  const rewindPrompt = useRewindPrompt({
    enabled: canShowOptionalPrompts && !showCommunityWorkspace && !reconnection,
    tracks: tagData.tracks,
  });
  // "The Tagify Android app is out", for people who asked; it waits behind Rewind and holds the invitations' place.
  const androidNotice = useAndroidReleaseNotice({
    enabled: canShowOptionalPrompts && !rewindPrompt.holdsPlace && !showCommunityWorkspace && !reconnection,
  });
  // "Tag Spotify songs from your phone" (3.4.1), once per computer; the invitations wait for it.
  const spotifyShareTip = useSpotifyShareTip({
    enabled: canShowOptionalPrompts && !showCommunityWorkspace && !reconnection,
  });
  const openRewind = () => {
    rewindPrompt.open();
    if (syncConnected) void openCommunityUrlSignedIn(REWIND_URL);
    else connectCommunity("rewind");
  };
  // Only a member who never chose gets the dot; keeping tags private is respected.
  const sharingNeedsChoice = syncConnected && syncStatus === "publication-review-required" &&
    !showCommunityWorkspace && shareSurface === null;
  const communityButtonLabel = sharingNeedsChoice
    ? "Open the Tagify Community workspace. Your tags aren't public yet."
    : syncConnected
      ? "Open the Tagify Community workspace"
      : "Open the Tagify Community workspace. Create account or sign in to back up your tags.";

  // WIP until Alex picks the bell's look (NotificationBell.tsx): C joins it to the Community button.

  return (
    <div ref={appRootRef} className={styles.container}>
      <OnboardingPreviewBanner />
      <div className={styles.headerFrame}>
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
          <div className={styles.headerActions}>
          {syncConnected ? <NotificationBell /> : null}
          <button
            className={`${styles.communityButton} ${showCommunityWorkspace ? styles.communityButtonActive : ""}`}
            onClick={openCommunityWorkspace}
            title={communityButtonLabel}
            aria-label={communityButtonLabel}
            aria-pressed={showCommunityWorkspace}
          >
            <Users size={15} aria-hidden="true" />
            <span>Community</span>
            {sharingNeedsChoice ? <span className={styles.communityDot} aria-hidden="true" /> : null}
          </button>
          </div>
        </div>
      </div>

      {updateInfo?.hasUpdate && (
        <UpdateBanner updateInfo={updateInfo} onDismiss={dismissUpdate} />
      )}

      {storageError && (
        <div className={styles.errorBanner}>
          <p>⚠️ {storageError}</p>
          <p>Changes can't be saved right now. Your saved tags haven't been removed.</p>
        </div>
      )}

      {orchestratorResult?.fallbackMode && !showMigrationModal && (
        <div className={styles.fallbackBanner}>
          <span>⚠️ Tagify can't save changes right now.</span>
          <button
            onClick={() => setShowMigrationModal(true)}
            className={styles.fallbackBannerButton}
          >
            Learn More
          </button>
        </div>
      )}

      {showTasteQuestion && (
        <TasteQuestion choices={tasteQuestion.choices} onAnswer={tasteQuestion.answer} />
      )}
      {currentTip && tipHandlers && (
        <FirstRunTip
          key={`${currentTip}-${tagFilterOn}`}
          {...(coreTip ? firstRunTipCopy(coreTip, { othersFound }) : howToTipCopy(currentTip as HowToTipId, { tagFilterOn }))}
          {...tipHandlers}
        />
      )}
      <CommunityUpdates enabled={canShowOptionalPrompts} />
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

      {rewindPrompt.shown && (
        <RewindPrompt
          songs={rewindPrompt.songs}
          connected={syncConnected}
          onOpen={openRewind}
          onDismiss={rewindPrompt.dismiss}
        />
      )}
      {androidNotice.shown && (
        <AndroidReleaseNotice
          connected={syncConnected}
          onConnect={() => connectCommunity("phone_app")}
          onOpen={() => {
            recordPhoneAppStoreClicked("google_play", "notice");
            openPhoneStore("google_play");
            androidNotice.done();
          }}
          onDismiss={androidNotice.done}
        />
      )}
      {spotifyShareTip.shown && (
        <SpotifyShareTip
          connected={syncConnected}
          onConnect={() => {
            spotifyShareTip.done();
            connectCommunity("phone_app");
          }}
          onGetApp={() => openPhoneStore("app_store")}
          onClose={spotifyShareTip.done}
        />
      )}
      {/* The Community workspace already offers its own Connect button. */}
      <CommunityConnectPrompt
        enabled={canShowOptionalPrompts && !rewindPrompt.holdsPlace && !androidNotice.holdsPlace && !spotifyShareTip.holdsPlace && !showCommunityWorkspace && !reconnection && taggedTrackCount >= COMMUNITY_INVITE_MIN_TAGGED}
        connected={syncConnected}
        onConnect={() => connectCommunity("prompt")}
      />
      <CommunityPublishPrompt
        enabled={canShowOptionalPrompts && !rewindPrompt.holdsPlace && !androidNotice.holdsPlace && !spotifyShareTip.holdsPlace && !showCommunityWorkspace}
        connected={syncConnected}
        status={syncStatus}
        taggedTrackCount={taggedTrackCount}
        lastUserTrackAddedEvent={lastUserTrackAddedEvent}
        tracks={tagData.tracks}
        taxonomy={tagData.taxonomy}
        onReview={() => openCommunitySharing("invitation")}
      />
      {/* For members who already share their tags; the publish invitation is for members who haven't, so the two never show together. */}
      <CommunityRatingSharingQuestion
        enabled={canShowOptionalPrompts && !rewindPrompt.holdsPlace && !androidNotice.holdsPlace && !showCommunityWorkspace}
        connected={syncConnected}
        status={syncStatus}
      />

      <SmartPlaylistTagChoices enabled={canShowOptionalPrompts} />

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
          onConnectCommunity={() => { dismissPowerUserModal(); connectCommunity("invite"); }}
          onOpenSync={() => { dismissPowerUserModal(); openCloudSync(); }}
        />
      )}

      {communitySetupEntry && (
        <CommunityOnboardingModal
          entry={communitySetupEntry}
          sharing={communitySharing}
          tracks={tagData.tracks}
          taxonomy={tagData.taxonomy}
          onClose={() => setCommunitySetupEntry(null)}
        />
      )}

      {showCloudRecovery && cloudRecoveryPending && (
        <CloudRecoveryModal onClose={() => setShowCloudRecovery(false)} />
      )}

      {showCloudSync && !cloudRecoveryPending && (
        <CloudSyncModal
          sharing={communitySharing}
          onOpenSharing={() => openCommunitySharing("sync")}
          onConnect={() => connectCommunity("sync")}
          onClose={() => setShowCloudSync(false)}
        />
      )}

      {shareSurface && !cloudRecoveryPending && (
        <CommunityShareDialog
          surface={shareSurface}
          sharing={communitySharing}
          tracks={tagData.tracks}
          taxonomy={tagData.taxonomy}
          waitingForLibrary={syncStatus === "merge-required"}
          onClose={() => setShareSurface(null)}
        />
      )}

      <DataManager
        onExportTagData={exportTagData}
        onImportTagData={importTagData}
        onOpenStats={toggleStats}
        statsOpen={showStats}
        onResetTagifyData={handleResetTagifyState}
        onRetryMigration={retryMigration}
        historyControls={editingMode && <TrackEditHistoryControls canUndo={editHistory.canUndo} canRedo={editHistory.canRedo} busy={editHistory.busy} onUndo={editHistory.undo} onRedo={editHistory.redo} />}
        onConnectCommunity={() => connectCommunity("invite")}
        onOpenSync={openCloudSync}
      />

      {showCommunityWorkspace ? (
        <CommunityWorkspace
          onConnectCommunity={() => connectCommunity("community")}
          onOpenCloudSync={openCloudSync}
          onOpenSharing={() => openCommunitySharing("workspace")}
          connected={syncConnected}
          connectionPending={!syncConnected && Boolean(syncPairingService.getPending())}
          status={syncStatus}
          sharing={communitySharing}
          tracks={tagData.tracks}
          taxonomy={tagData.taxonomy}
          connectedAccountId={getDesktopSyncConfiguration()?.accountId || null}
          // With "Tagged by others" in the track list, the Community tab's card goes away.
          onAddMembersTags={taggedByOthersInTrackList ? undefined : addCommunityListTags}
          onConnectFromLibraryCheck={() => connectCommunity("library_check")}
          onOpenSong={openCommunityListSong}
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
                  onApplyBatchTagUpdates={applySelectionBatch}
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
              ) : !activeTrack ? (
                // Nothing playing or locked: say the one step that fills this space.
                <p className={styles.emptyTrackDetails}><span data-tip="play-song">Play a song and tag it here.</span></p>
              ) : (
                isDisplayedTrackMusic && (
                  <TrackDetails
                    recordingReuseStatus={recordingReuseStatus}
                    displayedTrack={activeTrack}
                    currentlyPlayingTrack={currentlyPlayingTrack}
                    trackData={activeTrackData || EMPTY_TRACK_DETAILS_DATA}
                    taxonomy={tagData.taxonomy}
                    onAddCommunityTags={addTrackListCommunityTags}
                    communityLock={trackDetailsCommunityLock}
                    activeTagFilters={activeTagFilters}
                    excludedTagFilters={excludedTagFilters}
                    onSetRating={handleSetActiveTrackRating}
                    onSetEnergy={handleSetActiveTrackEnergy}
                    onSetBpm={handleSetActiveTrackBpm}
                    onSetCamelotKey={handleSetActiveTrackCamelotKey}
                    onFillMissingAudioFeatures={handleFillActiveTrackAudioFeatures}
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

              {((isMultiTagging && multiTagTracks.length > 0) || (activeTrack && isDisplayedTrackMusic)) && (
                  <TagSelector
                    categories={categoryTree}
                    customAccentsById={tagData.taxonomy.customAccentsById}
                    selectedTagIds={trackTags}
                    onToggleTag={handleToggleTag}
                    onOpenTagManager={() => setShowTagManager(true)}
                    targetType={isMultiTagging ? "tracks" : "track"}
                    isMultiTagging={isMultiTagging}
                    isLockedTrack={!!lockedMultiTrackUri}
                    expandForFirstRun={taggedTrackCount === 0}
                    getTagUses={getTagUses}
                    usageTarget={isMultiTagging ? multiTagTracks.map((track) => track.uri).join(" ") : activeTrack?.uri}
                  />
                )}
              {!isMultiTagging && <RecordingConflicts key={getTagifyDatabaseName()} groups={recordingConflicts} taxonomy={tagData.taxonomy} onSave={async (group, choices) => {
                const account = getTagifyDatabaseName();
                await flushLocalPersistence();
                if (account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music.");
                const proposals = Object.fromEntries(group.entries.map(([uri, data]) => [uri, { identity: data.recordingIdentity!, annotations: recordingAnnotations(data) }]));
                const changes = await indexedDBStorage.linkRecordings(proposals, group.entries[0][0], false, { automatic: true, expectedDatabaseName: account, choices });
                trackEditHistory.resetForTracks(Object.keys(changes));
                if (account === getTagifyDatabaseName()) await onRecordingsChanged(changes);
              }} />}
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
                statsTrackSet={statsTrackSet}
                onClearStatsTrackSet={() => setStatsTrackSet(null)}
                onReturnToStats={returnToStats}
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
                onAddCommunityTags={addTrackListCommunityTags}
                taggedByOthersView={taggedByOthersInTrackList ? (
                  <TaggedByOthersSection
                    inTrackList
                    // A revoked device reconnects first; nothing is checked until then.
                    connected={syncConnected && syncStatus !== "reauthorize"}
                    connectionPending={!syncConnected && Boolean(syncPairingService.getPending())}
                    accountId={getDesktopSyncConfiguration()?.accountId || null}
                    tracks={tagData.tracks}
                    taxonomy={tagData.taxonomy}
                    onConnectCommunity={() => (syncConnected ? openCloudSync()
                      : communityTeasers && teaserPreview ? connectFromTeaser("tab") : connectCommunity("library_check"))}
                    preview={communityTeasers ? teaserPreview ?? undefined : undefined}
                    previewLoading={communityTeasers && !teaserPreview && teaserPreviewLoading}
                    onAddMembersTags={addCommunityListTags}
                    onToggleTag={toggleMembersTag}
                    onLockSong={lockMembersSong}
                    activeUri={activeTrackUri}
                    onPlaySong={(uri) => void trackService.playTrack(uri)}
                    ratingOf={(uri) => tagData.tracks[uri]?.rating ?? 0}
                    sharingLocked={tagsNotShared}
                    onShareTags={() => openCommunitySharing("workspace")}
                  />
                ) : undefined}
                // Known not to share: opening "N others" asks them to share first.
                othersTagsLocked={othersTagsSharingGate && tagsNotShared}
                communityTeaser={teaserRows}
                onShareTags={() => openCommunitySharing("workspace")}
                communityTagSearch={communityTagSearchOn ? {
                  // Asked again whenever connecting or sharing changes what Community returns.
                  viewer: `${syncConnected ? getDesktopSyncConfiguration()?.accountId || "connected" : "signed-out"}:${tagsNotShared ? "not-sharing" : "sharing"}`,
                  onConnect: () => connectCommunity("teaser_tag_search"),
                  onShare: () => openCommunitySharing("workspace"),
                  onPlay: (uri) => void trackService.playTrack(uri),
                } : undefined}
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
                    playlistTrackInsights={playlistTrackInsights[activePlaylistUri]}
                    onRefreshTrackInsights={() => { void playlistMembershipStore.request(activePlaylistUri, "", true); }}
                    tracks={tagData.tracks}
                    taxonomy={tagData.taxonomy}
                    activeTagFilters={currentPlaylistFilterState.activeTagFilters}
                    excludedTagFilters={
                      currentPlaylistFilterState.excludedTagFilters
                    }
                    onSetRating={handleSetActivePlaylistRating}
                    onSetEnergy={handleSetActivePlaylistEnergy}
                    onAddTag={(tagId) => addTagPlaylist(activePlaylistUri, tagId, activePlaylistMetadata || {
                      name: activePlaylistData?.name || albumTrackSummaries.get(activePlaylistUri)?.albumName || (activePlaylistUri.startsWith("spotify:album:") ? "Unknown Album" : "Unknown Playlist"),
                      ownerName: activePlaylistData?.ownerName || albumTrackSummaries.get(activePlaylistUri)?.artistName || null,
                      imageUrl: activePlaylistData?.imageUrl || albumTrackSummaries.get(activePlaylistUri)?.imageUrl || null,
                      description: activePlaylistData?.description ?? null, trackCount: activePlaylistData?.trackCount ?? null, snapshotId: activePlaylistData?.snapshotId ?? null,
                    })}
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
                    getTagUses={getTagUses}
                    usageTarget={activePlaylistUri}
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
                playlistTrackInsights={playlistTrackInsights}
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
                    trackInsights={artistTrackInsights}
                    artistData={activeArtistData}
                    artistMetadata={activeArtistMetadata}
                    taxonomy={tagData.taxonomy}
                    activeTagFilters={artistFilterState.activeTagFilters}
                    excludedTagFilters={artistFilterState.excludedTagFilters}
                    onSetRating={handleSetActiveArtistRating}
                    onSetEnergy={handleSetActiveArtistEnergy}
                    onAddTag={(tagId) => addTagArtist(activeArtistUri, tagId, activeArtistMetadata || {
                      name: activeArtistData?.name || artistTrackInsights.summaries.get(activeArtistUri)?.artistName || "Unknown Artist",
                      imageUrl: activeArtistData?.imageUrl || null, followerCount: null, genres: [],
                    })}
                    onRemoveTag={handleRemoveActiveArtistTag}
                    onToggleTagIncludeOff={artistFilterState.toggleBasicTagFilter}
                    onOpenArtist={handleOpenArtist}
                    onRefreshMetadata={handleRefreshActiveArtistMetadata}
                  />
                  <TagSelector
                    categories={categoryTree}
                    customAccentsById={tagData.taxonomy.customAccentsById}
                    selectedTagIds={artistTags}
                    getTagUses={getTagUses}
                    usageTarget={activeArtistUri ?? undefined}
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
                trackInsights={artistTrackInsights}
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

      {statsMounted && !isLoading && (
        <StatsSheet open={showStats} onClose={closeStats}>
          {statsBaseline === undefined ? <StatsLoading /> : <StatsWorkspace
            tagData={tagData}
            baseline={statsBaseline}
            onShowTracks={showStatsTracks}
            onOpenTrack={(trackUri, set) => {
              showStatsTracks(set, "track");
              void handleSelectTrackForTagging(trackUri);
            }}
            onPlayTracks={(trackUris) => void trackService.playAllFilteredTracks(trackUris)}
            onClose={closeStats}
          />}
        </StatsSheet>
      )}
    </div>
  );
}

export default App;
