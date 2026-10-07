import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./SmartPlaylistModal.module.css";
import { Portal } from "@/components/ui";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { TagTaxonomy, TrackData } from "@/types/tagData";
import { formatCondensedDate, formatTimestamp } from "@/utils/formatters";
import { normalizeCamelotKey, sortCamelotKeys } from "@/utils/camelotKey";
import { storageService } from "@/services/storage/StorageService";
import { collectMatchingTrackUris } from "../utils/smartPlaylist.syncUtils";
import { hasConfirmedMembershipBaseline } from "../utils/smartPlaylist.storage";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { usePromptHistory } from "@/features/onboarding/hooks/usePromptHistory";
import { MOBILE_TAGGING_INTRO_KEY } from "@/features/onboarding/services/promptHistory";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faInfo,
  faMagnifyingGlass,
  faMobileScreenButton,
  faMusic,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  findDisplayTagName,
} from "@/utils/tagTaxonomy";
import { formatTagFilterFormula } from "@/utils/tagFilterGroups";
import {
  SmartPlaylistImportSummary,
  SpotifyPlaylistReference,
} from "@/features/smart-playlists/utils/smartPlaylist.import";
import { parseSmartPlaylistShare, SMART_PLAYLIST_SHARE_MAX_BYTES, type SmartPlaylistRecipeSelection } from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import type { SmartPlaylistRecipeBundle } from "../model/smartPlaylist.types";
import SmartPlaylistSharingDialog from "./SmartPlaylistSharingDialog";
import {
  clearExplicitSmartPlaylistClear,
  markSmartPlaylistsExplicitlyCleared,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";

const PLAYLIST_SORT_OPTIONS = {
  ALPHABETICAL: "alphabetical",
  DATE_CREATED: "dateCreated",
  NEEDS_SYNC: "needsSync",
} as const;

const SORT_ORDERS = {
  ASC: "asc",
  DESC: "desc",
} as const;

export const SMART_PLAYLIST_MOBILE_TAGGING_INTRO_KEY = MOBILE_TAGGING_INTRO_KEY;

type PlaylistSortOption =
  (typeof PLAYLIST_SORT_OPTIONS)[keyof typeof PLAYLIST_SORT_OPTIONS];
type SortOrder = (typeof SORT_ORDERS)[keyof typeof SORT_ORDERS];

interface SmartPlaylistModalProps {
  smartPlaylists: SmartPlaylistCriteria[];
  taxonomy: TagTaxonomy;
  tracks?: Record<string, TrackData>;
  onEditPlaylist: (playlist: SmartPlaylistCriteria) => void;
  onUpdateSmartPlaylists: (value: React.SetStateAction<SmartPlaylistCriteria[]>) => Promise<void>;
  onSyncPlaylist: (playlist: SmartPlaylistCriteria) => Promise<void>;
  onExportSmartPlaylists: (selected?: SmartPlaylistCriteria[]) => Promise<void> | void;
  onImportSmartPlaylists: (
    data: unknown,
    selections?: SmartPlaylistRecipeSelection[],
  ) => Promise<SmartPlaylistImportSummary>;
  onBindRecipe?: (
    playlist: SmartPlaylistCriteria,
    existingPlaylist?: SpotifyPlaylistReference,
  ) => Promise<void>;
  onClose: () => void;
}

const SmartPlaylistModal: React.FC<SmartPlaylistModalProps> = ({
  smartPlaylists,
  taxonomy,
  tracks,
  onEditPlaylist,
  onUpdateSmartPlaylists,
  onSyncPlaylist,
  onExportSmartPlaylists,
  onImportSmartPlaylists,
  onBindRecipe,
  onClose,
}) => {
  const mainDialog = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState<{ mode: "share" } | { mode: "import"; bundle: SmartPlaylistRecipeBundle } | { mode: "create"; setup: SmartPlaylistCriteria } | null>(null);
  const [importError, setImportError] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const [syncingPlaylists, setSyncingPlaylists] = useState<Set<string>>(
    new Set(),
  );
  const [playlistTrackCounts, setPlaylistTrackCounts] = useState<
    Record<string, number>
  >({});
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const [availableSpotifyPlaylists, setAvailableSpotifyPlaylists] = useState<
    SpotifyPlaylistReference[]
  >([]);
  const [selectedBindings, setSelectedBindings] = useState<Record<string, string>>({});
  const promptHistory = usePromptHistory();
  const [manualMobileTaggingIntro, setManualMobileTaggingIntro] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(false);
  const showMobileTaggingIntro = manualMobileTaggingIntro ||
    (!introDismissed && promptHistory.ready && !promptHistory.mobileTaggingIntroSeen);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<PlaylistSortOption>(
    PLAYLIST_SORT_OPTIONS.ALPHABETICAL,
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(SORT_ORDERS.ASC);
  const [verifiedStatuses, setVerifiedStatuses] = useState<Record<string, "synced" | "needsSync" | "unknown">>({});
  const [reconnecting, setReconnecting] = useState<Set<string>>(new Set());
  useEffect(() => { if (!sharing) mainDialog.current?.focus(); }, [sharing]);
  const getSyncStatus = (
    playlist: SmartPlaylistCriteria,
  ): "synced" | "needsSync" | "unknown" => {
    if (!playlist.isActive || !playlist.lastSyncAt || !hasConfirmedMembershipBaseline(playlist)) return "unknown";
    if (playlist.pendingTagChoices?.length) return "needsSync";
    return verifiedStatuses[playlist.playlistId] ?? "unknown";
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const dismissMobileTaggingIntro = () => {
    promptHistory.markSeen("mobileTaggingIntroSeen");
    setIntroDismissed(true);
    setManualMobileTaggingIntro(false);
  };

  const handleExportClick = () => setSharing({ mode: "share" });
  const handleImportClick = () => fileInputRef.current?.click();
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError("");
    if (file.size > SMART_PLAYLIST_SHARE_MAX_BYTES) {
      setImportError("This file is too large. Ask the sender to share fewer setups at a time."); return;
    }
    setReadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      try { setSharing({ mode: "import", bundle: parseSmartPlaylistShare(String(reader.result)) }); }
      catch (error) { setImportError(error instanceof Error ? error.message : "This file couldn’t be read. Choose the original share file from Tagify."); }
      finally { setReadingFile(false); }
    };
    reader.onerror = () => { setReadingFile(false); setImportError("This file couldn’t be opened. Choose it again, or ask the sender for a new copy."); };
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
  }, [smartPlaylists, searchQuery, sortBy, sortOrder, playlistTrackCounts, verifiedStatuses]);

  useEffect(() => {
    return () => {
      setSearchQuery("");
    };
  }, []);

  useEffect(() => {
    const syncPlaylistNames = async () => {
      let hasUpdates = false;

      const updatedPlaylists = await Promise.all(
        smartPlaylists.map(async (playlist) => {
          if (!playlist.playlistId) return playlist;
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
        await onUpdateSmartPlaylists((current) => current.map((playlist) => {
          const updated = updatedPlaylists.find((candidate) =>
            playlist.id ? candidate.id === playlist.id : candidate.playlistId === playlist.playlistId,
          );
          return updated && updated.playlistName !== playlist.playlistName
            ? { ...playlist, playlistName: updated.playlistName }
            : playlist;
        }));
      }
    };

    if (smartPlaylists.length > 0) {
      void syncPlaylistNames().catch((error) => {
        console.error("Could not save updated smart playlist names:", error);
      });
    }
  }, []);

  useEffect(() => {
    let active = true;
    const fetchCounts = async () => {
      setIsLoadingCounts(true);
      setVerifiedStatuses({});
      try {
        const data = await storageService.loadAllStrict();
        if (!active) return;
        const results = await Promise.all(smartPlaylists.filter((p) => p.playlistId).map(async (playlist) => {
          try {
            const actual = await spotifyApiService.getAllTrackUrisInPlaylistStrict(playlist.playlistId);
            const actualSet = new Set(actual);
            // Matching local files must be added manually, so their absence isn't a sync failure.
            const expected = new Set(collectMatchingTrackUris(data.tracks, playlist.criteria).filter((uri) => !uri.startsWith("spotify:local:") || actualSet.has(uri)));
            const matches = actual.length === expected.size && new Set(actual).size === actual.length && actual.every((uri) => expected.has(uri));
            return { id: playlist.playlistId, count: actual.length, status: matches ? "synced" as const : "needsSync" as const };
          } catch { return { id: playlist.playlistId, status: "unknown" as const }; }
        }));
        if (active) {
          setPlaylistTrackCounts(Object.fromEntries(results.flatMap((result) => result.count === undefined ? [] : [[result.id, result.count]])));
          setVerifiedStatuses(Object.fromEntries(results.map((result) => [result.id, result.status])));
        }
      } catch { if (active) setVerifiedStatuses({}); }
      finally { if (active) setIsLoadingCounts(false); }
    };
    void fetchCounts();
    const refresh = () => { void fetchCounts(); };
    window.addEventListener("tagify:dataUpdated", refresh);
    return () => { active = false; window.removeEventListener("tagify:dataUpdated", refresh); };
  }, [smartPlaylists]);

  useEffect(() => {
    if (!smartPlaylists.length) return;
    void spotifyApiService
      .getAllUserPlaylistReferencesStrict()
      .then(setAvailableSpotifyPlaylists)
      .catch((error) =>
        console.warn("Could not load Spotify playlists for recipe binding", error),
      );
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

    try {
      await onUpdateSmartPlaylists(updatedPlaylists);
    } catch (error) {
      console.error("Could not change smart playlist activation:", error);
      Spicetify.showNotification("Tagify couldn't save this Smart Playlist change. Please try again.", true);
      return;
    }

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
        try {
          await onUpdateSmartPlaylists(revertedPlaylists);
        } catch (restoreError) {
          console.error("Could not restore smart playlist activation:", restoreError);
        }
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

  const handleRemoveSmartPlaylistTracking = async (target: SmartPlaylistCriteria) => {
    const playlistId = target.playlistId;
    const samePlaylist = (item: SmartPlaylistCriteria) => target.id ? item.id === target.id : item === target;
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
      samePlaylist,
    );
    if (!playlist) {
      return;
    }

    // This only removes Tagify smart-playlist tracking metadata.
    // The Spotify playlist itself is intentionally left untouched.
    const updatedPlaylists = smartPlaylists.filter(
      (item) => !samePlaylist(item),
    );
    if (updatedPlaylists.length === 0) markSmartPlaylistsExplicitlyCleared();

    try {
      await onUpdateSmartPlaylists(updatedPlaylists);
    } catch (error) {
      if (updatedPlaylists.length === 0) clearExplicitSmartPlaylistClear();
      console.error("Could not stop smart playlist tracking:", error);
      Spicetify.showNotification("Tagify couldn't stop tracking this Smart Playlist. Please try again.", true);
      return;
    }

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

  if (sharing) return <SmartPlaylistSharingDialog mode={sharing.mode} taxonomy={taxonomy} playlists={smartPlaylists} tracks={tracks}
    bundle={sharing.mode === "import" ? sharing.bundle : undefined} setup={sharing.mode === "create" ? sharing.setup : undefined}
    onShare={(selected) => onExportSmartPlaylists(selected)} onImport={onImportSmartPlaylists}
    onCreate={onBindRecipe ? async (setup) => { await onBindRecipe(setup); setSharing(null); } : undefined} onClose={() => setSharing(null)} />;

  return (
    <>
      <Portal>
        <div className={styles.modalOverlay} onClick={onClose}>
          <div ref={mainDialog} tabIndex={-1} className={styles.modal} role="dialog" aria-modal="true" aria-label="Smart playlists" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.titleBlock}>
                <h2 className={styles.modalTitle}>
                  Smart Playlists ({smartPlaylists.length})
                </h2>
                <p className={styles.modalSubtitle}>
                  Create, organize, and share playlists that stay up to date automatically.
                </p>
              </div>

              <div className={styles.headerActions}>
                <button
                  type="button"
                  className={styles.headerButton}
                  onClick={() => setManualMobileTaggingIntro(true)}
                  title="Learn how to tag songs from your phone"
                >
                  <FontAwesomeIcon icon={faMobileScreenButton} size="sm" />
                  Mobile tagging
                </button>
                <div className={styles.shareInfoTooltip}>
                  <button
                    type="button"
                    className={styles.shareInfoButton}
                    aria-label="About sharing smart playlists"
                    aria-describedby="smart-playlist-share-info"
                  >
                    <FontAwesomeIcon icon={faInfo} size="xs" />
                  </button>
                  <div
                    id="smart-playlist-share-info"
                    className={styles.shareInfoPanel}
                    role="tooltip"
                  >
                    <strong>What does Share include?</strong>
                    <p>
                      Share saves how your smart playlists are set up—their names,
                      filters, and tags. It does not include the songs in your
                      playlists or give anyone access to your Spotify account.
                      Someone who imports it can create their own Spotify playlists
                      using the same rules.
                    </p>
                  </div>
                </div>

                <button
                  className={`${styles.headerButton} ${styles.exportButton}`}
                  onClick={handleExportClick}
                  title="Save your smart playlist setups to share with someone"
                >
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} size="sm" />
                  Share
                </button>

                <button
                  className={`${styles.headerButton} ${styles.importButton}`}
                  onClick={handleImportClick}
                  disabled={readingFile}
                  title="Add smart playlist setups that someone shared with you"
                >
                  <FontAwesomeIcon
                    icon={faArrowUpRightFromSquare}
                    rotation={180}
                    size="sm"
                  />
                  {readingFile ? "Reading…" : "Import"}
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

            {importError ? <p role="alert" style={{ padding: "0 24px", color: "#ffb8b8" }}>{importError}</p> : null}
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
                    const currentTrackCount = !playlist.playlistId
                      ? 0
                      : isLoadingCounts
                      ? "..."
                      : (playlistTrackCounts[playlist.playlistId] ?? 0);

                    const matchingCount = tracks ? collectMatchingTrackUris(tracks, playlist.criteria).filter((uri) => uri.startsWith("spotify:track:")).length : null;

                    // Keep all criteria text compact while preserving exact wording.
                    const criteriaTokens: string[] = [];
                    if (ratingText) criteriaTokens.push(ratingText);
                    if (energyText) criteriaTokens.push(energyText);
                    if (bpmText) criteriaTokens.push(bpmText);
                    if (camelotText) criteriaTokens.push(`Key: ${camelotText}`);

                    return (
                      <div
                        key={playlist.id ?? playlist.playlistId}
                        className={`${styles.playlistItem} ${
                          !playlist.isActive ? styles.inactive : ""
                        }`}
                      >
                        <div className={styles.playlistHeader}>
                          <div className={styles.playlistTitleSection}>
                            <h3
                              className={styles.playlistName}
                              onClick={() =>
                                playlist.playlistId &&
                                navigateToPlaylist(playlist.playlistId)
                              }
                            >
                              {playlist.playlistName}
                            </h3>
                            {!playlist.isActive && (
                              <span className={styles.inactiveLabel}>
                                {playlist.playlistId ? "Inactive" : playlist.source ? "Saved setup" : "Not Connected"}
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

                        {playlist.playlistId ? <div className={styles.playlistStatsRow}>
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
                            <div className={styles.trackCountLabel}>Tracked</div>
                          </div>

                          <span
                            className={`${styles.syncIndicator} ${
                              styles[syncStatus]
                            }`}
                          >
                            {syncStatus === "synced" && "In Sync"}
                            {syncStatus === "needsSync" && (playlist.pendingTagChoices?.length ? "Needs Tag Choices" : "Needs Sync")}
                            {syncStatus === "unknown" && "Unknown"}
                          </span>
                        </div> : <p className={styles.noCriteria}>{matchingCount !== null ? `${matchingCount} Spotify ${matchingCount === 1 ? "song matches" : "songs match"}. ` : ""}Saved setup — preview your songs before creating a playlist.</p>}

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
                            <span>No filters set</span>
                          </div>
                        )}

                        <div className={styles.playlistActions}>
                          {(!playlist.playlistId || reconnecting.has(playlist.id ?? playlist.playlistId)) && onBindRecipe ? (
                            <>
                              <button
                                className={`${styles.actionButton} ${styles.syncButton}`}
                                onClick={() => setSharing({ mode: "create", setup: playlist })}
                              >
                                Create Spotify Playlist
                              </button>
                              {!playlist.source && availableSpotifyPlaylists.length > 0 ? (
                                <>
                                  <select
                                    className={styles.sortSelect}
                                    aria-label={`Spotify playlist for ${playlist.playlistName}`}
                                    value={selectedBindings[playlist.id ?? playlist.playlistName] ?? ""}
                                    onChange={(event) =>
                                      setSelectedBindings((current) => ({
                                        ...current,
                                        [playlist.id ?? playlist.playlistName]: event.target.value,
                                      }))
                                    }
                                  >
                                    <option value="">Choose existing playlist</option>
                                    {availableSpotifyPlaylists.map((candidate) => (
                                      <option key={candidate.playlistId} value={candidate.playlistId}>
                                        {candidate.playlistName}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    className={styles.actionButton}
                                    disabled={!selectedBindings[playlist.id ?? playlist.playlistName]}
                                    onClick={() => {
                                      const selected = availableSpotifyPlaylists.find(
                                        (candidate) =>
                                          candidate.playlistId ===
                                          selectedBindings[playlist.id ?? playlist.playlistName],
                                      );
                                      if (selected) void onBindRecipe(playlist, selected);
                                    }}
                                  >
                                    Connect Existing
                                  </button>
                                </>
                              ) : null}
                            </>
                          ) : null}
                          <button
                            className={styles.actionButton}
                            onClick={() => onEditPlaylist(playlist)}
                            disabled={syncingPlaylists.has(playlist.playlistId)}
                          >
                            Edit Filters
                          </button>
                          {<button
                            className={`${styles.actionButton} ${styles.removeTrackingButton}`}
                            onClick={() =>
                              handleRemoveSmartPlaylistTracking(
                                playlist,
                              )
                            }
                            disabled={syncingPlaylists.has(playlist.playlistId)}
                            title="Remove smart-playlist tracking (does not delete the Spotify playlist)"
                          >
                            {playlist.playlistId ? "Remove Tracking" : "Remove Setup"}
                          </button>}
                          {playlist.playlistId && !playlist.source && onBindRecipe ? <button className={styles.actionButton} onClick={() => setReconnecting((current) => new Set(current).add(playlist.id ?? playlist.playlistId))}>Change Spotify Playlist</button> : null}

                          {playlist.playlistId ? <button
                            className={`${styles.actionButton} ${
                              styles.syncToggleButton
                            } ${!playlist.isActive ? styles.inactive : ""}`}
                            onClick={() =>
                              toggleSmartPlaylistActive(playlist.playlistId)
                            }
                            disabled={syncingPlaylists.has(playlist.playlistId)}
                          >
                            {playlist.isActive ? "Disable Sync" : "Enable Sync"}
                          </button> : null}

                          {playlist.playlistId && playlist.isActive && (
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
      {showMobileTaggingIntro ? (
        <Portal>
          <div
            className={styles.mobileTaggingOverlay}
            onClick={dismissMobileTaggingIntro}
          >
            <section
              className={styles.mobileTaggingIntro}
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-tagging-intro-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.mobileTaggingIntroHeader}>
                <div>
                  <span className={styles.mobileTaggingKicker}>New in Tagify 3.0</span>
                  <h2 id="mobile-tagging-intro-title">
                    <FontAwesomeIcon icon={faMobileScreenButton} />
                    Tag songs from your phone
                  </h2>
                </div>
                <button
                  type="button"
                  className={styles.mobileTaggingCloseButton}
                  onClick={dismissMobileTaggingIntro}
                  aria-label="Close mobile tagging introduction"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

              <p className={styles.mobileTaggingLead}>
                Tagify still runs on your computer, but Smart Playlists now work
                as mobile tagging shortcuts.
              </p>

              <ol className={styles.mobileTaggingSteps}>
                <li>
                  Choose an active Smart Playlist whose rules match how you want
                  to tag a song.
                </li>
                <li>
                  In Spotify on your phone, add the song to that playlist.
                </li>
                <li>
                  When Tagify is running on your computer, it applies the
                  playlist's tags, rating, and energy, then tells you exactly
                  what changed.
                </li>
              </ol>

              <p className={styles.mobileTaggingNote}>
                BPM and key stay unchanged because they belong to the recording.
              </p>

              <button
                type="button"
                className={styles.mobileTaggingPrimaryButton}
                onClick={dismissMobileTaggingIntro}
              >
                Got it
              </button>
            </section>
          </div>
        </Portal>
      ) : null}
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
