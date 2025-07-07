import React, { useEffect, useState } from "react";
import styles from "./app.module.css";
import "./styles/globals.css";
import TrackDetails from "./components/TrackDetails";
import TagSelector from "./components/TagSelector";
import TrackList from "./components/TrackList";
import TagManager from "./components/TagManager";
import DataManager from "./components/DataManager";
import MultiTrackDetails from "./components/MultiTrackDetails";
import LocalTracksModal from "./components/LocalTracksModal";
import { useTagData } from "./hooks/useTagData";
import { useTrackState } from "./hooks/useTrackState";
import { useFilterState } from "./hooks/useFilterState";
import { usePlaylistState } from "./hooks/usePlaylistState";
import { useFontAwesome } from "./hooks/useFontAwesome";
import { checkAndUpdateCacheIfNeeded } from "./utils/PlaylistCache";
import { trackService } from "./services/TrackService";
import { useSpicetifyHistory } from "./hooks/useSpicetifyHistory";

function App() {
  const {
    tagData,
    lastSaved,
    isLoading,
    toggleTagForTrack,
    setRating,
    setEnergy,
    setBpm,
    toggleTagForMultipleTracks,
    replaceCategories,
    exportBackup,
    importBackup,
    findCommonTags,
  } = useTagData();

  const {
    currentTrack,
    setLockedTrack,
    isLocked,
    setIsLocked,
    selectedTracks,
    setSelectedTracks,
    isMultiTagging,
    setIsMultiTagging,
    lockedMultiTrackUri,
    setLockedMultiTrackUri,
    toggleLock,
    handleTagTrack,
    cancelMultiTagging,
    activeTrack,
  } = useTrackState();

  const {
    activeTagFilters,
    excludedTagFilters,
    handleRemoveFilter,
    handleToggleFilterType,
    onFilterByTag,
    onFilterByTagOnOff,
    clearTagFilters,
  } = useFilterState();

  const {
    showLocalTracksModal,
    setShowLocalTracksModal,
    localTracksForPlaylist,
    createdPlaylistInfo,
    createPlaylistFromFilters,
  } = usePlaylistState();

  const [showTagManager, setShowTagManager] = useState(false);

  useFontAwesome();

  // Check playlist cache on mount
  useEffect(() => {
    checkAndUpdateCacheIfNeeded().catch((error) => {
      console.error("Error checking/updating playlist cache:", error);
    });
  }, []);

  // Set up history tracking and URL param handling
  useSpicetifyHistory({
    isMultiTagging,
    setSelectedTracks,
    setIsMultiTagging,
    setLockedTrack,
    setIsLocked,
    setLockedMultiTrackUri,
    currentTrack,
  });

  const playTrackViaQueue = trackService.playTrackViaQueue;
  const getLegacyFormatTracks = () => trackService.getLegacyFormatTracksFromTagData(tagData);

  // Render appropriate UI based on state
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className={styles.loadingContainer}>
          <p className={styles.loadingText}>Loading tag data...</p>
        </div>
      );
    }

    return (
      <div className={styles.content}>
        {isMultiTagging && selectedTracks.length > 0 ? (
          <MultiTrackDetails
            tracks={selectedTracks}
            trackTagsMap={Object.fromEntries(
              selectedTracks.map((track) => [track.uri, tagData.tracks[track.uri]?.tags || []])
            )}
            categories={tagData.categories}
            onTagAllTracks={handleTagAllTracks} // Fixed function name
            onTagSingleTrack={toggleTagForSingleTrack}
            onCancelTagging={cancelMultiTagging}
            onPlayTrack={playTrackViaQueue}
            lockedTrackUri={lockedMultiTrackUri}
            onLockTrack={setLockedMultiTrackUri}
          />
        ) : (
          activeTrack && (
            <TrackDetails
              track={activeTrack}
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
                toggleTagForTrack(activeTrack.uri, categoryId, subcategoryId, tagId)
              }
              onFilterByTagOnOff={onFilterByTagOnOff}
              onFilterByTag={onFilterByTag}
              onPlayTrack={playTrackViaQueue}
              isLocked={isLocked}
              onToggleLock={toggleLock}
              currentTrack={currentTrack}
              onSwitchToCurrentTrack={setLockedTrack}
            />
          )
        )}

        {renderTagSelector()}

        <TrackList
          tracks={getLegacyFormatTracks()}
          categories={tagData.categories}
          activeTagFilters={activeTagFilters}
          excludedTagFilters={excludedTagFilters}
          activeTrackUri={activeTrack?.uri || null}
          onFilterByTag={onFilterByTag}
          onRemoveFilter={handleRemoveFilter}
          onToggleFilterType={handleToggleFilterType}
          onTrackListTagClick={onFilterByTagOnOff}
          onClearTagFilters={clearTagFilters}
          onPlayTrack={playTrackViaQueue}
          onTagTrack={handleTagTrack}
          onCreatePlaylist={createPlaylistFromFilters}
        />
      </div>
    );
  };

  // Render the tag selector conditionally
  const renderTagSelector = () => {
    if (!activeTrack && !(isMultiTagging && selectedTracks.length > 0)) {
      return null;
    }

    return (
      <TagSelector
        track={
          isMultiTagging && lockedMultiTrackUri
            ? selectedTracks.find((t) => t.uri === lockedMultiTrackUri) || selectedTracks[0]
            : activeTrack || selectedTracks[0]
        }
        categories={tagData.categories}
        trackTags={
          isMultiTagging
            ? lockedMultiTrackUri
              ? tagData.tracks[lockedMultiTrackUri]?.tags || []
              : findCommonTags(selectedTracks.map((track) => track.uri))
            : tagData.tracks[activeTrack?.uri || ""]?.tags || []
        }
        onToggleTag={handleToggleTag}
        onOpenTagManager={() => setShowTagManager(true)}
        isMultiTagging={isMultiTagging}
        isLockedTrack={!!lockedMultiTrackUri}
      />
    );
  };

  const handleToggleTag = (categoryId: string, subcategoryId: string, tagId: string) => {
    if (isMultiTagging) {
      if (lockedMultiTrackUri) {
        toggleTagForSingleTrack(lockedMultiTrackUri, categoryId, subcategoryId, tagId);
      } else {
        handleTagAllTracks(categoryId, subcategoryId, tagId);
      }
    } else if (activeTrack) {
      toggleTagForTrack(activeTrack.uri, categoryId, subcategoryId, tagId);
    }
  };

  // Handler for toggling a tag on a single track
  const toggleTagForSingleTrack = (
    trackUri: string,
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => {
    toggleTagForTrack(trackUri, categoryId, subcategoryId, tagId);
  };

  // Handler for toggling a tag on all tracks
  const handleTagAllTracks = (categoryId: string, subcategoryId: string, tagId: string) => {
    // Use the batch update function to apply to all selected tracks
    toggleTagForMultipleTracks(
      selectedTracks.map((track) => track.uri),
      categoryId,
      subcategoryId,
      tagId
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>Tagify</h1>
        </div>
      </div>

      <DataManager
        onExportBackup={exportBackup}
        onImportBackup={importBackup}
        lastSaved={lastSaved}
        taggedTracks={tagData.tracks}
      />

      {renderContent()}

      {showTagManager && (
        <TagManager
          categories={tagData.categories}
          onClose={() => setShowTagManager(false)}
          onReplaceCategories={replaceCategories}
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
    </div>
  );
}

export default App;
