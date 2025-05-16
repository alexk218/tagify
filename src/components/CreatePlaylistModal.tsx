import React, { useEffect, useState } from "react";
import styles from "./CreatePlaylistModal.module.css";
import Portal from "../utils/Portal";

interface CreatePlaylistModalProps {
  trackCount: number;
  localTrackCount: number;
  tags: string[];
  onClose: () => void;
  onCreatePlaylist: (name: string, description: string, isPublic: boolean) => void;
}

const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  trackCount,
  localTrackCount,
  tags,
  onClose,
  onCreatePlaylist,
}) => {
  // Generate a default name based on tags
  const defaultName =
    tags.length > 0
      ? `Tagify - ${tags.join(", ")}`
      : `Tagify Playlist ${new Date().toLocaleDateString()}`;

  // Generate a default description
  const defaultDescription =
    tags.length > 0
      ? `Created with Tagify | Tags: ${tags.join(", ")}`
      : "Created with Tagify";

  const [playlistName, setPlaylistName] = useState(defaultName);
  const [playlistDescription, setPlaylistDescription] = useState(defaultDescription);
  const [isPublic, setIsPublic] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreatePlaylist(
      playlistName.trim() || defaultName,
      playlistDescription.trim() || defaultDescription,
      isPublic
    );
  };

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

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Create Playlist</h2>
            <button className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>

          <div className={styles.modalBody}>
            <div className={styles.trackStats}>
              <p>
                Creating playlist with <strong>{trackCount}</strong> tracks
                {localTrackCount > 0 && (
                  <span className={styles.warning}>
                    {" "}
                    (Note: {localTrackCount} local tracks cannot be added automatically)
                  </span>
                )}
              </p>
            </div>

            <form onSubmit={handleSubmit} className={styles.playlistForm}>
              <div className={styles.formField}>
                <label htmlFor="playlist-name" className={styles.label}>
                  Playlist Name
                </label>
                <input
                  id="playlist-name"
                  type="text"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  className={styles.input}
                  placeholder="Enter playlist name"
                  maxLength={100}
                />
              </div>

              <div className={styles.formField}>
                <label htmlFor="playlist-description" className={styles.label}>
                  Description
                </label>
                <textarea
                  id="playlist-description"
                  value={playlistDescription}
                  onChange={(e) => setPlaylistDescription(e.target.value)}
                  className={styles.textarea}
                  placeholder="Enter playlist description"
                  maxLength={300}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className={styles.checkbox}
                  />
                  Make playlist public
                </label>
              </div>

              {tags.length > 0 && (
                <div className={styles.tagsSection}>
                  <label className={styles.label}>Tags included:</label>
                  <div className={styles.tags}>
                    {tags.map((tag) => (
                      <span key={tag} className={styles.tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.formActions}>
                <button type="button" className={styles.cancelButton} onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className={styles.createButton}>
                  Create Playlist
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default CreatePlaylistModal;
