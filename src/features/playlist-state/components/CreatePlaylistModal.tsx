import React, { useEffect, useState } from "react";
import styles from "./CreatePlaylistModal.module.css";
import { Portal } from "@/components/ui";
import { sortCamelotKeys } from "@/utils/camelotKey";
import { Lightbulb } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBolt,
  faMusic,
  faTag,
  faTrophy,
} from "@fortawesome/free-solid-svg-icons";

interface CreatePlaylistModalProps {
  trackCount: number;
  currentSearchTerm: string;
  localTrackCount: number;
  activeTagDisplayNames: string[];
  activeTagFormula: string;
  energyMinFilter: number | null;
  energyMaxFilter: number | null;
  ratingFilters: number[];
  bpmMinFilter: number | null;
  bpmMaxFilter: number | null;
  camelotKeyFilters: string[];
  onClose: () => void;
  onCreatePlaylist: (
    playlistName: string,
    description: string,
    isPublic: boolean,
    isSmartPlaylist: boolean
  ) => void;
}

const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  trackCount,
  currentSearchTerm,
  localTrackCount,
  activeTagDisplayNames,
  activeTagFormula,
  energyMinFilter,
  energyMaxFilter,
  ratingFilters,
  bpmMinFilter,
  bpmMaxFilter,
  camelotKeyFilters,
  onClose,
  onCreatePlaylist,
}) => {
  const [isSmartPlaylist, setIsSmartPlaylist] = useState(false);
  const normalizedCamelotKeyFilters = sortCamelotKeys(camelotKeyFilters);

  const getDefaultPlaylistName = () => {
    const filterParts = [];

    if (activeTagDisplayNames.length > 0) {
      filterParts.push(activeTagDisplayNames.slice(0, 2).join(", ")); // Limit to first 2 tags for brevity
    }

    if (ratingFilters.length > 0) {
      filterParts.push(`${ratingFilters.sort((a, b) => a - b).join(",")}★`);
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

    if (normalizedCamelotKeyFilters.length > 0) {
      const keyPrefix = normalizedCamelotKeyFilters.slice(0, 4).join(",");
      const remainingCount = normalizedCamelotKeyFilters.length - 4;
      const suffix = remainingCount > 0 ? `+${remainingCount}` : "";
      filterParts.push(`K:${keyPrefix}${suffix}`);
    }

    const prefix = isSmartPlaylist ? "Smart " : "";

    let name =
      filterParts.length > 0
        ? `${prefix}Tagify - ${filterParts.join(" ")}`
        : `${prefix}Tagify Playlist ${new Date().toLocaleDateString()}`;

    // Truncate if too long
    if (name.length > 100) {
      name = name.substring(0, 97) + "...";
    }

    return name;
  };

  const getDefaultPlaylistDescription = () => {
    const filterParts = [];

    if (isSmartPlaylist) {
      filterParts.push(`SMART PLAYLIST`);
    }

    if (activeTagFormula) {
      filterParts.push(`Tags: ${activeTagFormula}`);
    }

    if (ratingFilters.length > 0) {
      filterParts.push(
        `Rating: ${ratingFilters.sort((a, b) => a - b).join(", ")} ★`
      );
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

    if (bpmMinFilter !== null || bpmMaxFilter !== null) {
      if (bpmMinFilter !== null && bpmMaxFilter !== null) {
        if (bpmMinFilter === bpmMaxFilter) {
          filterParts.push(`BPM: ${bpmMinFilter}`);
        } else {
          filterParts.push(`BPM: ${bpmMinFilter} - ${bpmMaxFilter}`);
        }
      } else if (bpmMinFilter !== null) {
        filterParts.push(`BPM: ≥${bpmMinFilter}`);
      } else {
        filterParts.push(`BPM: ≤${bpmMaxFilter}`);
      }
    }

    if (normalizedCamelotKeyFilters.length > 0) {
      filterParts.push(`Key: ${normalizedCamelotKeyFilters.join(", ")}`);
    }

    let description =
      filterParts.length > 0
        ? `${filterParts.join(" | ")}`
        : "Created with Tagify";

    // Truncate if too long
    if (description.length > 300) {
      description = description.substring(0, 297) + "...";
    }

    return description;
  };

  const [playlistName, setPlaylistName] = useState(() =>
    getDefaultPlaylistName()
  );
  const [playlistDescription, setPlaylistDescription] = useState(() =>
    getDefaultPlaylistDescription()
  );
  const [isPublic, setIsPublic] = useState(false);
  // const [isSmartPlaylist, setIsSmartPlaylist] = useState(false);

  const hasActiveSearchTerm =
    currentSearchTerm && currentSearchTerm.trim() !== "";
  const showSearchTermWarning = isSmartPlaylist && hasActiveSearchTerm;

  useEffect(() => {
    setPlaylistName(getDefaultPlaylistName());
    setPlaylistDescription(getDefaultPlaylistDescription());
  }, [isSmartPlaylist]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreatePlaylist(
      playlistName.trim() || getDefaultPlaylistName(),
      playlistDescription.trim() || getDefaultPlaylistDescription(),
      isPublic,
      isSmartPlaylist
    );
  };

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Create Playlist</h2>
            <button className="modal-close-button" onClick={onClose}>
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
                  Note: {localTrackCount} local tracks cannot be added
                  automatically
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
                  <span className="checkbox-text">Public playlist</span>
                </label>
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={isSmartPlaylist}
                    onChange={(e) => setIsSmartPlaylist(e.target.checked)}
                    className="form-checkbox"
                  />
                  <span className="checkbox-text">Smart playlist</span>
                  <div className={styles.helpTooltip}>
                    ?
                    <div className={styles.tooltipContent}>
                      <Lightbulb size={16} /> When new tracks match the filter
                      criteria, they'll be automatically added to this playlist!
                    </div>
                  </div>
                </label>
                {showSearchTermWarning && (
                  <div className={styles.warningBox}>
                    <p className={styles.warning}>
                      <strong>Note:</strong> Search term "{currentSearchTerm}"
                      will not be included in smart playlist criteria. The smart
                      playlist will only use tag, rating, energy, BPM, and key
                      filters for automatic updates.
                    </p>
                  </div>
                )}
              </div>

              <div className={styles.filtersContainer}>
                {activeTagFormula.length === 0 &&
                ratingFilters.length === 0 &&
                energyMinFilter === null &&
                energyMaxFilter === null &&
                bpmMinFilter === null &&
                bpmMaxFilter === null &&
                normalizedCamelotKeyFilters.length === 0 ? (
                  <div className={styles.filterRow}>
                    <span className={styles.filterLabel}>
                      No filters applied
                    </span>
                  </div>
                ) : (
                  <>
                    {activeTagFormula.length > 0 && (
                      <div className={styles.filterRow}>
                        <span className={styles.filterLabel}>
                          <FontAwesomeIcon icon={faTag} /> Tags:
                        </span>
                        <div className={styles.tags}>
                          <span className={styles.tag}>{activeTagFormula}</span>
                        </div>
                      </div>
                    )}
                    {(ratingFilters.length > 0 ||
                      energyMinFilter !== null ||
                      energyMaxFilter !== null ||
                      bpmMinFilter !== null ||
                      bpmMaxFilter !== null ||
                      normalizedCamelotKeyFilters.length > 0) && (
                      <div className={styles.compactFilterRow}>
                        {ratingFilters.length > 0 && (
                          <span className={styles.compactFilter}>
                            <FontAwesomeIcon icon={faTrophy} />{" "}
                            <strong>Rating: </strong>
                            {ratingFilters.sort((a, b) => a - b).join(", ")} ★
                          </span>
                        )}
                        {(energyMinFilter !== null ||
                          energyMaxFilter !== null) && (
                          <span className={styles.compactFilter}>
                            <FontAwesomeIcon icon={faBolt} />
                            <strong>Energy:</strong>{" "}
                            {energyMinFilter !== null &&
                            energyMaxFilter !== null
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
                            <FontAwesomeIcon icon={faMusic} />
                            <strong>BPM:</strong>{" "}
                            {bpmMinFilter !== null && bpmMaxFilter !== null
                              ? `${bpmMinFilter} - ${bpmMaxFilter}`
                              : bpmMinFilter !== null
                              ? `≥${bpmMinFilter}`
                              : `≤${bpmMaxFilter}`}
                          </span>
                        )}
                        {normalizedCamelotKeyFilters.length > 0 && (
                          <span className={styles.compactFilter}>
                            <FontAwesomeIcon icon={faMusic} />
                            <strong>Key:</strong>{" "}
                            {normalizedCamelotKeyFilters.join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={onClose}
                >
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
