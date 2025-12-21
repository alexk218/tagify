import React, { useEffect, useMemo, useState } from "react";
import styles from "./app.module.css";
import "./styles/globals.css";
import packageJson from "@/package";
import { useTagData } from "./hooks/data/useTagData";
import { useTrackState } from "./hooks/data/useTrackState";
import { useFilterState } from "./hooks/data/useFilterState";
import { usePlaylistState } from "./hooks/data/usePlaylistState";
import { useFontAwesome } from "./hooks/shared/useFontAwesome";
import { trackService } from "./services/TrackService";
import { useSpicetifyHistory } from "./hooks/data/useSpicetifyHistory";
import { useUpdateChecker } from "./hooks/data/useUpdateChecker";
import { useMultiTrackTagging } from "./hooks/data/useMultiTrackTagging";
import { useSmartPlaylists } from "./hooks/data/useSmartPlaylists";
import { useDiscoverySurvey } from "./hooks/data/useDiscoverySurvey";
import { useGlobalKeyboardShortcuts } from "./hooks/shared/useGlobalKeyboardShortcuts";
import {
  TrackDetails,
  TrackList,
  MultiTrackDetails,
  TagSelector,
  TagManager,
  DataManager,
  UpdateBanner,
  LocalTracksModal,
  ExportModal,
  DiscoverySurveyModal,
} from "@/components";

