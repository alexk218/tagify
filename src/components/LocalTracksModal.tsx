import React, { useEffect, useState } from "react";
import styles from "./LocalTracksModal.module.css";
import { parseLocalFileUri } from "../utils/LocalFileParser";
import Portal from "../utils/Portal";

interface LocalTrack {
  uri: string;
  name: string;
  artist: string;
}

interface LocalTracksModalProps {
  localTracks: string[];
  playlistName: string;
  playlistId: string | null;
  onClose: () => void;
}

const LocalTracksModal: React.FC<LocalTracksModalProps> = ({
  localTracks,
  playlistName,
  playlistId,
  onClose,
}) => {
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    // Function to position the modal near the user's current view
    const positionModalInView = () => {
      const modalElement = document.querySelector(`.${styles.modal}`) as HTMLElement;
      if (!modalElement) return;

      // Get current scroll position
      const scrollY = window.scrollY || window.pageYOffset;
      const windowHeight = window.innerHeight;

      // Calculate ideal position - centered in the current viewport
      const idealTop = scrollY + windowHeight / 2 - modalElement.offsetHeight / 2;

      // Ensure the modal doesn't go offscreen
      const adjustedTop = Math.max(
        scrollY + 20, // At least 20px from the top of current view
        Math.min(
          idealTop,
          scrollY + windowHeight - modalElement.offsetHeight - 20 // At least 20px from bottom
        )
      );

      // Apply the position
      modalElement.style.marginTop = `${adjustedTop - scrollY}px`;
      modalElement.style.marginBottom = "20px";
    };

    // Position initially
    positionModalInView();

    // Update position on window resize
    window.addEventListener("resize", positionModalInView);

    // Clean up
    return () => {
      window.removeEventListener("resize", positionModalInView);
    };
  }, []);

  // Parse local track URIs to get display information
  const parsedLocalTracks: LocalTrack[] = localTracks.map((uri) => {
    const parsed = parseLocalFileUri(uri);
    return {
      uri,
      name: parsed.title,
      artist: parsed.artist,
    };
  });

  // Create a text representation of the local tracks for copying
  const localTracksList = parsedLocalTracks
    .map((track) => `${track.name}`)
    .join("\n");

  const copyToClipboard = () => {
    // Create a text area element
    const textArea = document.createElement("textarea");
    textArea.value = localTracksList;

    // Make the text area out of the viewport
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);

    // Select and copy
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand("copy");
      if (successful) {
        Spicetify.showNotification("Copied to clipboard!");
      } else {
        Spicetify.showNotification("Failed to copy", true);
      }
    } catch (err) {
      console.error("Error copying text: ", err);
      Spicetify.showNotification("Failed to copy", true);
    }

    // Clean up
    document.body.removeChild(textArea);
  };

  const navigateToLocalFiles = () => {
    Spicetify.Platform.History.push("/collection/local-files");
  };

  const navigateToPlaylist = () => {
    if (playlistId) {
      Spicetify.Platform.History.push(`/playlist/${playlistId}`);
      onClose();
    }
  };

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Add Local Tracks</h2>
            <button className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>

          <div className={styles.modalBody}>
            <div className={styles.messageSection}>
              <p className={styles.message}>
                Your playlist "<strong>{playlistName}</strong>" has been created with Spotify
                tracks. However, {localTracks.length} local tracks couldn't be added automatically.
              </p>
            </div>

            <div className={styles.tracksSection}>
              <h3 className={styles.sectionTitle}>
                Local Tracks to Add ({localTracks.length})
                <button
                  className={styles.copyButton}
                  onClick={copyToClipboard}
                  title="Copy list to clipboard"
                >
                  Copy List
                </button>
              </h3>

              <div className={styles.tracksList}>
                {parsedLocalTracks.map((track, index) => (
                  <div key={index} className={styles.trackItem}>
                    <span className={styles.trackName}>{track.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.actionButtons}>
              <button className={styles.actionButton} onClick={navigateToLocalFiles}>
                Go to Local Files
              </button>

              {playlistId && (
                <button className={styles.actionButton} onClick={navigateToPlaylist}>
                  Go to Playlist
                </button>
              )}

              <button className={styles.closeAction} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default LocalTracksModal;
