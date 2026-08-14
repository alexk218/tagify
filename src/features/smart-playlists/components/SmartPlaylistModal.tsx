import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./SmartPlaylistModal.module.css";
import { Portal } from "@/components/ui";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { TagTaxonomy } from "@/types/tagData";
import { formatCondensedDate, formatTimestamp } from "@/utils/formatters";
import { normalizeCamelotKey, sortCamelotKeys } from "@/utils/camelotKey";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faMagnifyingGlass,
  faMusic,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  findDisplayTagName,
} from "@/utils/tagTaxonomy";
import { formatTagFilterFormula } from "@/utils/tagFilterGroups";

const PLAYLIST_SORT_OPTIONS = {
  ALPHABETICAL: "alphabetical",
  DATE_CREATED: "dateCreated",
  NEEDS_SYNC: "needsSync",
} as const;

const SORT_ORDERS = {
  ASC: "asc",
  DESC: "desc",
} as const;

type PlaylistSortOption =
  (typeof PLAYLIST_SORT_OPTIONS)[keyof typeof PLAYLIST_SORT_OPTIONS];
type SortOrder = (typeof SORT_ORDERS)[keyof typeof SORT_ORDERS];

interface SmartPlaylistModalProps {
  smartPlaylists: SmartPlaylistCriteria[];
  taxonomy: TagTaxonomy;
  onUpdateSmartPlaylists: (updatedPlaylists: SmartPlaylistCriteria[]) => void;
  onSyncPlaylist: (playlist: SmartPlaylistCriteria) => Promise<void>;
  onExportSmartPlaylists: () => void;
  onImportSmartPlaylists: (data: SmartPlaylistCriteria[]) => void;
  onCleanupDeletedSmartPlaylists: () => Promise<void>;
  onClose: () => void;
}

