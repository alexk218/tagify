import React, { useEffect, useState } from "react";
import styles from "./MissingTracksPanel.module.css";
import { useCustomEvents } from "../hooks/useCustomEvents";
import { useMissingTracks } from "../hooks/useMissingTracks";

const MissingTracksPanel: React.FC = () => {
  const {
    isLoading,
    error,
    masterTracks,
    localTracks,
    missingTracks,
    loadData,
    createPlaylist,
    cachedData,
  } = useMissingTracks();

  const [downloadingTracks, setDownloadingTracks] = useState<Set<string>>(new Set());
  const [downloadResults, setDownloadResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    current: number;
    total: number;
    currentTrackId?: string;
    currentTrackName?: string;
  }>({ current: 0, total: 0 });

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

  const downloadTrack = async (trackId: string) => {
    try {
      setDownloadingTracks((prev) => new Set([...prev, trackId]));

      // Set individual progress
      setDownloadProgress({ current: 1, total: 1, currentTrackId: trackId });

      const response = await fetch(
        `${
          localStorage.getItem("tagify:localServerUrl") || "http://localhost:8765"
        }/api/tracks/download`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            track_id: trackId,
            download_dir: localStorage.getItem("tagify:masterTracksDir") || "",
          }),
        }
      );

      const result = await response.json();

      setDownloadResults((prev) => ({
        ...prev,
        [trackId]: {
          success: result.success,
          message: result.message || (result.success ? "Download completed" : "Download failed"),
        },
      }));

      if (result.success) {
        Spicetify.showNotification(`Successfully downloaded: ${result.track_info}`);
        loadData();
      } else {
        Spicetify.showNotification(`Download failed: ${result.message}`, true);
      }
    } catch (error) {
      console.error("Error downloading track:", error);
      setDownloadResults((prev) => ({
        ...prev,
        [trackId]: {
          success: false,
          message: `Error: ${error}`,
        },
      }));
      Spicetify.showNotification("Download failed", true);
    } finally {
      setDownloadingTracks((prev) => {
        const newSet = new Set(prev);
        newSet.delete(trackId);
        return newSet;
      });
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  const downloadAllTracks = async () => {
    if (missingTracks.length === 0) return;

    try {
      setBatchDownloading(true);
      setDownloadProgress({ current: 0, total: missingTracks.length });

      const trackIds = missingTracks.map((track) => track.id);

      const response = await fetch(
        `${
          localStorage.getItem("tagify:localServerUrl") || "http://localhost:8765"
        }/api/tracks/download-batch`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            track_ids: trackIds,
            download_dir: localStorage.getItem("tagify:masterTracksDir") || "",
          }),
        }
      );

      const result = await response.json();

      if (result.success) {
        Spicetify.showNotification(
          `Batch download completed: ${result.success_count} successful, ${result.failure_count} failed`
        );

        // Update individual results
        const newResults: Record<string, { success: boolean; message: string }> = {};

        result.successful_downloads.forEach((download: any) => {
          newResults[download.track_id] = {
            success: true,
            message: "Download completed",
          };
        });

        result.failed_downloads.forEach((download: any) => {
          newResults[download.track_id] = {
            success: false,
            message: download.error,
          };
        });

        setDownloadResults((prev) => ({ ...prev, ...newResults }));
        loadData(); // Refresh the list
      } else {
        Spicetify.showNotification(`Batch download failed: ${result.message}`, true);
      }
    } catch (error) {
      console.error("Error in batch download:", error);
      Spicetify.showNotification("Batch download failed", true);
    } finally {
      setBatchDownloading(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Missing Tracks</h2>
        <div>
          <button className={styles.refreshButton} onClick={() => loadData()} disabled={isLoading}>
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>

          <button
            className={styles.playlistButton}
            onClick={createPlaylist}
            disabled={missingTracks.length === 0}
          >
            Create Playlist
          </button>

          <button
            className={styles.downloadAllButton}
            onClick={downloadAllTracks}
            disabled={missingTracks.length === 0 || batchDownloading}
          >
            {batchDownloading ? "Downloading All..." : "Download All"}
          </button>
        </div>
      </div>

      {(batchDownloading || downloadProgress.total > 0) && (
        <div className={styles.progressContainer}>
          <div className={styles.progressHeader}>
            <span className={styles.progressText}>
              {batchDownloading
                ? `Downloading tracks: ${downloadProgress.current} of ${downloadProgress.total}`
                : `Download progress: ${downloadProgress.current} of ${downloadProgress.total}`}
            </span>
            {downloadProgress.currentTrackName && (
              <span className={styles.currentTrack}>
                Current: {downloadProgress.currentTrackName}
              </span>
            )}
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{
                width: `${
                  downloadProgress.total > 0
                    ? (downloadProgress.current / downloadProgress.total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {cachedData && (
        <div className={styles.cacheInfo}>
          <span className={styles.cacheDate}>
            Last updated: {formatDate(cachedData.lastUpdated)}
          </span>
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
                      Play
                    </button>
                    <button
                      className={styles.downloadButton}
                      onClick={() => downloadTrack(track.id)}
                      disabled={downloadingTracks.has(track.id)}
                      title="Download track using spotDL"
                    >
                      {downloadingTracks.has(track.id) ? "Downloading..." : "Download"}
                    </button>
                    {downloadResults[track.id] && (
                      <span
                        className={`${styles.downloadResult} ${
                          downloadResults[track.id].success ? styles.success : styles.error
                        }`}
                      >
                        {downloadResults[track.id].success ? "✓" : "✗"}
                      </span>
                    )}
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
