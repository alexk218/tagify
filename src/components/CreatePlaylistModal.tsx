import React, { useEffect, useState } from "react";
import styles from "./CreatePlaylistModal.module.css";
import Portal from "../utils/Portal";

interface CreatePlaylistModalProps {
  trackCount: number;
  localTrackCount: number;
  tagsFilter: string[];
  energyMinFilter: number | null;
  energyMaxFilter: number | null;
  ratingFilter: number[];
  bpmMinFilter: number | null;
  bpmMaxFilter: number | null;
  onClose: () => void;
  onCreatePlaylist: (name: string, description: string, isPublic: boolean) => void;
}

const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  trackCount,
  localTrackCount,
  tagsFilter,
  energyMinFilter,
  energyMaxFilter,
  ratingFilter,
  bpmMinFilter,
  bpmMaxFilter,
  onClose,
  onCreatePlaylist,
}) => {
  const defaultPlaylistName = (() => {
    const filterParts = [];

    if (tagsFilter.length > 0) {
      filterParts.push(tagsFilter.slice(0, 2).join(", ")); // Limit to first 2 tags for brevity
    }

    if (ratingFilter.length > 0) {
      filterParts.push(`${ratingFilter.sort((a, b) => a - b).join(",")}★`);
    }

    if (energyMinFilter !== null || energyMaxFilter !== null) {
      if (energyMinFilter !== null && energyMaxFilter !== null) {
        if (energyMinFilter === energyMaxFilter) {
          filterParts.push(`E${energyMinFilter}`);
        } else {
          filterParts.push(`E${energyMinFilter}-${energyMaxFilter}`);
        }
      } else if (energyMinFilter !== null) {
        filterParts.push(`E≥${energyMinFilter}`);
      } else {
        filterParts.push(`E≤${energyMaxFilter}`);
      }
    }

    if (bpmMinFilter !== null || bpmMaxFilter !== null) {
      if (bpmMinFilter !== null && bpmMaxFilter !== null) {
        filterParts.push(`${bpmMinFilter}-${bpmMaxFilter}BPM`);
      } else if (bpmMinFilter !== null) {
        filterParts.push(`≥${bpmMinFilter}BPM`);
      } else {
        filterParts.push(`≤${bpmMaxFilter}BPM`);
      }
    }

    let name =
      filterParts.length > 0
        ? `Tagify - ${filterParts.join(" ")}`
        : `Tagify Playlist ${new Date().toLocaleDateString()}`;

    // Truncate if too long
    if (name.length > 100) {
      name = name.substring(0, 97) + "...";
    }

    return name;
  })();

  const defaultPlaylistDescription = (() => {
    const filterParts = [];

    if (tagsFilter.length > 0) {
      filterParts.push(`Tags: ${tagsFilter.join(", ")}`);
    }

    if (ratingFilter.length > 0) {
      filterParts.push(`Rating: ${ratingFilter.sort((a, b) => a - b).join(", ")} ★`);
    }

    if (energyMinFilter !== null || energyMaxFilter !== null) {
      if (energyMinFilter !== null && energyMaxFilter !== null) {
        if (energyMinFilter === energyMaxFilter) {
          filterParts.push(`Energy: ${energyMinFilter}`);
        } else {
          filterParts.push(`Energy: ${energyMinFilter} - ${energyMaxFilter}`);
        }
      } else if (energyMinFilter !== null) {
        filterParts.push(`Energy: ≥${energyMinFilter}`);
      } else {
        filterParts.push(`Energy: ≤${energyMaxFilter}`);
      }
    }

    let description =
      filterParts.length > 0
        ? `Created with Tagify | ${filterParts.join(" | ")}`
        : "Created with Tagify";

    // Truncate if too long
    if (description.length > 300) {
      description = description.substring(0, 297) + "...";
    }

    return description;
  })();

  const [playlistName, setPlaylistName] = useState(defaultPlaylistName);
  const [playlistDescription, setPlaylistDescription] = useState(defaultPlaylistDescription);
  const [isPublic, setIsPublic] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreatePlaylist(
      playlistName.trim() || defaultPlaylistName,
      playlistDescription.trim() || defaultPlaylistDescription,
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
              </p>
              {localTrackCount > 0 && (
                <p className={styles.warning}>
                  Note: {localTrackCount} local tracks cannot be added automatically
                </p>
              )}
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
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="form-checkbox"
                  />
                  Make playlist public
                </label>
              </div>

              {(tagsFilter.length > 0 ||
                ratingFilter.length > 0 ||
                energyMinFilter !== null ||
                energyMaxFilter !== null ||
                bpmMinFilter !== null ||
                bpmMaxFilter !== null) && (
                <div className={styles.filtersContainer}>
                  {/* Tags on their own row if they exist */}
                  {tagsFilter.length > 0 && (
                    <div className={styles.filterRow}>
                      <span className={styles.filterLabel}>Tags:</span>
                      <div className={styles.tags}>
                        {tagsFilter.map((tag) => (
                          <span key={tag} className={styles.tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Rating, Energy, and BPM on separate rows */}
                  {(ratingFilter.length > 0 ||
                    energyMinFilter !== null ||
                    energyMaxFilter !== null ||
                    bpmMinFilter !== null ||
                    bpmMaxFilter !== null) && (
                    <div className={styles.compactFilterRow}>
                      {ratingFilter.length > 0 && (
                        <span className={styles.compactFilter}>
                          <strong>Rating:</strong> {ratingFilter.sort((a, b) => a - b).join(", ")} ★
                        </span>
                      )}
                      {(energyMinFilter !== null || energyMaxFilter !== null) && (
                        <span className={styles.compactFilter}>
                          <strong>Energy:</strong>{" "}
                          {energyMinFilter !== null && energyMaxFilter !== null
                            ? energyMinFilter === energyMaxFilter
                              ? energyMinFilter
                              : `${energyMinFilter} - ${energyMaxFilter}`
                            : energyMinFilter !== null
                            ? `≥${energyMinFilter}`
                            : `≤${energyMaxFilter}`}
                        </span>
                      )}
                      {(bpmMinFilter !== null || bpmMaxFilter !== null) && (
                        <span className={styles.compactFilter}>
                          <strong>BPM:</strong>{" "}
                          {bpmMinFilter !== null && bpmMaxFilter !== null
                            ? `${bpmMinFilter} - ${bpmMaxFilter}`
                            : bpmMinFilter !== null
                            ? `≥${bpmMinFilter}`
                            : `≤${bpmMaxFilter}`}
                        </span>
                      )}
                    </div>
                  )}
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
