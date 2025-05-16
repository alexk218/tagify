import React, { useEffect, useState } from "react";
import styles from "./app.module.css";
import TrackDetails from "./components/TrackDetails";
import TagSelector from "./components/TagSelector";
import TrackList from "./components/TrackList";
import TagManager from "./components/TagManager";
import ExportPanel from "./components/ExportPanel";
import DataManager from "./components/DataManager";
import MissingTracksPanel from "./components/MissingTracksPanel";
import MultiTrackDetails from "./components/MultiTrackDetails";
import LocalTracksModal from "./components/LocalTracksModal";
import PythonActionsPanel from "./components/PythonActionsPanel";
import { useTagData } from "./hooks/useTagData";
import { useTrackState } from "./hooks/useTrackState";
import { useFilterState } from "./hooks/useFilterState";
import { usePlaylistState } from "./hooks/usePlaylistState";
import { useFontAwesome } from "./hooks/useFontAwesome";
import { checkAndUpdateCacheIfNeeded } from "./utils/PlaylistCache";
import { trackService } from "./services/trackService";
import { useSpicetifyHistory } from "./hooks/useSpicetifyHistory";
import { useCustomEvents } from "./hooks/useCustomEvents";

function App() {
  const {
    tagData,
    lastSaved,
    isLoading,
    toggleTrackTag,
    setRating,
    setEnergy,
    setBpm,
    toggleTagForMultipleTracks,
    addCategory,
    removeCategory,
    renameCategory,
    addSubcategory,
    removeSubcategory,
    renameSubcategory,
    addTag,
    removeTag,
    renameTag,
    exportData,
    exportBackup,
    importBackup,
    backfillBPMData,
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
  const [showExport, setShowExport] = useState(false);

  const [showMissingTracks, setShowMissingTracks] = useState(() => {
    return localStorage.getItem("tagify:activePanel") === "missingTracks";
  });
  const [showActions, setShowActions] = useState<boolean>(() => {
    return localStorage.getItem("tagify:showActions") === "true";
  });

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

  // Set up custom event listener for toggling missing tracks panel
  useCustomEvents({
    eventName: "tagify:toggleMissingTracks",
    handler: (event: Event) => {
      // Fixed type casting to handle the custom event
      const customEvent = event as CustomEvent<{ show: boolean }>;
      setShowMissingTracks(customEvent.detail.show);
    },
    dependencies: [],
  });

  useCustomEvents({
    eventName: "tagify:toggleActions",
    handler: (event: Event) => {
      // Fixed type casting to handle the custom event
      const customEvent = event as CustomEvent<{ show: boolean }>;
      setShowActions(customEvent.detail.show);
    },
    dependencies: [],
  });

  // Helper functions moved to custom hooks, leaving only render-related code here
  const playTrackViaQueue = trackService.playTrackViaQueue;
  const getLegacyFormatTracks = () => trackService.getLegacyFormatTracksFromTagData(tagData);

  // Render the appropriate UI based on state
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className={styles.loadingContainer}>
          <p className={styles.loadingText}>Loading tag data...</p>
        </div>
      );
    }

    if (showMissingTracks) {
      return <MissingTracksPanel />;
    }

    if (showActions) {
      return (
        <>
          <PythonActionsPanel />
        </>
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
                toggleTrackTag(activeTrack.uri, categoryId, subcategoryId, tagId)
              }
              onFilterByTagOnOff={onFilterByTagOnOff}
              onFilterByTag={onFilterByTag}
              onPlayTrack={playTrackViaQueue}
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

  // Helper function to render the tag selector conditionally
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

  // Handler for toggling tags
  const handleToggleTag = (categoryId: string, subcategoryId: string, tagId: string) => {
    if (isMultiTagging) {
      if (lockedMultiTrackUri) {
        toggleTagForSingleTrack(lockedMultiTrackUri, categoryId, subcategoryId, tagId);
      } else {
        handleTagAllTracks(categoryId, subcategoryId, tagId);
      }
    } else if (activeTrack) {
      toggleTrackTag(activeTrack.uri, categoryId, subcategoryId, tagId);
    }
  };

  // Handler for toggling a tag on a single track
  const toggleTagForSingleTrack = (
    trackUri: string,
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => {
    toggleTrackTag(trackUri, categoryId, subcategoryId, tagId);
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

          {activeTrack && (
            <div className={styles.trackLockControl}>
              <button
                className={`${styles.lockButton} ${isLocked ? styles.locked : styles.unlocked}`}
                onClick={toggleLock}
                title={isLocked ? "Unlock to follow currently playing track" : "Lock to this track"}
              >
                {isLocked ? "🔒" : "🔓"}
              </button>

              {isLocked && currentTrack && currentTrack.uri !== activeTrack.uri && (
                <button
                  className={styles.switchTrackButton}
                  onClick={() => {
                    setLockedTrack(currentTrack);
                  }}
                  title="Switch to currently playing track"
                >
                  <span className={styles.buttonIcon}></span> Switch to current
                </button>
              )}
            </div>
          )}
        </div>

        {isLocked && activeTrack && (
          <div className={styles.lockedTrackInfo}>
            Currently tagging: <span className={styles.lockedTrackName}>{activeTrack.name}</span> by{" "}
            <span className={styles.lockedTrackArtist}>
              {activeTrack.artists.map((a) => a.name).join(", ")}
            </span>
          </div>
        )}
      </div>

      <DataManager
        onExportBackup={exportBackup}
        onImportBackup={importBackup}
        onExportRekordbox={() => setShowExport(true)}
        lastSaved={lastSaved}
        taggedTracks={tagData.tracks}
        onBackfillBPM={backfillBPMData}
        showMissingTracks={showMissingTracks}
        showActions={showActions}
      />

      {renderContent()}

      {showTagManager && (
        <TagManager
          categories={tagData.categories}
          onClose={() => setShowTagManager(false)}
          onAddCategory={addCategory}
          onRemoveCategory={removeCategory}
          onRenameCategory={renameCategory}
          onAddSubcategory={addSubcategory}
          onRemoveSubcategory={removeSubcategory}
          onRenameSubcategory={renameSubcategory}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          onRenameTag={renameTag}
        />
      )}

      {showExport && <ExportPanel data={exportData()} onClose={() => setShowExport(false)} />}

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