function App() {
  const [showTagManager, setShowTagManager] = useState<boolean>(false);
  const [showExport, setShowExport] = useState<boolean>(false);

  const {
    tagData,
    isLoading,
    lastSaved,
    loadTagData,
    toggleTagSingleTrack,
    setRating,
    setEnergy,
    setBpm,
    updateBpm,
    applyBatchTagUpdates,
    findTagName,
    replaceCategories,
    exportData,
    exportTagData,
    importTagData,
  } = useTagData();

  const {
    syncSmartPlaylistFull,
    createSmartPlaylist,
    cleanupDeletedSmartPlaylists,
    smartPlaylists,
    setSmartPlaylists,
    exportSmartPlaylists,
    importSmartPlaylists,
  } = useSmartPlaylists({ tagData });

  const {
    activeTagFilters,
    excludedTagFilters,
    removeTagFilter,
    toggleTagIncludeExclude,
    toggleTagIncludeExcludeOff,
    toggleTagIncludeOff,
    clearTagFilters,
    createTagId,
    parseTagId,
    getTagDisplayName,
  } = useFilterState();

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
  } = useMultiTrackTagging();

  // Set up history tracking and URL param handling
  useSpicetifyHistory({
    isMultiTagging,
    setIsMultiTagging,
    setMultiTagTracks,
    setLockedTrack,
    setIsLocked,
    setLockedMultiTrackUri,
  });

  const { updateInfo, dismissUpdate } = useUpdateChecker({
    currentVersion: packageJson.version,
    repoOwner: "alexk218",
    repoName: "tagify",
    checkOnMount: true,
    delayMs: 2000,
  });

  const { shouldShowSurvey, completeSurvey, skipSurvey, skipCount } =
    useDiscoverySurvey(packageJson.version);

  useFontAwesome();

  // causes state changes when applying ratings via shortcuts
  useGlobalKeyboardShortcuts({
    onExternalDataChange: loadTagData,
  });

  const playTrack = trackService.playTrack;
  const getTracksWithResolvedTags = () =>
    trackService.getTracksWithResolvedTags(tagData);

  useEffect(() => {
    localStorage.setItem("tagify:appMounted", "true");

    return () => {
      localStorage.removeItem("tagify:appMounted");
    };
  }, []);

  // Hide topbar when app mounts - restore when app unmounts
  useEffect(() => {
    const topbar = document.querySelector(
      ".main-topBar-container"
    ) as HTMLElement;
    if (topbar) {
      topbar.style.visibility = "hidden";
    }

    return () => {
      const topbar = document.querySelector(
        ".main-topBar-container"
      ) as HTMLElement;
      if (topbar) {
        topbar.style.visibility = "";
      }
    };
  }, []);

  const trackTags = isMultiTagging
    ? selectedTagsForSelector || []
    : tagData.tracks[activeTrack?.uri || ""]?.tags || [];

  const handleToggleTag = (
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => {
    if (isMultiTagging) {
      toggleTagMultiTrackDraft(categoryId, subcategoryId, tagId);
    } else if (activeTrack) {
      toggleTagSingleTrack(activeTrack.uri, categoryId, subcategoryId, tagId);
    }
  };

  const trackDataMap = useMemo(() => {
    return Object.fromEntries(
      multiTagTracks.map((track) => [
        track.uri,
        {
          tags: tagData.tracks[track.uri]?.tags || [],
          rating: tagData.tracks[track.uri]?.rating || 0,
          energy: tagData.tracks[track.uri]?.energy || 0,
        },
      ])
    );
  }, [multiTagTracks, tagData.tracks]);

  useEffect(() => {
    // This creates a global reference for debugging in browser console
    (window as any).__TAGIFY_DEBUG__ = {
      multiTrackDraftTags,
      isMultiTagging,
      lockedMultiTrackUri,
      multiTagTracks,
      tagData,
      smartPlaylists,
      activeTagFilters,
      excludedTagFilters,
      currentlyPlayingTrack,
      activeTrack,
      selectedTagsForSelector,
      trackDataMap,
    };
  }, [
    multiTrackDraftTags,
    isMultiTagging,
    lockedMultiTrackUri,
    multiTagTracks,
    tagData,
    smartPlaylists,
    activeTagFilters,
    excludedTagFilters,
    currentlyPlayingTrack,
    activeTrack,
    selectedTagsForSelector,
    trackDataMap,
  ]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>Tagify</h1>
        </div>
      </div>

      {updateInfo?.hasUpdate && (
        <UpdateBanner updateInfo={updateInfo} onDismiss={dismissUpdate} />
      )}

      {shouldShowSurvey && (
        <DiscoverySurveyModal
          onCompleteSurvey={completeSurvey}
          onSkipSurvey={skipSurvey}
        />
      )}

      <DataManager
        onExportTagData={exportTagData}
        onImportTagData={importTagData}
        onExportRekordbox={() => setShowExport(true)}
        lastSaved={lastSaved}
      />

      {isLoading ? (
        <div className={styles.loadingContainer}>
          <p className={styles.loadingText}>Loading tag data...</p>
        </div>
      ) : (
        <div className={styles.content}>
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
            activeTrack && (
              <TrackDetails
                displayedTrack={activeTrack}
                currentlyPlayingTrack={currentlyPlayingTrack}
                trackData={
                  tagData.tracks[activeTrack.uri] || {
                    rating: 0,
                    energy: 0,
                    bpm: null,
                    tags: [],
                  }
                }
                categories={tagData.categories}
                activeTagFilters={activeTagFilters}
                excludedTagFilters={excludedTagFilters}
                onSetRating={(rating) => setRating(activeTrack.uri, rating)}
                onSetEnergy={(energy) => setEnergy(activeTrack.uri, energy)}
                onSetBpm={(bpm) => setBpm(activeTrack.uri, bpm)}
                onRemoveTag={(categoryId, subcategoryId, tagId) =>
                  toggleTagSingleTrack(
                    activeTrack.uri,
                    categoryId,
                    subcategoryId,
                    tagId
                  )
                }
                onToggleTagIncludeOff={toggleTagIncludeOff}
                onPlayTrack={playTrack}
                isLocked={isLocked}
                onToggleLock={toggleLock}
                onSwitchToCurrentTrack={setLockedTrack}
                onUpdateBpm={updateBpm}
                createTagId={createTagId}
              />
            )
          )}

          {(activeTrack || (isMultiTagging && multiTagTracks.length > 0)) && (
            <TagSelector
              categories={tagData.categories}
              trackTags={trackTags}
              onToggleTag={handleToggleTag}
              onOpenTagManager={() => setShowTagManager(true)}
              isMultiTagging={isMultiTagging}
              isLockedTrack={!!lockedMultiTrackUri}
            />
          )}
          <TrackList
            tracks={getTracksWithResolvedTags()}
            categories={tagData.categories}
            activeTagFilters={activeTagFilters}
            excludedTagFilters={excludedTagFilters}
            activeTrackUri={activeTrack?.uri || null}
            onRemoveTagFilter={removeTagFilter}
            onToggleTagIncludeExclude={toggleTagIncludeExclude}
            onToggleTagIncludeExcludeOff={toggleTagIncludeExcludeOff} // ON OFF EXCLUDE
            onToggleTagIncludeOff={toggleTagIncludeOff} // ON OFF
            onClearTagFilters={clearTagFilters}
            onPlayTrack={playTrack}
            onTagTrack={handleSelectTrackForTagging}
            onCreatePlaylist={createPlaylistFromFilters}
            onCreateSmartPlaylist={createSmartPlaylist}
            parseTagId={parseTagId}
            smartPlaylists={smartPlaylists}
            onSetSmartPlaylists={setSmartPlaylists}
            onSyncPlaylist={syncSmartPlaylistFull}
            onCleanupDeletedSmartPlaylists={cleanupDeletedSmartPlaylists}
            onExportSmartPlaylists={exportSmartPlaylists}
            onImportSmartPlaylists={importSmartPlaylists}
          />
        </div>
      )}
      {showTagManager && (
        <TagManager
          categories={tagData.categories}
          onClose={() => setShowTagManager(false)}
          onReplaceCategories={replaceCategories}
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
    </div>
  );
}

export default App;