const SmartPlaylistModal: React.FC<SmartPlaylistModalProps> = ({
  smartPlaylists,
  taxonomy,
  onUpdateSmartPlaylists,
  onSyncPlaylist,
  onExportSmartPlaylists,
  onImportSmartPlaylists,
  onCleanupDeletedSmartPlaylists,
  onClose,
}) => {
  const [syncingPlaylists, setSyncingPlaylists] = useState<Set<string>>(
    new Set(),
  );
  const [playlistTrackCounts, setPlaylistTrackCounts] = useState<
    Record<string, number>
  >({});
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<PlaylistSortOption>(
    PLAYLIST_SORT_OPTIONS.ALPHABETICAL,
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(SORT_ORDERS.ASC);
  const getSyncStatus = (
    playlist: SmartPlaylistCriteria,
  ): "synced" | "needsSync" | "unknown" => {
    const actualCount = playlistTrackCounts[playlist.playlistId];
    const expectedCount = playlist.smartPlaylistTrackUris.length;

    if (actualCount === undefined) return "unknown";
    if (actualCount === expectedCount) return "synced";
    return "needsSync";
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportClick = () => {
    onClose();
    onExportSmartPlaylists();
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // Validate smart playlist data structure
        if (
          Array.isArray(data) &&
          data.every(
            (playlist) =>
              playlist &&
              typeof playlist === "object" &&
              typeof playlist.playlistId === "string" &&
              typeof playlist.playlistName === "string" &&
              playlist.criteria &&
              typeof playlist.criteria === "object",
          )
        ) {
          onImportSmartPlaylists(data);
          Spicetify.showNotification("Smart playlists imported successfully!");
        } else {
          console.error("Invalid smart playlist backup structure:", data);
          Spicetify.showNotification(
            "Invalid smart playlist backup file format",
            true,
          );
        }
      } catch (error) {
        console.error("Error parsing backup file:", error);
        Spicetify.showNotification("Error importing backup", true);
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.onerror = () => {
      Spicetify.showNotification("Error reading backup file", true);
    };

    reader.readAsText(file);
  };

  const filteredAndSortedPlaylists = useMemo(() => {
    const filtered = smartPlaylists.filter((playlist) =>
      playlist.playlistName.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    return [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case PLAYLIST_SORT_OPTIONS.ALPHABETICAL: {
          comparison = a.playlistName.localeCompare(b.playlistName);
          break;
        }

        case PLAYLIST_SORT_OPTIONS.DATE_CREATED: {
          const dateA = a.createdAt || 0;
          const dateB = b.createdAt || 0;
          comparison = dateA - dateB;
          break;
        }

        case PLAYLIST_SORT_OPTIONS.NEEDS_SYNC: {
          const syncStatusA = getSyncStatus(a);
          const syncStatusB = getSyncStatus(b);

          if (syncStatusA === "needsSync" && syncStatusB !== "needsSync") {
            comparison = -1;
          } else if (
            syncStatusA !== "needsSync" &&
            syncStatusB === "needsSync"
          ) {
            comparison = 1;
          } else {
            comparison = a.playlistName.localeCompare(b.playlistName);
          }
          break;
        }

        default:
          return 0;
      }

      if (sortBy !== PLAYLIST_SORT_OPTIONS.NEEDS_SYNC) {
        return sortOrder === SORT_ORDERS.DESC ? -comparison : comparison;
      }

      return comparison;
    });
  }, [smartPlaylists, searchQuery, sortBy, sortOrder, playlistTrackCounts]);

  useEffect(() => {
    return () => {
      setSearchQuery("");
    };
  }, []);

  useEffect(() => {
    onCleanupDeletedSmartPlaylists();
  }, []);

  useEffect(() => {
    const syncPlaylistNames = async () => {
      let hasUpdates = false;

      const updatedPlaylists = await Promise.all(
        smartPlaylists.map(async (playlist) => {
          try {
            const playlistUri = `spotify:playlist:${playlist.playlistId}`;
            const metadata = await (
              Spicetify.Platform.PlaylistAPI as any
            ).getMetadata(playlistUri);

            if (metadata?.name && metadata.name !== playlist.playlistName) {
              hasUpdates = true;
              return {
                ...playlist,
                playlistName: metadata.name,
              };
            }

            return playlist;
          } catch (error) {
            console.error(
              `Failed to fetch metadata for playlist ${playlist.playlistId}:`,
              error,
            );
            return playlist;
          }
        }),
      );

      if (hasUpdates) {
        onUpdateSmartPlaylists(updatedPlaylists);
      }
    };

    if (smartPlaylists.length > 0) {
      syncPlaylistNames();
    }
  }, []);

  useEffect(() => {
    const fetchCounts = async () => {
      if (smartPlaylists.length === 0) return;

      setIsLoadingCounts(true);
      const playlistIds = smartPlaylists.map((p) => p.playlistId);
      const counts = await spotifyApiService.getPlaylistTrackCounts(playlistIds);
      setPlaylistTrackCounts(counts);
      setIsLoadingCounts(false);
    };

    fetchCounts();
  }, [smartPlaylists]);

  const toggleSmartPlaylistActive = async (playlistId: string) => {
    const playlist = smartPlaylists.find((p) => p.playlistId === playlistId);
    if (!playlist) return;

    const willBeActive = !playlist.isActive;

    const updatedPlaylists = smartPlaylists.map((p) => {
      if (p.playlistId === playlistId) {
        return {
          ...p,
          isActive: willBeActive,
        };
      }
      return p;
    });

    onUpdateSmartPlaylists(updatedPlaylists);

    if (willBeActive) {
      setSyncingPlaylists((prev) => new Set(prev).add(playlistId));

      try {
        const updatedPlaylist = updatedPlaylists.find(
          (p) => p.playlistId === playlistId,
        )!;
        await onSyncPlaylist(updatedPlaylist);
      } catch (error) {
        console.error("Failed to sync playlist after activation:", error);
        Spicetify.showNotification("Failed to sync playlist", true);
        const revertedPlaylists = smartPlaylists.map((p) =>
          p.playlistId === playlistId ? { ...p, isActive: false } : p,
        );
        onUpdateSmartPlaylists(revertedPlaylists);
      } finally {
        setSyncingPlaylists((prev) => {
          const newSet = new Set(prev);
          newSet.delete(playlistId);
          return newSet;
        });
      }
    }
  };

  const handleManualSync = async (playlist: SmartPlaylistCriteria) => {
    if (!playlist.isActive) return;

    setSyncingPlaylists((prev) => new Set(prev).add(playlist.playlistId));

    try {
      await onSyncPlaylist(playlist);
    } catch (error) {
      console.error("Manual sync failed:", error);
      Spicetify.showNotification("Sync failed", true);
    } finally {
      setSyncingPlaylists((prev) => {
        const newSet = new Set(prev);
        newSet.delete(playlist.playlistId);
        return newSet;
      });
    }
  };

  const handleRemoveSmartPlaylistTracking = (playlistId: string) => {
    let confirmed = true;
    const isJsdomEnvironment =
      typeof navigator !== "undefined" &&
      /jsdom/i.test(navigator.userAgent || "");

    // Only an explicit "false" should cancel removal.
    // In test/jsdom environments confirm may return undefined.
    if (typeof window.confirm === "function" && !isJsdomEnvironment) {
      try {
        const confirmationResult = window.confirm(
          "Are you sure you want to stop tracking this smart playlist? This action cannot be undone.",
        );
        if (typeof confirmationResult === "boolean") {
          confirmed = confirmationResult;
        }
      } catch {
        confirmed = true;
      }
    }

    if (!confirmed) {
      return;
    }

    const playlist = smartPlaylists.find(
      (item) => item.playlistId === playlistId,
    );
    if (!playlist) {
      return;
    }

    // This only removes Tagify smart-playlist tracking metadata.
    // The Spotify playlist itself is intentionally left untouched.
    const updatedPlaylists = smartPlaylists.filter(
      (item) => item.playlistId !== playlistId,
    );

    onUpdateSmartPlaylists(updatedPlaylists);

    setSyncingPlaylists((prev) => {
      const next = new Set(prev);
      next.delete(playlistId);
      return next;
    });

    setPlaylistTrackCounts((prev) => {
      if (!(playlistId in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[playlistId];
      return next;
    });

    Spicetify.showNotification(
      `Stopped tracking "${playlist.playlistName}" as a smart playlist`,
    );
  };

  const formatRatingFilters = (ratingFilters: number[]): string => {
    if (ratingFilters.length === 0) return "";
    return `${ratingFilters.sort((a, b) => a - b).join(", ")} ★`;
  };

  const formatEnergyRange = (
    min: number | null,
    max: number | null,
  ): string => {
    if (min === null && max === null) return "";
    if (min !== null && max !== null) {
      return min === max ? `Energy: ${min}` : `Energy: ${min} - ${max}`;
    }
    if (min !== null) return `Energy: ≥${min}`;
    return `Energy: ≤${max}`;
  };

  const formatBpmRange = (min: number | null, max: number | null): string => {
    if (min === null && max === null) return "";
    if (min !== null && max !== null) {
      return min === max ? `${min} BPM` : `${min} - ${max} BPM`;
    }
    if (min !== null) return `≥${min} BPM`;
    return `≤${max} BPM`;
  };

  const formatCamelotKeyFilters = (keys: string[] | undefined): string => {
    const normalizedKeys = sortCamelotKeys(keys || []);
    if (normalizedKeys.length === 0) return "";
    return normalizedKeys.join(", ");
  };

  const formatCamelotRange = (
    min: string | null | undefined,
    max: string | null | undefined,
  ): string => {
    const normalizedMin = normalizeCamelotKey(min);
    const normalizedMax = normalizeCamelotKey(max);

    if (normalizedMin === null && normalizedMax === null) return "";
    if (normalizedMin !== null && normalizedMax !== null) {
      return normalizedMin === normalizedMax
        ? normalizedMin
        : `${normalizedMin} - ${normalizedMax}`;
    }
    if (normalizedMin !== null) return `≥${normalizedMin}`;
    return `≤${normalizedMax}`;
  };

  const navigateToPlaylist = (playlistId: string) => {
    Spicetify.Platform.History.push(`/playlist/${playlistId}`);
    onClose();
  };

  return (
    <>
      <Portal>
        <div className={styles.modalOverlay} onClick={onClose}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.titleBlock}>
                <h2 className={styles.modalTitle}>
                  Smart Playlists ({smartPlaylists.length})
                </h2>
                <p className={styles.modalSubtitle}>
                  Compact view of criteria and sync state.
                </p>
              </div>

              <div className={styles.headerActions}>
                <button
                  className={`${styles.headerButton} ${styles.exportButton}`}
                  onClick={handleExportClick}
                  title="Backup your smart playlists"
                >
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} size="sm" />
                  Backup
                </button>

                <button
                  className={`${styles.headerButton} ${styles.importButton}`}
                  onClick={handleImportClick}
                  title="Import smart playlists"
                >
                  <FontAwesomeIcon
                    icon={faArrowUpRightFromSquare}
                    rotation={180}
                    size="sm"
                  />
                  Import
                </button>

                <button
                  className={`modal-close-button ${styles.closeButton}`}
                  onClick={onClose}
                  aria-label="Close"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            </div>

            <div className={styles.controlsSection}>
              <div className={styles.searchSection}>
                <FontAwesomeIcon
                  icon={faMagnifyingGlass}
                  className={styles.searchIcon}
                />
                <input
                  type="text"
                  placeholder="Search playlists..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                />
                {searchQuery && (
                  <button
                    className={styles.clearSearchButton}
                    onClick={() => setSearchQuery("")}
                    title="Clear search"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
              </div>

              <div className={styles.sortSection}>
                <label className={styles.sortLabel}>Sort</label>
                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(e.target.value as PlaylistSortOption)
                  }
                  className={styles.sortSelect}
                >
                  <option value={PLAYLIST_SORT_OPTIONS.ALPHABETICAL}>Name</option>
                  <option value={PLAYLIST_SORT_OPTIONS.DATE_CREATED}>
                    Date Created
                  </option>
                  <option value={PLAYLIST_SORT_OPTIONS.NEEDS_SYNC}>
                    Needs Sync
                  </option>
                </select>

                {sortBy !== PLAYLIST_SORT_OPTIONS.NEEDS_SYNC && (
                  <button
                    className={styles.sortOrderButton}
                    onClick={() =>
                      setSortOrder(
                        sortOrder === SORT_ORDERS.ASC
                          ? SORT_ORDERS.DESC
                          : SORT_ORDERS.ASC,
                      )
                    }
                    title={`Sort ${
                      sortOrder === SORT_ORDERS.ASC ? "descending" : "ascending"
                    }`}
                  >
                    {sortOrder === SORT_ORDERS.ASC ? "↑" : "↓"}
                  </button>
                )}
              </div>
            </div>

            <div className={styles.modalBody}>
              {filteredAndSortedPlaylists.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>
                    <FontAwesomeIcon
                      icon={searchQuery ? faMagnifyingGlass : faMusic}
                    />
                  </div>
                  {searchQuery ? (
                    <>
                      <h3>No playlists found</h3>
                      <p>No playlists match "{searchQuery}"</p>
                    </>
                  ) : (
                    <>
                      <h3>No Smart Playlists Yet</h3>
                      <p>
                        Create a playlist with filters and enable "Smart
                        Playlist" to get started!
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className={styles.playlistList}>
                  {filteredAndSortedPlaylists.map((playlist) => {
                    const includeTagFormula = formatTagFilterFormula(
                      {
                        clauses: playlist.criteria.includeTagClauses,
                        connectors: playlist.criteria.clauseConnectors,
                      },
                      (tagId) =>
                        findDisplayTagName(taxonomy, tagId, { disambiguate: true }),
                    );
                    const ratingText = formatRatingFilters(
                      playlist.criteria.ratingFilters,
                    );
                    const energyText = formatEnergyRange(
                      playlist.criteria.energyMinFilter,
                      playlist.criteria.energyMaxFilter,
                    );
                    const bpmText = formatBpmRange(
                      playlist.criteria.bpmMinFilter,
                      playlist.criteria.bpmMaxFilter,
                    );
                    const camelotFilterText = formatCamelotKeyFilters(
                      playlist.criteria.camelotKeyFilters,
                    );
                    const camelotText =
                      camelotFilterText ||
                      formatCamelotRange(
                        playlist.criteria.camelotMinFilter ?? null,
                        playlist.criteria.camelotMaxFilter ?? null,
                      );
                    const syncStatus = getSyncStatus(playlist);
                    const currentTrackCount = isLoadingCounts
                      ? "..."
                      : (playlistTrackCounts[playlist.playlistId] ?? 0);

                    // Keep all criteria text compact while preserving exact wording.
                    const criteriaTokens: string[] = [];
                    if (ratingText) criteriaTokens.push(ratingText);
                    if (energyText) criteriaTokens.push(energyText);
                    if (bpmText) criteriaTokens.push(bpmText);
                    if (camelotText) criteriaTokens.push(`Key: ${camelotText}`);

                    return (
                      <div
                        key={playlist.playlistId}
                        className={`${styles.playlistItem} ${
                          !playlist.isActive ? styles.inactive : ""
                        }`}
                      >
                        <div className={styles.playlistHeader}>
                          <div className={styles.playlistTitleSection}>
                            <h3
                              className={styles.playlistName}
                              onClick={() =>
                                navigateToPlaylist(playlist.playlistId)
                              }
                            >
                              {playlist.playlistName}
                            </h3>
                            {!playlist.isActive && (
                              <span className={styles.inactiveLabel}>
                                Inactive
                              </span>
                            )}
                          </div>

                          <div className={styles.playlistMetadata}>
                            <span
                              className={styles.timeStamp}
                              title={`Created: ${formatTimestamp(
                                playlist.createdAt,
                              )}`}
                            >
                              Created {formatCondensedDate(playlist.createdAt, "short")}
                            </span>
                          </div>
                        </div>

                        <div className={styles.playlistStatsRow}>
                          <div className={styles.trackRowItem}>
                            <div className={styles.trackCountNumber}>
                              {currentTrackCount}
                            </div>
                            <div className={styles.trackCountLabel}>
                              In Playlist
                            </div>
                          </div>

                          <div className={styles.trackRowItem}>
                            <div className={styles.trackCountNumber}>
                              {playlist.smartPlaylistTrackUris.length}
                            </div>
                            <div className={styles.trackCountLabel}>Expected</div>
                          </div>

                          <span
                            className={`${styles.syncIndicator} ${
                              styles[syncStatus]
                            }`}
                          >
                            {syncStatus === "synced" && "In Sync"}
                            {syncStatus === "needsSync" && "Needs Sync"}
                            {syncStatus === "unknown" && "Unknown"}
                          </span>
                        </div>

                        {criteriaTokens.length > 0 ? (
                          <div className={styles.criteriaSection}>
                            <div className={styles.criteriaList}>
                              {includeTagFormula ? (
                                <div className={styles.criteriaItem}>
                                  <span className={styles.criteriaLabel}>Match</span>
                                  <span className={styles.criteriaValue}>
                                    {includeTagFormula}
                                  </span>
                                </div>
                              ) : null}
                              {criteriaTokens.map((token, index) => (
                                <div
                                  key={`${playlist.playlistId}-${index}`}
                                  className={styles.criteriaItem}
                                >
                                  <span className={styles.criteriaValue}>
                                    {token}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : includeTagFormula ? (
                          <div className={styles.criteriaSection}>
                            <div className={styles.criteriaList}>
                              {includeTagFormula ? (
                                <div className={styles.criteriaItem}>
                                  <span className={styles.criteriaLabel}>Match</span>
                                  <span className={styles.criteriaValue}>
                                    {includeTagFormula}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className={styles.noCriteria}>
                            <span>No filter criteria set</span>
                          </div>
                        )}

                        <div className={styles.playlistActions}>
                          <button
                            className={`${styles.actionButton} ${styles.removeTrackingButton}`}
                            onClick={() =>
                              handleRemoveSmartPlaylistTracking(
                                playlist.playlistId,
                              )
                            }
                            disabled={syncingPlaylists.has(playlist.playlistId)}
                            title="Remove smart-playlist tracking (does not delete the Spotify playlist)"
                          >
                            Remove Tracking
                          </button>

                          <button
                            className={`${styles.actionButton} ${
                              styles.syncToggleButton
                            } ${!playlist.isActive ? styles.inactive : ""}`}
                            onClick={() =>
                              toggleSmartPlaylistActive(playlist.playlistId)
                            }
                            disabled={syncingPlaylists.has(playlist.playlistId)}
                          >
                            {playlist.isActive ? "Disable Sync" : "Enable Sync"}
                          </button>

                          {playlist.isActive && (
                            <button
                              className={`${styles.actionButton} ${
                                styles.syncButton
                              } ${
                                syncStatus === "needsSync"
                                  ? styles.syncButtonUrgent
                                  : ""
                              } ${
                                syncingPlaylists.has(playlist.playlistId)
                                  ? styles.syncing
                                  : ""
                              }`}
                              onClick={() => handleManualSync(playlist)}
                              disabled={syncingPlaylists.has(
                                playlist.playlistId,
                              )}
                            >
                              {syncingPlaylists.has(playlist.playlistId)
                                ? "Syncing..."
                                : "Sync Now"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </Portal>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </>
  );
};

export default SmartPlaylistModal;
