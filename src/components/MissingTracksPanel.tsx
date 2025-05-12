import React, { useEffect } from "react";
import styles from "./MissingTracksPanel.module.css";
import { useCustomEvents } from "../hooks/useCustomEvents";
import { useMissingTracks } from "../hooks/useMissingTracks";

const MissingTracksPanel: React.FC = () => {
  const {
    isLoading,
    error,
    serverUrl,
    setServerUrl,
    serverConnected,
    showConfigInput,
    setShowConfigInput,
    masterTracks,
    localTracks,
    missingTracks,
    loadData,
    connectToServer,
    setMasterPlaylistId,
    createPlaylist,
    cachedData,
  } = useMissingTracks();

  // Use custom event hook to listen for toggle events
  useCustomEvents({
    eventName: "tagify:toggleMissingTracks",
    handler: () => {
      // Just using this to ensure the component gets mounted/unmounted correctly
      console.log("Toggle event received in MissingTracksPanel");
    },
    dependencies: [],
  });

  // Update localStorage flag when component mounts
  useEffect(() => {
    // Save that MissingTracksPanel is active
    localStorage.setItem("tagify:activePanel", "missingTracks");

    // Clean up function
    return () => {
      // We don't clear this when unmounting, allowing it to persist
    };
  }, []);

  // Play a track
  const playTrack = async (trackId: string) => {
    try {
      const uri = `spotify:track:${trackId}`;
      await Spicetify.Player.playUri(uri);
      Spicetify.showNotification(`Playing track`);
    } catch (error) {
      console.error("Error playing track:", error);
      Spicetify.showNotification("Failed to play track", true);
    }
  };

  // Open local server settings
  const openServerSettings = () => {
    setShowConfigInput(true);
  };

  // Format a date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);

    // If the date is today, show time only
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return `Today at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }

    // If the date is yesterday, show "Yesterday"
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }

    // Otherwise show full date
    return date.toLocaleString();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Missing Tracks</h2>
        <div className={styles.headerButtons}>
          <button className={styles.refreshButton} onClick={() => loadData()} disabled={isLoading}>
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>

          <button className={styles.settingsButton} onClick={openServerSettings}>
            Server Settings
          </button>

          <button className={styles.settingsButton} onClick={setMasterPlaylistId}>
            Set MASTER Playlist
          </button>

          <button
            className={styles.playlistButton}
            onClick={createPlaylist}
            disabled={missingTracks.length === 0}
          >
            Create Playlist
          </button>
        </div>
      </div>

      {cachedData && (
        <div className={styles.cacheInfo}>
          <span className={styles.cacheDate}>
            Last updated: {formatDate(cachedData.lastUpdated)}
          </span>
        </div>
      )}

      {showConfigInput && (
        <div className={styles.configSection}>
          <h3>Local Tracks Server Configuration</h3>
          <div className={styles.configForm}>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="Server URL (e.g., http://localhost:8765)"
              className={styles.urlInput}
            />
            <button onClick={connectToServer} disabled={isLoading} className={styles.connectButton}>
              {isLoading ? "Connecting..." : "Connect"}
            </button>
          </div>
          <p className={styles.configHelp}>
            Make sure the local tracks server is running. See the readme for instructions.
          </p>
          {serverConnected && <p className={styles.serverConnected}>✅ Connected to server</p>}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {isLoading && !missingTracks.length ? (
        <div className={styles.loading}>Loading...</div>
      ) : (
        <>
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>MASTER Playlist:</span>
              <span className={styles.statValue}>{masterTracks.length} tracks</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Local Files:</span>
              <span className={styles.statValue}>{localTracks.size} tracks</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Missing Tracks:</span>
              <span className={styles.statValue}>{missingTracks.length} tracks</span>
              {isLoading && <span className={styles.refreshing}>(refreshing in background)</span>}
            </div>
          </div>

          {missingTracks.length > 0 ? (
            <div className={styles.tracksList}>
              {missingTracks.map((track) => (
                <div key={track.id} className={styles.trackItem}>
                  <div className={styles.trackInfo}>
                    <div className={styles.trackName}>{track.name}</div>
                    <div className={styles.trackArtist}>{track.artists}</div>
                    {track.added_at && (
                      <div className={styles.trackDate}>
                        Added: {new Date(track.added_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div className={styles.trackActions}>
                    <button
                      className={styles.playButton}
                      onClick={() => playTrack(track.id)}
                      title="Play track"
                    >
                      {"Play"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.noMissingTracks}>
              {masterTracks.length > 0 && localTracks.size > 0
                ? "No missing tracks found! Your local collection is complete."
                : "Please make sure both MASTER playlist and local tracks cache are loaded."}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MissingTracksPanel;
