import { connectExistingSmartPlaylist } from "@/features/smart-playlists";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./TrackList.module.css";
import { GettingStartedQuestion } from "@/features/discovery-survey";
import { parseLocalFileUri } from "@/utils/LocalFileParser";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
import type { SmartPlaylistImportSummary } from "@/features/smart-playlists";
import { createSharedSmartPlaylist, type SmartPlaylistRecipeSelection } from "@/features/smart-playlists";
import { TagTaxonomy } from "@/types/tagData";
import { CreatePlaylistModal } from "@/features/playlist-state";
import { trackService } from "@/services/TrackService";
import { spotifyService } from "@/services/SpotifyService";
import {
  PAGINATION_BATCH_SIZE,
  SORT_OPTIONS,
  SORT_ORDERS,
  SortOption,
} from "@/constants/trackList";
import ReactStars from "react-rating-stars-component";
import { SmartPlaylistModal } from "@/features/smart-playlists";
import { collectMatchingTrackUris } from "@/features/smart-playlists";
import type { SpotifyPlaylistReference } from "@/features/smart-playlists";
import { formatTimestamp } from "@/utils/formatters";
import { revealElement } from "@/utils/revealElement";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBoltLightning,
  faFloppyDisk,
  faXmark,
  faStar,
  faStarHalf,
} from "@fortawesome/free-solid-svg-icons";
import { normalizeCamelotKey } from "@/utils/camelotKey";
import {
  TAG_FILTER_OPERATORS,
  TagFilterClause,
  TagFilterFormula,
  formatTagFilterFormula,
} from "@/utils/tagFilterGroups";
import { useTrackListControls } from "@/features/track-session/hooks/useTrackListControls";
import {
  buildTagDisplayLookup,
  buildSmartPlaylistCriteria,
  buildTagPositionLookup,
  buildTrackInfoMap,
  collectTrackFilterData,
  filterTrackEntries,
  getResolvedTrackTags,
  hasIncompleteTags,
  sortResolvedTags,
  sortTrackEntries,
} from "@/features/track-session/utils/trackList.logic";
import {
  TagDisplayInfo,
  TrackListTrackData,
} from "@/features/track-session/model/trackList.types";
import { buildTagAccentCssVars } from "@/features/tag-data";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { collapseRecordingEntries, recordingDisplayKeys } from "@/features/recording-reuse/utils/recordingLibrary";
import { usePrivateNotePreviews } from "@/features/private-notes/hooks/usePrivateNotePreviews";
import { PrivateNotePreview, PrivateNotePreviewError } from "@/features/private-notes/components/PrivateNotePreview";

const CAMELOT_KEY_LINE_A = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}A`,
);
const CAMELOT_KEY_LINE_B = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}B`,
);
const TAG_FILTER_EDITOR_MODE_STORAGE_KEY = "tagify:tagFilterEditorMode";
const BASIC_TAG_FILTER_OPERATOR_STORAGE_KEY = "tagify:basicTagFilterOperator";

type TagFilterEditorMode = "basic" | "complex";

function dedupeTagIds(tagIds: string[]): string[] {
  return Array.from(new Set(tagIds));
}

function inferBasicClauseOperator(
  clauses: TagFilterClause[],
  connectors: ("AND" | "OR")[],
): "AND" | "OR" {
  const positiveClauses = clauses.filter((clause) => clause.tagIds.length > 0);

  if (positiveClauses.length === 0) {
    return TAG_FILTER_OPERATORS.OR;
  }

  if (positiveClauses.length === 1) {
    return positiveClauses[0].operator;
  }

  const usesOrLogic =
    connectors.includes(TAG_FILTER_OPERATORS.OR) ||
    positiveClauses.some((clause) => clause.operator === TAG_FILTER_OPERATORS.OR);

  return usesOrLogic ? TAG_FILTER_OPERATORS.OR : TAG_FILTER_OPERATORS.AND;
}

function buildBasicFormula(
  clauses: TagFilterClause[],
  connectors: ("AND" | "OR")[],
): TagFilterFormula {
  const tagIds = dedupeTagIds(clauses.flatMap((clause) => clause.tagIds));
  const excludedTagIds = dedupeTagIds(
    clauses.flatMap((clause) => clause.excludedTagIds),
  );

  if (tagIds.length === 0 && excludedTagIds.length === 0) {
    return {
      clauses: [],
      connectors: [],
    };
  }

  return {
    clauses: [
      {
        tagIds,
        excludedTagIds,
        operator: inferBasicClauseOperator(clauses, connectors),
      },
    ],
    connectors: [],
  };
}

interface TrackListProps {
  tracks: { [uri: string]: TrackListTrackData };
  taxonomy: TagTaxonomy;
  includeTagClauses: TagFilterClause[];
  clauseConnectors: ("AND" | "OR")[];
  activeTagFilters: string[];
  excludedTagFilters: string[];
  selectedClauseIndex: number | null;
  activeTrackUri: string | null;
  onAddIncludeClause: (
    operator?: "AND" | "OR",
    connector?: "AND" | "OR",
  ) => void;
  onRemoveIncludeClause: (clauseIndex: number) => void;
  onSelectClause: (clauseIndex: number | null) => void;
  onSetIncludeClauseOperator: (
    clauseIndex: number,
    operator: "AND" | "OR",
  ) => void;
  onSetClauseConnector: (
    connectorIndex: number,
    operator: "AND" | "OR",
  ) => void;
  onRemoveTagFilter: (fullTagId: string) => void;
  onToggleTagIncludeOff: (fullTagId: string) => void;
  onMoveTagToClauseLane: (
    fullTagId: string,
    lane: "include" | "exclude",
    clauseIndex?: number,
  ) => void;
  onReplaceTagFilterFormula: (
    formula: TagFilterFormula,
    options?: {
      selectedClauseIndex?: number | null;
    },
  ) => void;
  onPlayTrack: (uri: string) => void;
  onTagTrack: (uri: string) => void;
  onClearTagFilters: () => void;
  onCreatePlaylist: (
    trackUris: string[],
    name: string,
    description: string,
    isPublic: boolean,
    isSmartPlaylist: boolean,
  ) => Promise<string | null>;
  onCreateSmartPlaylist: (criteria: SmartPlaylistCriteria) => Promise<void>;
  smartPlaylists: SmartPlaylistCriteria[];
  onSetSmartPlaylists: (value: React.SetStateAction<SmartPlaylistCriteria[]>) => Promise<void>;
  onSyncPlaylist: (playlist: SmartPlaylistCriteria) => Promise<void>;
  onExportSmartPlaylists: (taxonomy: TagTaxonomy, selected?: SmartPlaylistCriteria[], personalBackup?: boolean) => Promise<void> | void;
  onImportSmartPlaylists: (
    data: unknown,
    selections?: SmartPlaylistRecipeSelection[],
  ) => Promise<SmartPlaylistImportSummary>;
  requestedSmartPlaylistEditId?: string | null;
  onSmartPlaylistEditRequestHandled?: () => void;
  /**
   * Tracks opened from Stats; while set, the list shows only these. A new id starts from clear
   * filters and scrolls the list into view, unless `reveal` is "track" (a song was opened instead).
   */
  statsTrackSet?: { id: number; label: string; trackUris: string[]; reveal?: "list" | "track" } | null;
  onClearStatsTrackSet?: () => void;
  onReturnToStats?: () => void;
}

const TrackList: React.FC<TrackListProps> = ({
  tracks,
  taxonomy,
  includeTagClauses,
  clauseConnectors,
  activeTagFilters,
  excludedTagFilters,
  selectedClauseIndex,
  activeTrackUri,
  onAddIncludeClause,
  onRemoveIncludeClause,
  onSelectClause,
  onSetIncludeClauseOperator,
  onSetClauseConnector,
  onRemoveTagFilter,
  onToggleTagIncludeOff,
  onMoveTagToClauseLane,
  onReplaceTagFilterFormula,
  onPlayTrack,
  onTagTrack,
  onClearTagFilters,
  onCreatePlaylist,
  onCreateSmartPlaylist,
  smartPlaylists,
  onSetSmartPlaylists,
  onSyncPlaylist,
  onExportSmartPlaylists,
  onImportSmartPlaylists,
  requestedSmartPlaylistEditId = null,
  onSmartPlaylistEditRequestHandled,
  statsTrackSet = null,
  onClearStatsTrackSet,
  onReturnToStats,
}) => {
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] =
    useState<boolean>(false);
  const [showSmartPlaylistModal, setShowSmartPlaylistModal] =
    useState<boolean>(false);
  const [editingSmartPlaylist, setEditingSmartPlaylist] =
    useState<SmartPlaylistCriteria | null>(null);
  const handledSmartPlaylistEditRequestRef = useRef<string | null>(null);
  const [tagFilterEditorMode, setTagFilterEditorMode] =
    useLocalStorage<TagFilterEditorMode>(
      TAG_FILTER_EDITOR_MODE_STORAGE_KEY,
      "basic",
    );
  const [basicTagFilterOperator, setBasicTagFilterOperator] = useLocalStorage<
    "AND" | "OR"
  >(BASIC_TAG_FILTER_OPERATOR_STORAGE_KEY, TAG_FILTER_OPERATORS.OR);
  const observerRef = useRef<HTMLDivElement>(null);

  const {
    searchTerm,
    setSearchTerm,
    displayCount,
    setDisplayCount,
    ratingFilters,
    setRatingFilters,
    energyMinFilter,
    setEnergyMinFilter,
    energyMaxFilter,
    setEnergyMaxFilter,
    showFilterOptions,
    setShowFilterOptions,
    tagSearchTerm,
    setTagSearchTerm,
    bpmMinFilter,
    setBpmMinFilter,
    bpmMaxFilter,
    setBpmMaxFilter,
    setCamelotKeyFilters,
    showAdvancedFilters,
    setShowAdvancedFilters,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    normalizedCamelotKeyFilters,
    selectedCamelotKeySet,
    toggleRatingFilter,
    handleEnergyMinChange,
    handleEnergyMaxChange,
    handleBpmMinChange,
    handleBpmMaxChange,
    toggleCamelotKeyFilter,
    clearAllFilters,
    activeFilterCount,
  } = useTrackListControls({
    includeTagClauses,
    clauseConnectors,
    activeTagFilters,
    excludedTagFilters,
    onClearTagFilters,
  });

  const deferredTracks = useDeferredValue(tracks);
  const trackEntries = useMemo(
    () => Object.entries(deferredTracks),
    [deferredTracks],
  );
  const statsTrackUris = useMemo(() => statsTrackSet ? new Set(statsTrackSet.trackUris) : null, [statsTrackSet]);
  // Search, filters and sorting still work inside a set opened from Stats.
  const listedEntries = useMemo(
    () => statsTrackUris ? trackEntries.filter(([uri]) => statsTrackUris.has(uri)) : trackEntries,
    [trackEntries, statsTrackUris],
  );
  // Opening a new set from Stats starts from clear filters, so the list shows exactly what Stats
  // counted, and brings the list into view so it's clear where the tracks went. Runs once per
  // newly opened set.
  const statsTrackSetId = statsTrackSet?.id ?? null;
  const revealStatsList = statsTrackSet?.reveal !== "track";
  const lastStatsTrackSetId = useRef<number | null>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const statsTitleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (statsTrackSetId === null || statsTrackSetId === lastStatsTrackSetId.current) return;
    lastStatsTrackSetId.current = statsTrackSetId;
    clearAllFilters();
    if (!revealStatsList) return;
    const frame = requestAnimationFrame(() => {
      revealElement(listContainerRef.current);
      statsTitleRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [statsTrackSetId]);

  const tagDisplayLookup = useMemo(() => buildTagDisplayLookup(taxonomy), [taxonomy]);
  const customAccentsById = taxonomy.customAccentsById;
  const filterTagDisplayLookup = useMemo(
    () => buildTagDisplayLookup(taxonomy, { disambiguate: true }),
    [taxonomy],
  );
  const tagPositionLookup = useMemo(
    () => buildTagPositionLookup(taxonomy),
    [taxonomy],
  );
  const trackInfo = useMemo(() => buildTrackInfoMap(trackEntries), [trackEntries]);

  const filterTagBySearch = (tagName: string) => {
    if (!tagSearchTerm || typeof tagSearchTerm !== "string") return true;
    if (!tagSearchTerm.trim()) return true;
    return tagName.toLowerCase().includes(tagSearchTerm.toLowerCase());
  };

  const recordingKeys = useMemo(() => recordingDisplayKeys(deferredTracks), [deferredTracks]);
  const uniqueTrackCount = useMemo(() => collapseRecordingEntries(trackEntries, recordingKeys).length, [trackEntries, recordingKeys]);
  const listedUniqueCount = useMemo(() => collapseRecordingEntries(listedEntries, recordingKeys).length, [listedEntries, recordingKeys]);
  const matchingTracks = useMemo(
    () =>
      filterTrackEntries(listedEntries, trackInfo, {
        includeTagClauses,
        clauseConnectors,
        ratingFilters,
        energyMinFilter,
        energyMaxFilter,
        bpmMinFilter,
        bpmMaxFilter,
        normalizedCamelotKeyFilters,
        searchTerm,
      }),
    [
      listedEntries,
      trackInfo,
      includeTagClauses,
      clauseConnectors,
      ratingFilters,
      energyMinFilter,
      energyMaxFilter,
      bpmMinFilter,
      bpmMaxFilter,
      normalizedCamelotKeyFilters,
      searchTerm,
    ],
  );

  const filteredTracks = useMemo(
    () => collapseRecordingEntries(sortTrackEntries(matchingTracks, trackInfo, { sortBy, sortOrder }), recordingKeys),
    [matchingTracks, trackInfo, sortBy, sortOrder, recordingKeys],
  );
  const allSortedTracks = filteredTracks;
  const sortedTracksVisible = useMemo(
    () => allSortedTracks.slice(0, displayCount),
    [allSortedTracks, displayCount],
  );
  const visibleNoteUris = useMemo(() => {
    const members = new Map<string, string[]>();
    for (const [uri] of trackEntries) {
      const key = recordingKeys.get(uri) || uri;
      const copies = members.get(key) || [];
      copies.push(uri);
      members.set(key, copies);
    }
    return new Map(sortedTracksVisible.map(([uri]) => [uri, members.get(recordingKeys.get(uri) || uri) || [uri]]));
  }, [trackEntries, recordingKeys, sortedTracksVisible]);
  const notePreviews = usePrivateNotePreviews([...visibleNoteUris.values()].flat());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          sortedTracksVisible.length < filteredTracks.length
        ) {
          // User has scrolled to the observer element
          setDisplayCount((prev) =>
            Math.min(prev + PAGINATION_BATCH_SIZE, filteredTracks.length),
          );
        }
      },
      { threshold: 0.5 },
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => {
      if (observerRef.current) {
        observer.unobserve(observerRef.current);
      }
    };
  }, [sortedTracksVisible.length, filteredTracks.length]);

  const {
    allUniqueTagsMap,
    allRatings,
    allEnergyLevels,
    allBpmValues,
    allCamelotKeys,
  } = useMemo(
    () => collectTrackFilterData(trackEntries, filterTagDisplayLookup),
    [filterTagDisplayLookup, trackEntries],
  );

  const allCamelotKeySet = useMemo(
    () => new Set(allCamelotKeys),
    [allCamelotKeys],
  );

  const getTagDisplayInfo = (fullTagId: string): TagDisplayInfo =>
    allUniqueTagsMap.get(fullTagId) ||
    filterTagDisplayLookup.get(fullTagId) || {
      displayName: fullTagId,
      accentId: null,
    };

  const activeTagDisplayNames = activeTagFilters.map((fullTagId) =>
    getTagDisplayInfo(fullTagId).displayName,
  );
  const activeTagFormula = formatTagFilterFormula(
    {
      clauses: includeTagClauses,
      connectors: clauseConnectors,
    },
    (tagId) => getTagDisplayInfo(tagId).displayName,
  );
  const resolvedSelectedClauseIndex =
    selectedClauseIndex !== null &&
    selectedClauseIndex >= 0 &&
    selectedClauseIndex < includeTagClauses.length
      ? selectedClauseIndex
      : includeTagClauses.length > 0
        ? 0
        : null;
  const tagLocationLookup = useMemo(() => {
    const lookup = new Map<string, { clauseIndex: number; lane: "include" | "exclude" }>();

    includeTagClauses.forEach((clause, clauseIndex) => {
      clause.tagIds.forEach((tagId) => {
        lookup.set(tagId, { clauseIndex, lane: "include" });
      });
      clause.excludedTagIds.forEach((tagId) => {
        lookup.set(tagId, { clauseIndex, lane: "exclude" });
      });
    });

    return lookup;
  }, [includeTagClauses]);
  const selectedClause =
    resolvedSelectedClauseIndex !== null
      ? includeTagClauses[resolvedSelectedClauseIndex] ?? null
      : null;
  const canUseBasicMode = includeTagClauses.length <= 1;
  const basicClause = includeTagClauses[0] ?? {
    tagIds: [],
    excludedTagIds: [],
    operator: basicTagFilterOperator,
  };
  useEffect(() => {
    const currentBasicOperator = includeTagClauses[0]?.operator;

    if (currentBasicOperator) {
      setBasicTagFilterOperator(currentBasicOperator);
    }
  }, [includeTagClauses, setBasicTagFilterOperator]);

  const formatClausePreview = (clause: TagFilterClause): string =>
    formatTagFilterFormula(
      {
        clauses: [clause],
        connectors: [],
      },
      (tagId) => getTagDisplayInfo(tagId).displayName,
    );
  const selectedClausePreview = selectedClause
    ? formatClausePreview(selectedClause)
    : "";
  const visibleTagEntries = useMemo(
    () =>
      Array.from(allUniqueTagsMap.entries())
        .sort(([, left], [, right]) =>
          left.displayName.localeCompare(right.displayName),
        )
        .filter(([, tagInfo]) => filterTagBySearch(tagInfo.displayName)),
    [allUniqueTagsMap, tagSearchTerm],
  );
  const selectedClauseLabel =
    resolvedSelectedClauseIndex === null
      ? "group 1"
      : `group ${resolvedSelectedClauseIndex + 1}`;
  const cycleCatalogTag = (
    fullTagId: string,
    targetClauseIndex: number | null,
  ) => {
    const location = tagLocationLookup.get(fullTagId);

    if (
      location &&
      targetClauseIndex !== null &&
      location.clauseIndex === targetClauseIndex
    ) {
      if (location.lane === "include") {
        onMoveTagToClauseLane(fullTagId, "exclude", targetClauseIndex);
      } else {
        onRemoveTagFilter(fullTagId);
      }
      return;
    }

    onMoveTagToClauseLane(
      fullTagId,
      "include",
      targetClauseIndex ?? undefined,
    );
  };
  const handleCatalogTagClick = (fullTagId: string) => {
    cycleCatalogTag(fullTagId, resolvedSelectedClauseIndex);
  };
  const handleBasicCatalogTagClick = (fullTagId: string) => {
    const location = tagLocationLookup.get(fullTagId);

    if (location?.clauseIndex === 0) {
      cycleCatalogTag(fullTagId, 0);
      return;
    }

    if (includeTagClauses.length === 0) {
      onReplaceTagFilterFormula(
        {
          clauses: [
            {
              tagIds: [fullTagId],
              excludedTagIds: [],
              operator: basicTagFilterOperator,
            },
          ],
          connectors: [],
        },
        {
          selectedClauseIndex: 0,
        },
      );
      return;
    }

    cycleCatalogTag(fullTagId, 0);
  };
  const renderAppliedTagFilters = (
    clause: TagFilterClause,
    clauseIndex: number,
  ) => {
    const appliedTags = [
      ...clause.tagIds.map((tagId) => ({
        tagId,
        state: "MATCH" as const,
      })),
      ...clause.excludedTagIds.map((tagId) => ({
        tagId,
        state: "NOT" as const,
      })),
    ];

    return (
      <div
        className={styles.appliedFilters}
        aria-label="Applied tag filters"
      >
        <span className={styles.appliedFiltersLabel}>Applied filters</span>
        <div className={styles.appliedFilterChips}>
          {appliedTags.length > 0 ? (
            appliedTags.map(({ tagId, state }) => {
              const tagInfo = getTagDisplayInfo(tagId);
              const isExcluded = state === "NOT";

              return (
                <button
                  key={`${clauseIndex}-${state}-${tagId}`}
                  className={`${styles.appliedFilterChip} ${
                    isExcluded ? styles.appliedFilterChipNegative : ""
                  } ${
                    tagInfo.accentId ? styles.appliedFilterChipAccented : ""
                  }`}
                  style={buildTagAccentCssVars(
                    tagInfo.accentId,
                    customAccentsById,
                  )}
                  onClick={() => onRemoveTagFilter(tagId)}
                  aria-label={`${state} ${tagInfo.displayName} applied filter`}
                  title={`Remove "${tagInfo.displayName}" filter`}
                >
                  <span className={styles.appliedFilterName}>
                    {tagInfo.displayName}
                  </span>
                </button>
              );
            })
          ) : (
            <span className={styles.appliedFiltersEmpty}>
              No tag filters applied
            </span>
          )}
        </div>
      </div>
    );
  };
  const handleClauseCardKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    clauseIndex: number,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onSelectClause(clauseIndex);
  };
  const handleSetBasicClauseOperator = (operator: "AND" | "OR") => {
    setBasicTagFilterOperator(operator);

    if (includeTagClauses.length === 0) {
      onSelectClause(null);
      return;
    }

    onSetIncludeClauseOperator(0, operator);
    onSelectClause(0);
  };
  const handleEditorModeChange = (nextMode: TagFilterEditorMode) => {
    if (nextMode === tagFilterEditorMode) {
      return;
    }

    if (nextMode === "complex") {
      setTagFilterEditorMode("complex");
      if (includeTagClauses.length > 0) {
        onSelectClause(resolvedSelectedClauseIndex ?? 0);
      }
      return;
    }

    if (canUseBasicMode) {
      setTagFilterEditorMode("basic");
      onSelectClause(includeTagClauses.length > 0 ? 0 : null);
      return;
    }

    const confirmed = window.confirm(
      'Switching to Basic mode will collapse your current multi-group logic into one Match Any/All filter. Continue?',
    );
    if (!confirmed) {
      return;
    }

    const nextFormula = buildBasicFormula(includeTagClauses, clauseConnectors);
    onReplaceTagFilterFormula(nextFormula, {
      selectedClauseIndex: nextFormula.clauses.length > 0 ? 0 : null,
    });
    setTagFilterEditorMode("basic");
  };

  useEffect(() => {
    if (!canUseBasicMode && tagFilterEditorMode === "basic") {
      setTagFilterEditorMode("complex");
    }
  }, [canUseBasicMode, tagFilterEditorMode, setTagFilterEditorMode]);

  const handleCreatePlaylist = async (
    playlistName: string,
    description: string,
    isPublic: boolean,
    isSmartPlaylist: boolean,
  ) => {
    setShowCreatePlaylistModal(false);

    if (editingSmartPlaylist) {
      const updatedPlaylist: SmartPlaylistCriteria = {
        ...editingSmartPlaylist,
        criteria: buildSmartPlaylistCriteria({
          playlistId: editingSmartPlaylist.playlistId,
          playlistName: editingSmartPlaylist.playlistName,
          trackUris: editingSmartPlaylist.smartPlaylistTrackUris,
          includeTagClauses,
          clauseConnectors,
          ratingFilters,
          energyMinFilter,
          energyMaxFilter,
          bpmMinFilter,
          bpmMaxFilter,
          normalizedCamelotKeyFilters,
        }).criteria,
      };
      try {
        await onSetSmartPlaylists((current) => current.map((playlist) =>
          (updatedPlaylist.id
            ? playlist.id === updatedPlaylist.id
            : playlist.playlistId === updatedPlaylist.playlistId)
            ? updatedPlaylist
            : playlist,
        ));
      } catch (error) {
        console.error("Could not save smart playlist changes:", error);
        Spicetify.showNotification("Tagify couldn't save those Smart Playlist changes. Please try again.", true);
        return;
      }
      setEditingSmartPlaylist(null);

      if (updatedPlaylist.isActive) {
        await onSyncPlaylist(updatedPlaylist);
      }

      Spicetify.showNotification(
        `Saved filter changes to "${updatedPlaylist.playlistName}"`,
      );
      return;
    }

    if (filteredTracks.length === 0) return;

    const trackUris: string[] = filteredTracks.map(([uri]) => uri);
    const playlistId: string | null = await onCreatePlaylist(
      trackUris,
      playlistName,
      description,
      isPublic,
      isSmartPlaylist,
    );

    if (isSmartPlaylist && playlistId) {
      const smartPlaylistCriteria: SmartPlaylistCriteria =
        buildSmartPlaylistCriteria({
          playlistId,
          playlistName,
          trackUris,
          includeTagClauses,
          clauseConnectors,
          ratingFilters,
          energyMinFilter,
          energyMaxFilter,
          bpmMinFilter,
          bpmMaxFilter,
          normalizedCamelotKeyFilters,
        });
      try {
        await onCreateSmartPlaylist(smartPlaylistCriteria);
        Spicetify.showNotification(
          `Created smart playlist "${playlistName}" with ${trackUris.filter((uri) => !uri.startsWith("spotify:local:")).length} ${trackUris.filter((uri) => !uri.startsWith("spotify:local:")).length === 1 ? "track" : "tracks"}.${trackUris.some((uri) => uri.startsWith("spotify:local:")) ? " Local tracks need to be added manually." : ""}`,
        );
        if (!trackUris.some((uri) => uri.startsWith("spotify:local:"))) {
          Spicetify.Platform.History.push(`/playlist/${playlistId}`);
        }
      } catch (error) {
        console.error("Could not save smart playlist:", error);
        Spicetify.showNotification(
          "The Spotify playlist was created, but Tagify couldn't keep it updated. Check available storage and try again.",
          true,
        );
      }
    }
  };

  const handleCreatePlaylistClick = () => {
    if (filteredTracks.length > 0 || editingSmartPlaylist) {
      setShowCreatePlaylistModal(true);
    }
  };

  const handleCloseCreatePlaylistModal = () => {
    setShowCreatePlaylistModal(false);
    setEditingSmartPlaylist(null);
  };

  const handleEditSmartPlaylist = useCallback(
    (playlist: SmartPlaylistCriteria) => {
      // Editing a smart playlist works on filters across the whole library.
      onClearStatsTrackSet?.();
      onReplaceTagFilterFormula({
        clauses: playlist.criteria.includeTagClauses,
        connectors: playlist.criteria.clauseConnectors,
      });
      setRatingFilters(playlist.criteria.ratingFilters);
      setEnergyMinFilter(playlist.criteria.energyMinFilter);
      setEnergyMaxFilter(playlist.criteria.energyMaxFilter);
      setBpmMinFilter(playlist.criteria.bpmMinFilter);
      setBpmMaxFilter(playlist.criteria.bpmMaxFilter);
      setCamelotKeyFilters(playlist.criteria.camelotKeyFilters ?? []);
      setShowFilterOptions(true);
      setShowAdvancedFilters(
        playlist.criteria.bpmMinFilter !== null ||
          playlist.criteria.bpmMaxFilter !== null ||
          (playlist.criteria.camelotKeyFilters?.length ?? 0) > 0,
      );
      setEditingSmartPlaylist(playlist);
      setShowSmartPlaylistModal(false);
    },
    [
      onClearStatsTrackSet,
      onReplaceTagFilterFormula,
      setBpmMaxFilter,
      setBpmMinFilter,
      setCamelotKeyFilters,
      setEnergyMaxFilter,
      setEnergyMinFilter,
      setRatingFilters,
      setShowAdvancedFilters,
      setShowFilterOptions,
    ],
  );

  const handleBindSmartPlaylistRecipe = useCallback(
    async (
      playlist: SmartPlaylistCriteria,
      existingPlaylist?: SpotifyPlaylistReference,
    ) => {
      if (existingPlaylist) {
        if (!playlist.id) throw new Error("Open this saved setup again before connecting its playlist.");
        await connectExistingSmartPlaylist(playlist.id, existingPlaylist);
        return;
      }
      if (playlist.source) {
        if (!playlist.id) throw new Error("Open this saved setup again before creating its playlist.");
        const created = await createSharedSmartPlaylist(playlist.id);
        Spicetify.Platform.History.push(`/playlist/${created.playlistId}`);
        return;
      }
      const matchingTrackUris = collectMatchingTrackUris(tracks, playlist.criteria);
      const playlistId =
        (await onCreatePlaylist(
          matchingTrackUris,
          playlist.playlistName,
          playlist.description ?? "Created from a Tagify smart-playlist recipe",
          false,
          true,
        ));
      if (!playlistId) return;
      const bound = {
        ...playlist,
        playlistId,
        playlistName: playlist.playlistName,
        isActive: true,
        lastSyncAt: 0,
        smartPlaylistTrackUris: matchingTrackUris,
        pendingTagChoices: [],
        updatedAt: Date.now(),
      };
      try {
        await onSetSmartPlaylists((current) => current.map((candidate) =>
          candidate.id === playlist.id ? bound : candidate,
        ));
        await onSyncPlaylist(bound);
        if (!matchingTrackUris.some((uri) => uri.startsWith("spotify:local:"))) {
          Spicetify.Platform.History.push(`/playlist/${playlistId}`);
        }
      } catch (error) {
        console.error("Could not connect smart playlist:", error);
        Spicetify.showNotification("Tagify couldn't connect this Smart Playlist. Please try again.", true);
      }
    },
    [onCreatePlaylist, onSetSmartPlaylists, onSyncPlaylist, smartPlaylists, tracks],
  );

  useEffect(() => {
    if (!requestedSmartPlaylistEditId) {
      handledSmartPlaylistEditRequestRef.current = null;
      return;
    }

    if (
      handledSmartPlaylistEditRequestRef.current ===
      requestedSmartPlaylistEditId
    ) {
      return;
    }

    const requestedPlaylist = smartPlaylists.find(
      (playlist) => playlist.playlistId === requestedSmartPlaylistEditId,
    );

    if (requestedPlaylist) {
      handledSmartPlaylistEditRequestRef.current = requestedSmartPlaylistEditId;
      handleEditSmartPlaylist(requestedPlaylist);
      onSmartPlaylistEditRequestHandled?.();
      return;
    }

    // Smart playlists hydrate from storage after the first render.
    if (smartPlaylists.length > 0) {
      handledSmartPlaylistEditRequestRef.current = requestedSmartPlaylistEditId;
      Spicetify.showNotification(
        "This Smart Playlist could not be found in Tagify.",
        true,
      );
      onSmartPlaylistEditRequestHandled?.();
    }
  }, [
    handleEditSmartPlaylist,
    onSmartPlaylistEditRequestHandled,
    requestedSmartPlaylistEditId,
    smartPlaylists,
  ]);

  const handleSmartPlaylistClick = async () => {
    setShowSmartPlaylistModal(true);
  };

  const navigateToAlbum = async (uri: string) => {
    try {
      if (uri.startsWith("spotify:local:")) {
        Spicetify.Platform.History.push("/collection/local-files");
        return;
      }

      const albumUri = await spotifyService.getTrackAlbumUri(uri);
      if (albumUri) {
        const albumId = albumUri.split(":").pop();
        if (albumId) {
          Spicetify.Platform.History.push(`/album/${albumId}`);
        }
      }
    } catch (error) {
      console.error("Error navigating to album:", error);
    }
  };

  const navigateToArtist = async (artistName: string, trackUri: string) => {
    try {
      if (trackUri.startsWith("spotify:local:")) {
        Spicetify.showNotification(
          "Cannot navigate to artist for local files",
          true,
        );
        return;
      }

      const artists = await spotifyService.getTrackArtists(trackUri);
      const artist = artists.find((a) => a.name === artistName);

      if (artist?.uri) {
        const artistId = artist.uri.split(":").pop();
        if (artistId) {
          Spicetify.Platform.History.push(`/artist/${artistId}`);
          return;
        }
      }

      // fallback: search for the artist
      Spicetify.Platform.History.push(
        `/search/${encodeURIComponent(artistName)}/artists`,
      );
    } catch (error) {
      console.error("Error navigating to artist:", error);
    }
  };

  const playAllFilteredTracks = async (): Promise<void> => {
    if (allSortedTracks.length === 0) return;

    const trackUris = allSortedTracks.map(([uri]) => uri);
    await trackService.playAllFilteredTracks(trackUris);
  };

  return (
    <div ref={listContainerRef} className={styles.container}>
      <div className={styles.filterControlsGrid}>
        {/* HEADER */}
        <div className={styles.filterControlsLeftGrid}>
          <div className={styles.header}>
            <div className={styles.titleSection}>
              {statsTrackSet ? (
                <>
                  {onReturnToStats && (
                    <button type="button" className={styles.statsBack} onClick={onReturnToStats}>
                      <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" /> Back to Stats
                    </button>
                  )}
                  <h2 ref={statsTitleRef} tabIndex={-1} className={`${styles.title} ${styles.statsTitle}`}>{statsTrackSet.label}</h2>
                  <span className={styles.statsMeta}>
                    <span className={styles.trackCount}>
                      {searchTerm.trim() !== ""
                        ? `${filteredTracks.length} of ${listedUniqueCount} tracks`
                        : `${listedUniqueCount} ${listedUniqueCount === 1 ? "track" : "tracks"}`}
                    </span>
                    <button type="button" className={styles.statsShowAll} onClick={() => { setSearchTerm(""); onClearStatsTrackSet?.(); }}>
                      <FontAwesomeIcon icon={faXmark} aria-hidden="true" /> Show all tracks
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <h2 className={styles.title}>Tagged Tracks</h2>
                  <span className={styles.trackCount}>
                    {activeFilterCount > 0 || searchTerm.trim() !== ""
                      ? `${filteredTracks.length}/${
                          uniqueTrackCount
                        } ${uniqueTrackCount === 1 ? "track" : "tracks"}`
                      : `${uniqueTrackCount} ${uniqueTrackCount === 1 ? "track" : "tracks"}`}
                  </span>
                </>
              )}
              {editingSmartPlaylist && (
                <span
                  className={styles.smartPlaylistEditingBadge}
                  role="status"
                  aria-label={`Editing ${editingSmartPlaylist.playlistName}`}
                >
                  <FontAwesomeIcon icon={faBoltLightning} />
                  <span className={styles.smartPlaylistEditingLabel}>
                    Editing {editingSmartPlaylist.playlistName}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className={styles.filterControlsCenterGrid}>
          {/* Play All button */}
          <button
            className={styles.playAllButton}
            onClick={playAllFilteredTracks}
            {...(filteredTracks.length > 0 && {
              title: `Play all ${filteredTracks.length} ${filteredTracks.length === 1 ? "track" : "tracks"}`,
            })}
            disabled={filteredTracks.length === 0}
          ></button>

          {/* Create Playlist button */}
          <button
            className={`${styles.createPlaylistButton} ${
              editingSmartPlaylist ? styles.saveSmartPlaylistButton : ""
            }`}
            onClick={handleCreatePlaylistClick}
            {...((filteredTracks.length > 0 || editingSmartPlaylist) && {
              title: editingSmartPlaylist
                ? `Save filters to ${editingSmartPlaylist.playlistName}`
                : `Create playlist with ${filteredTracks.length} ${filteredTracks.length === 1 ? "track" : "tracks"}`,
            })}
            disabled={filteredTracks.length === 0 && !editingSmartPlaylist}
          >
            {editingSmartPlaylist && <FontAwesomeIcon icon={faFloppyDisk} />}
            {editingSmartPlaylist ? "Save Smart Playlist" : "Create Playlist"}
          </button>

          {/* Smart Playlist button. A list from Stats isn't a set of filters, so it has none. */}
          {!statsTrackSet && (
            <button
              className={styles.smartPlaylistButton}
              onClick={handleSmartPlaylistClick}
              title={`Smart Playlists (${smartPlaylists.length})`}
            >
              <FontAwesomeIcon icon={faBoltLightning} />
            </button>
          )}
        </div>
        <div className={styles.filterControlsRightGrid}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder="Search tracks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={styles.searchInput}
            />
          </div>
        </div>
      </div>

      {/* FILTER CONTROLS */}
      <div className={styles.filterControlsGrid}>
        {/* Left zone - Filter toggle. A list from Stats already is the filter; search and sorting still apply. */}
        {!statsTrackSet && (
          <div className={styles.filterControlsLeftGrid}>
            <button
              className={`${styles.filterToggle} ${
                showFilterOptions ? styles.filterToggleActive : ""
              }`}
              onClick={() => setShowFilterOptions(!showFilterOptions)}
            >
              Filters{" "}
              {activeFilterCount > 0 && (
                <span className={styles.filterBadge}>{activeFilterCount}</span>
              )}
            </button>
          </div>
        )}

        {/* Center zone - active formula */}
        {/* Right zone - Sort controls */}
        <div className={styles.filterControlsRightGrid}>
          <label className={"form-label"}>Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className={"form-select"}
          >
            <option value={SORT_OPTIONS.DATE_MODIFIED}>Last updated</option>
            <option value={SORT_OPTIONS.DATE_CREATED}>Date created</option>
            <option value={SORT_OPTIONS.ALPHABETICAL}>Name</option>
            <option value={SORT_OPTIONS.RATING}>Rating</option>
            <option value={SORT_OPTIONS.ENERGY}>Energy</option>
            <option value={SORT_OPTIONS.BPM}>BPM</option>
          </select>

          <button
            className={styles.sortOrderButton}
            onClick={() =>
              setSortOrder(
                sortOrder == SORT_ORDERS.ASC
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
        </div>
      </div>
      {showFilterOptions && !statsTrackSet && (
        <div className={styles.filterOptions}>
          <div className={styles.filterOptionsTopRow}>
            {allRatings.size > 0 ? (
              <div className={`${styles.filterSection} ${styles.filterPrimarySection}`}>
                <h3 className={styles.filterSectionTitle}>Rating</h3>
                <div>
                  {Array.from(allRatings)
                    .sort((a, b) => b - a)
                    .map((rating) => (
                      <button
                        key={`rating-${rating}`}
                        className={`${styles.ratingFilter} ${
                          ratingFilters.includes(rating) ? styles.active : ""
                        }`}
                        onClick={() => toggleRatingFilter(rating)}
                      >
                        <ReactStars
                          count={5}
                          value={rating}
                          edit={false}
                          size={14}
                          isHalf={true}
                          emptyIcon={<FontAwesomeIcon icon={faStar} />}
                          halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                          fullIcon={<FontAwesomeIcon icon={faStar} />}
                          activeColor="#ffd700"
                          color="rgba(255, 255, 255, 0.2)"
                        />
                      </button>
                    ))}
                </div>
              </div>
            ) : null}

            <div className={styles.filterOptionsActions}>
              {activeFilterCount > 0 ? (
                <button
                  className={styles.clearFilters}
                  onClick={clearAllFilters}
                >
                  Clear All
                </button>
              ) : null}

              <button
                className={`${styles.advancedFiltersToggle} ${
                  showAdvancedFilters ? styles.advancedFiltersToggleActive : ""
                }`}
                onClick={() =>
                  setShowAdvancedFilters((previousValue) => !previousValue)
                }
                title={
                  showAdvancedFilters
                    ? "Hide advanced filters"
                    : "Show advanced filters"
                }
              >
                Advanced
              </button>
            </div>
          </div>

          {/* Energy and BPM filters in a horizontal container */}
          <div className={styles.filterSectionsRow}>
            {allEnergyLevels.size > 0 && (
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>Energy Level</h3>
                <div className={styles.rangeFilter}>
                  <div className={"form-field"}>
                    <label className={"form-label"}>From:</label>
                    <select
                      value={
                        energyMinFilter === null
                          ? ""
                          : energyMinFilter.toString()
                      }
                      onChange={handleEnergyMinChange}
                      className={"form-select"}
                    >
                      <option value="">Any</option>
                      {Array.from(allEnergyLevels)
                        .sort((a, b) => a - b)
                        .map((energy) => (
                          <option key={`min-${energy}`} value={energy}>
                            {energy}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className={"form-field"}>
                    <label className={"form-label"}>To:</label>
                    <select
                      value={
                        energyMaxFilter === null
                          ? ""
                          : energyMaxFilter.toString()
                      }
                      onChange={handleEnergyMaxChange}
                      className={"form-select"}
                    >
                      <option value="">Any</option>
                      {Array.from(allEnergyLevels)
                        .sort((a, b) => a - b)
                        .map((energy) => (
                          <option key={`max-${energy}`} value={energy}>
                            {energy}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* BPM Range Filter */}
            {allBpmValues.size > 0 && (
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>BPM Range</h3>
                <div className={styles.rangeFilter}>
                  <div className={"form-field"}>
                    <label className={"form-label"}>From:</label>
                    <select
                      value={
                        bpmMinFilter === null ? "" : bpmMinFilter.toString()
                      }
                      onChange={handleBpmMinChange}
                      className={"form-select"}
                    >
                      <option value="">Any</option>
                      {Array.from(allBpmValues)
                        .sort((a, b) => a - b)
                        .map((bpm) => (
                          <option key={`min-${bpm}`} value={bpm}>
                            {bpm}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className={"form-field"}>
                    <label className={"form-label"}>To:</label>
                    <select
                      value={
                        bpmMaxFilter === null ? "" : bpmMaxFilter.toString()
                      }
                      onChange={handleBpmMaxChange}
                      className={"form-select"}
                    >
                      <option value="">Any</option>
                      {Array.from(allBpmValues)
                        .sort((a, b) => a - b)
                        .map((bpm) => (
                          <option key={`max-${bpm}`} value={bpm}>
                            {bpm}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {showAdvancedFilters && (
            <div
              className={`${styles.filterSection} ${styles.keyFilterSection}`}
            >
              <div className={styles.keySectionHeader}>
                <div className={styles.keySectionMeta}>
                  <h3 className={styles.filterSectionTitle}>Camelot Keys</h3>
                </div>

                <div className={styles.keyHeaderActions}>
                  <button
                    className={styles.keyClearButton}
                    onClick={() => setCamelotKeyFilters([])}
                    title="Clear selected keys"
                    disabled={normalizedCamelotKeyFilters.length === 0}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className={styles.camelotLinePanel}>
                <div className={styles.camelotLineRows}>
                  {[CAMELOT_KEY_LINE_A, CAMELOT_KEY_LINE_B].map(
                    (camelotRow, rowIndex) => (
                      <div
                        key={`camelot-row-${rowIndex}`}
                        className={styles.camelotLine}
                      >
                        {camelotRow.map((camelotKey) => {
                          const hasKey = allCamelotKeySet.has(camelotKey);
                          return (
                            <button
                              key={`camelot-line-${camelotKey}`}
                              className={`${styles.camelotLineButton} ${
                                selectedCamelotKeySet.has(camelotKey)
                                  ? styles.camelotLineButtonActive
                                  : ""
                              } ${!hasKey ? styles.camelotLineButtonUnavailable : ""}`}
                              onClick={() =>
                                toggleCamelotKeyFilter(camelotKey)
                              }
                              disabled={!hasKey}
                              title={
                                hasKey
                                  ? `Filter by key ${camelotKey}`
                                  : `${camelotKey} not present in current tracks`
                              }
                            >
                              {camelotKey}
                            </button>
                          );
                        })}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          )}

          {allUniqueTagsMap.size > 0 && (
            <div className={styles.filterSection}>
              <div className={styles.tagSectionHeader}>
                <h3 className={styles.filterSectionTitle}>Tags</h3>
                <div className={styles.filterModeToggle}>
                  <button
                    className={`${styles.filterModeButton} ${
                      tagFilterEditorMode === "basic"
                        ? styles.activeFilterMode
                        : ""
                    }`}
                    onClick={() => handleEditorModeChange("basic")}
                    title="Use the simple one-group tag filter"
                  >
                    Basic
                  </button>
                  <button
                    className={`${styles.filterModeButton} ${
                      tagFilterEditorMode === "complex"
                        ? styles.activeFilterMode
                        : ""
                    }`}
                    onClick={() => handleEditorModeChange("complex")}
                    title="Use multi-group AND/OR logic"
                  >
                    Complex
                  </button>
                </div>
              </div>

              <div className={styles.groupBuilder}>

                {tagFilterEditorMode === "basic" ? (
                  <>
                      <div className={styles.editorPanel}>
                        <div className={styles.editorPanelHeader}>
                          {renderAppliedTagFilters(basicClause, 0)}
                          <div className={styles.editorPanelControls}>
                          <div className={styles.operatorToggle}>
                            <button
                              className={`${styles.operatorToggleButton} ${
                                basicClause.operator === TAG_FILTER_OPERATORS.OR
                                  ? styles.operatorToggleButtonActive
                                  : ""
                              }`}
                              onClick={() =>
                                handleSetBasicClauseOperator(
                                  TAG_FILTER_OPERATORS.OR,
                                )
                              }
                            >
                              Match Any
                            </button>
                            <button
                              className={`${styles.operatorToggleButton} ${
                                basicClause.operator === TAG_FILTER_OPERATORS.AND
                                  ? styles.operatorToggleButtonActive
                                  : ""
                              }`}
                              onClick={() =>
                                handleSetBasicClauseOperator(
                                  TAG_FILTER_OPERATORS.AND,
                                )
                              }
                            >
                              Match All
                            </button>
                          </div>
                        </div>
                      </div>

                    </div>

                    <div className={styles.tagLibrary}>
                      <div className={styles.tagLibraryHeader}>
                        <div className={styles.tagLibraryMeta}>
                          <span className={styles.tagLibraryEyebrow}>
                            Tag library
                          </span>
                          <p className={styles.tagLibraryHelp}>
                            Click a tag to cycle it through{" "}
                            <strong>Match → NOT → off</strong>.
                          </p>
                        </div>
                        <div className={styles.tagLibraryControls}>
                          <div className={styles.tagSearch}>
                            <input
                              type="text"
                              placeholder="Search tags in library..."
                              value={tagSearchTerm}
                              onChange={(e) => setTagSearchTerm(e.target.value)}
                              className={styles.tagSearchInput}
                            />
                          </div>
                        </div>
                      </div>

                      <div className={styles.tagFilters}>
                        {visibleTagEntries.map(([fullTagId, tagInfo]) => {
                          const location = tagLocationLookup.get(fullTagId);
                          const isMatch = location?.lane === "include";
                          const isNot = location?.lane === "exclude";

                          return (
                            <button
                              key={fullTagId}
                              className={`${styles.tagFilter} ${
                                tagInfo.accentId ? styles.tagFilterAccented : ""
                              } ${
                                isMatch ? styles.tagFilterSelected : ""
                              } ${
                                isNot ? styles.tagFilterSelectedNegative : ""
                              }`}
                              style={buildTagAccentCssVars(
                                tagInfo.accentId,
                                customAccentsById,
                              )}
                              onClick={() => handleBasicCatalogTagClick(fullTagId)}
                              aria-label={
                                isMatch
                                  ? `MATCH ${tagInfo.displayName}`
                                  : isNot
                                    ? `NOT ${tagInfo.displayName}`
                                    : tagInfo.displayName
                              }
                              title={
                                isMatch
                                  ? `Click to exclude "${tagInfo.displayName}"`
                                  : isNot
                                    ? `Click to remove "${tagInfo.displayName}" filter`
                                    : `Click to match "${tagInfo.displayName}"`
                              }
                            >
                              <span className={styles.tagFilterLabel}>
                                {tagInfo.displayName}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.logicWorkspaceHeader}>
                      <div className={styles.logicBuilderIntro}>
                        <span className={styles.groupBuilderLabel}>Match logic</span>
                        <p className={styles.groupBuilderHelp}>
                          Build the formula one group at a time. Pick a group above,
                          choose whether it matches any or all tags, then click tags
                          below to cycle each one through Match, NOT, and off.
                        </p>
                      </div>
                      <div className={styles.logicWorkspaceActions}>
                        <div className={styles.formulaBadge}>
                          <span className={styles.formulaBadgeLabel}>Formula</span>
                          <span className={styles.formulaBadgeValue}>
                            {activeTagFormula || "No tag logic yet"}
                          </span>
                        </div>
                        <button
                          className={styles.addGroupButton}
                          onClick={() =>
                            onAddIncludeClause(
                              TAG_FILTER_OPERATORS.OR,
                              TAG_FILTER_OPERATORS.AND,
                            )
                          }
                          title="Add another logic group"
                        >
                          Add Group
                        </button>
                      </div>
                    </div>

                    {includeTagClauses.length > 0 ? (
                      <>
                        <div className={styles.groupTimeline}>
                          {includeTagClauses.map((clause, clauseIndex) => (
                            <React.Fragment key={`include-clause-${clauseIndex}`}>
                              {clauseIndex > 0 ? (
                                <div className={styles.groupConnector}>
                                  <div className={styles.operatorToggle}>
                                    {[TAG_FILTER_OPERATORS.AND, TAG_FILTER_OPERATORS.OR].map(
                                      (operator) => (
                                        <button
                                          key={`connector-${clauseIndex}-${operator}`}
                                          className={`${styles.operatorToggleButton} ${
                                            clauseConnectors[clauseIndex - 1] ===
                                            operator
                                              ? styles.operatorToggleButtonActive
                                              : ""
                                          }`}
                                          onClick={() =>
                                            onSetClauseConnector(
                                              clauseIndex - 1,
                                              operator,
                                            )
                                          }
                                          title={`Connect group ${clauseIndex} and group ${clauseIndex + 1} with ${operator}`}
                                        >
                                          {operator}
                                        </button>
                                      ),
                                    )}
                                  </div>
                                </div>
                              ) : null}

                              <div
                                className={`${styles.groupSummaryCard} ${
                                  resolvedSelectedClauseIndex === clauseIndex
                                    ? styles.groupSummaryCardActive
                                    : ""
                                }`}
                                onClick={() => onSelectClause(clauseIndex)}
                                onKeyDown={(event) =>
                                  handleClauseCardKeyDown(event, clauseIndex)
                                }
                                role="button"
                                tabIndex={0}
                                aria-pressed={
                                  resolvedSelectedClauseIndex === clauseIndex
                                }
                              >
                                <div className={styles.groupSummaryTop}>
                                  <div className={styles.groupSummaryMeta}>
                                    <span className={styles.groupPillIndex}>
                                      G{clauseIndex + 1}
                                    </span>
                                    <span className={styles.clauseSelectLabel}>
                                      {resolvedSelectedClauseIndex === clauseIndex
                                        ? "Editing"
                                        : "Select"}
                                    </span>
                                  </div>
                                  <button
                                    className={styles.groupPillRemove}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onRemoveIncludeClause(clauseIndex);
                                    }}
                                    title={`Remove group ${clauseIndex + 1}`}
                                  >
                                    ×
                                  </button>
                                </div>

                                <div className={styles.groupSummaryCounts}>
                                  <span className={styles.groupSummaryOperator}>
                                    {clause.operator === TAG_FILTER_OPERATORS.OR
                                      ? "Match Any"
                                      : "Match All"}
                                  </span>
                                  <span>{clause.tagIds.length} match</span>
                                  <span>{clause.excludedTagIds.length} not</span>
                                </div>

                                <div
                                  className={`${styles.groupSummaryPreview} ${
                                    clause.tagIds.length === 0 &&
                                    clause.excludedTagIds.length === 0
                                      ? styles.groupSummaryPreviewEmpty
                                      : ""
                                  }`}
                                >
                                  {clause.tagIds.length === 0 &&
                                  clause.excludedTagIds.length === 0
                                    ? "Empty group"
                                    : formatClausePreview(clause)}
                                </div>
                              </div>
                            </React.Fragment>
                          ))}
                        </div>

                        {selectedClause ? (
                          <div className={styles.editorPanel}>
                            <div className={styles.editorPanelHeader}>
                              <div className={styles.editorPanelMeta}>
                                <span className={styles.editorPanelEyebrow}>
                                  Editing Group {resolvedSelectedClauseIndex! + 1}
                                </span>
                                <h4 className={styles.editorPanelTitle}>
                                  {selectedClausePreview || "Build this group"}
                                </h4>
                                <p className={styles.editorPanelHelp}>
                                  Click tags below to cycle them through Match,
                                  NOT, and off for this group.
                                </p>
                              </div>

                              {renderAppliedTagFilters(
                                selectedClause,
                                resolvedSelectedClauseIndex!,
                              )}

                              <div className={styles.editorPanelControls}>
                                <div className={styles.operatorToggle}>
                                  <button
                                    className={`${styles.operatorToggleButton} ${
                                      selectedClause.operator ===
                                      TAG_FILTER_OPERATORS.OR
                                        ? styles.operatorToggleButtonActive
                                        : ""
                                    }`}
                                    onClick={() =>
                                      onSetIncludeClauseOperator(
                                        resolvedSelectedClauseIndex!,
                                        TAG_FILTER_OPERATORS.OR,
                                      )
                                    }
                                    title={`Match any tag in group ${resolvedSelectedClauseIndex! + 1}`}
                                  >
                                    Match Any
                                  </button>
                                  <button
                                    className={`${styles.operatorToggleButton} ${
                                      selectedClause.operator ===
                                      TAG_FILTER_OPERATORS.AND
                                        ? styles.operatorToggleButtonActive
                                        : ""
                                    }`}
                                    onClick={() =>
                                      onSetIncludeClauseOperator(
                                        resolvedSelectedClauseIndex!,
                                        TAG_FILTER_OPERATORS.AND,
                                      )
                                    }
                                    title={`Match all tags in group ${resolvedSelectedClauseIndex! + 1}`}
                                  >
                                    Match All
                                  </button>
                                </div>
                              </div>
                            </div>

                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className={styles.logicEmptyState}>
                        <p className={styles.groupBuilderEmpty}>
                          Start with a single group. You can keep it simple with
                          one Match Any/All group, then add more groups only when
                          you need extra AND/OR logic.
                        </p>
                        <button
                          className={styles.addGroupButton}
                          onClick={() =>
                            onAddIncludeClause(
                              TAG_FILTER_OPERATORS.OR,
                              TAG_FILTER_OPERATORS.AND,
                            )
                          }
                        >
                          Start Filtering
                        </button>
                      </div>
                    )}

                    <div className={styles.tagLibrary}>
                      <div className={styles.tagLibraryHeader}>
                        <div className={styles.tagLibraryMeta}>
                          <span className={styles.tagLibraryEyebrow}>
                            Tag library
                          </span>
                          <p className={styles.tagLibraryHelp}>
                            Click a tag to cycle it through{" "}
                            <strong>Match → NOT → off</strong> in{" "}
                            {selectedClauseLabel}.
                          </p>
                        </div>
                        <div className={styles.tagLibraryControls}>
                          <div className={styles.tagSearch}>
                            <input
                              type="text"
                              placeholder="Search tags in library..."
                              value={tagSearchTerm}
                              onChange={(e) => setTagSearchTerm(e.target.value)}
                              className={styles.tagSearchInput}
                            />
                          </div>
                        </div>
                      </div>

                      <div className={styles.tagFilters}>
                        {visibleTagEntries.map(([fullTagId, tagInfo]) => {
                          const location = tagLocationLookup.get(fullTagId);
                          const isInSelectedClause =
                            location?.clauseIndex === resolvedSelectedClauseIndex;
                          const isMatch =
                            isInSelectedClause &&
                            location?.lane === "include";
                          const isNot =
                            isInSelectedClause &&
                            location?.lane === "exclude";
                          const isInAnotherClause =
                            location !== undefined &&
                            location.clauseIndex !== resolvedSelectedClauseIndex;
                          const statusLabel = isMatch
                            ? "MATCH"
                            : isNot
                              ? "NOT"
                              : isInAnotherClause
                                ? `G${(location?.clauseIndex ?? 0) + 1} ${
                                    location?.lane === "exclude" ? "NOT" : "MATCH"
                                  }`
                                : null;

                          return (
                            <button
                              key={fullTagId}
                              className={`${styles.tagFilter} ${
                                tagInfo.accentId ? styles.tagFilterAccented : ""
                              } ${
                                isMatch ? styles.tagFilterSelected : ""
                              } ${
                                isNot ? styles.tagFilterSelectedNegative : ""
                              } ${
                                isInAnotherClause
                                  ? styles.tagFilterElsewhere
                                  : ""
                              }`}
                              style={buildTagAccentCssVars(
                                tagInfo.accentId,
                                customAccentsById,
                              )}
                              onClick={() => handleCatalogTagClick(fullTagId)}
                              aria-label={statusLabel
                                ? `${statusLabel} ${tagInfo.displayName}`
                                : tagInfo.displayName}
                              title={
                                isMatch
                                  ? `Click to exclude "${tagInfo.displayName}" in ${selectedClauseLabel}`
                                  : isNot
                                    ? `Click to remove "${tagInfo.displayName}" from ${selectedClauseLabel}`
                                    : isInAnotherClause
                                      ? `Click to move "${tagInfo.displayName}" into Match in ${selectedClauseLabel}`
                                      : `Click to match "${tagInfo.displayName}" in ${selectedClauseLabel}`
                              }
                            >
                              <span className={styles.tagFilterLabel}>
                                {tagInfo.displayName}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TRACK LIST */}
      {notePreviews.error && <PrivateNotePreviewError onRetry={notePreviews.retry} />}
      <div className={styles.trackList}>
        {sortedTracksVisible.length === 0 ? (
          <>
            <p className={styles.noTracks}>
              {Object.keys(deferredTracks).length === 0
                ? "No tagged tracks yet. Start tagging your favorite tracks!"
                : "No tracks match your filters."}
            </p>
            {Object.keys(deferredTracks).length === 0 && <GettingStartedQuestion />}
          </>
        ) : (
          sortedTracksVisible.map(([uri, data]) => {
            const trackData = data;
            const info = trackInfo[uri];
            // Handle case when info isn't available yet (especially for local files)
            const isLocalFile = uri.startsWith("spotify:local:");

            const isActiveTrack = activeTrackUri === uri || (!!activeTrackUri && !!recordingKeys.get(uri) && recordingKeys.get(uri) === recordingKeys.get(activeTrackUri));

            // If no info and not a local file, skip this track
            if (!info && !isLocalFile) return null;

            // For local files without info yet, create temporary display info
            let displayInfo;
            if (!info && isLocalFile) {
              // Use our parser to get better display information
              const parsedLocalFile = parseLocalFileUri(uri);
              displayInfo = {
                name: parsedLocalFile.title,
                artists: parsedLocalFile.artist,
                albumName: parsedLocalFile.album,
              };
            } else {
              displayInfo = info || {
                name: "Unknown Track",
                artists: "Unknown Artist",
                albumName: "Unknown Album",
              };
            }

            // Sort tags based on their position in the category hierarchy (not alphabetically)
            const sortedTagsArray =
              taxonomy.categoryOrder.length > 0
                ? sortResolvedTags(
                    getResolvedTrackTags(data, tagDisplayLookup),
                    tagPositionLookup,
                  )
                : getResolvedTrackTags(data, tagDisplayLookup);
            const displayCamelotKey = normalizeCamelotKey(data.camelotKey);

            return (
              <div
                key={uri}
                id={`track-item-${uri}`}
                className={`${styles.trackItem} ${
                  isActiveTrack ? styles.activeTrackItem : ""
                }`}
              >
                {/* TOP SECTION - title and artist + Play/Tag buttons */}
                <div className={styles.trackItemInfo}>
                  {/* Track title and artist on left */}
                  <div className={styles.trackItemTextInfo}>
                    <span
                      className={`${styles.trackItemTitle} ${
                        !isLocalFile ? styles.clickable : ""
                      } ${isActiveTrack ? styles.activeTrackTitle : ""}`}
                      onClick={() => !isLocalFile && navigateToAlbum(uri)}
                      title={!isLocalFile ? "Go to album" : undefined}
                    >
                      {hasIncompleteTags(trackData) && (
                        <span
                          className={styles.incompleteBullet}
                          title="This track has incomplete tags (missing rating, energy, or tags)"
                        >
                          ●
                        </span>
                      )}
                      {displayInfo.name}
                      {isLocalFile && (
                        <span
                          style={{
                            fontSize: "0.8em",
                            marginLeft: "6px",
                            opacity: 0.7,
                          }}
                        >
                          (Local)
                        </span>
                      )}
                    </span>
                    {displayInfo.artists &&
                      displayInfo.artists !== "Local Artist" && (
                        <span className={styles.trackItemArtist}>
                          {/* Split artists and make each clickable */}
                          {!isLocalFile
                            ? displayInfo.artists
                                .split(", ")
                                .map((artist, idx, arr) => (
                                  <React.Fragment key={idx}>
                                    <span
                                      className={styles.clickableArtist}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigateToArtist(artist, uri);
                                      }}
                                      title={`Go to ${artist}`}
                                    >
                                      {artist}
                                    </span>
                                    {idx < arr.length - 1 && ", "}
                                  </React.Fragment>
                                ))
                            : displayInfo.artists}
                        </span>
                      )}
                  </div>

                  {/* PLAY + TAG BUTTONS */}
                  <div className={styles.trackItemActions}>
                    <button
                      className={styles.actionButton}
                      onClick={() => onPlayTrack(uri)}
                      title={"Play this track"}
                    >
                      {"Play"}
                    </button>

                    <button
                      className={`${styles.actionButton} ${
                        isActiveTrack ? styles.activeTagButton : ""
                      }`}
                      onClick={() => onTagTrack(uri)}
                      title={
                        isActiveTrack
                          ? "Currently tagging this track"
                          : "Edit tags for this track"
                      }
                      disabled={isActiveTrack}
                    >
                      {isActiveTrack ? "Tagging" : "Tag"}
                    </button>
                  </div>
                </div>

                {/* TWO-ROW METADATA SECTION */}
                <div className={styles.trackItemMetaContainer}>
                  {/* TOP ROW - STAR RATING/ENERGY/BPM + TIMESTAMP */}
                  <div className={styles.trackItemMetaTop}>
                    <div className={styles.trackItemFixedMeta}>
                      {data.rating > 0 && (
                        <div className={styles.trackItemRating}>
                          <ReactStars
                            key={`${uri}-rating-${data.rating}`}
                            count={5}
                            value={data.rating}
                            edit={false}
                            size={16}
                            isHalf={true}
                            emptyIcon={<FontAwesomeIcon icon={faStar} />}
                            halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                            fullIcon={<FontAwesomeIcon icon={faStar} />}
                            activeColor="#ffd700"
                            color="var(--tagify-rating-control-muted, var(--spice-button-disabled))"
                          />
                        </div>
                      )}

                      {data.energy > 0 && (
                        <div className={styles.trackItemEnergy}>
                          <span title="Energy">{data.energy}</span>
                        </div>
                      )}

                      {data.bpm !== null && data.bpm > 0 && (
                        <div className={styles.trackItemBpm}>
                          <span title="BPM">{data.bpm}</span>
                        </div>
                      )}

                      {displayCamelotKey !== null && (
                        <div className={styles.trackItemCamelotKey}>
                          <span title="Camelot Key">{displayCamelotKey}</span>
                        </div>
                      )}

                      {/* Timestamp display */}
                      <div className={styles.trackItemTimestampsInline}>
                        {trackData.dateCreated && (
                          <div className={styles.timestampWithIcon}>
                            <span className={styles.timestampIcon}>📅</span>
                            <span
                              className={styles.trackItemTimestamp}
                              title={`Created: ${new Date(
                                trackData.dateCreated,
                              ).toLocaleString()}`}
                            >
                              {formatTimestamp(trackData.dateCreated)}
                            </span>
                          </div>
                        )}
                        {trackData.dateModified && (
                          <div className={styles.timestampWithIcon}>
                            <span className={styles.timestampIcon}>✏️</span>
                            <span
                              className={styles.trackItemTimestamp}
                              title={`Last updated: ${new Date(
                                trackData.dateModified,
                              ).toLocaleString()}`}
                            >
                              {formatTimestamp(trackData.dateModified)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* BOTTOM ROW - TRACK TAGS */}
                  {sortedTagsArray.length > 0 ? (
                    <div className={styles.trackItemTags}>
                      {sortedTagsArray.map((tag, i) => (
                        <span
                          key={i}
                          className={`${styles.trackItemTag} ${
                            tag.accentId ? styles.trackItemTagAccented : ""
                          } ${
                            activeTagFilters.includes(tag.tagId)
                              ? styles.activeTagFilter
                              : ""
                          } ${
                            excludedTagFilters.includes(tag.tagId)
                              ? styles.excludedTagFilter
                              : ""
                          }`}
                          style={buildTagAccentCssVars(
                            tag.accentId,
                            customAccentsById,
                          )}
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent track item click
                            onToggleTagIncludeOff(tag.tagId);
                          }}
                          title={
                            activeTagFilters.includes(tag.tagId)
                              ? `Click to remove "${tag.displayName}" from filters`
                              : excludedTagFilters.includes(tag.tagId)
                                ? `Click to move "${tag.displayName}" into the selected include group`
                                : `Click to filter by "${tag.displayName}"`
                          }
                        >
                          <span className={styles.trackItemTagLabel}>{tag.displayName}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.trackItemTags}>
                      <span className={styles.noTags}>No tags</span>
                    </div>
                  )}
                  {(visibleNoteUris.get(uri) || [uri]).map(noteUri => (
                    <PrivateNotePreview key={noteUri} text={notePreviews.texts[noteUri]} trackName={displayInfo.name} onOpen={() => onTagTrack(noteUri)} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
      {allSortedTracks.length > sortedTracksVisible.length && (
        <div ref={observerRef} className={styles.loadMoreContainer}>
          <button
            className={styles.loadMoreButton}
            onClick={() =>
              setDisplayCount((prev) =>
                Math.min(prev + PAGINATION_BATCH_SIZE, allSortedTracks.length),
              )
            }
          >
            Load More ({allSortedTracks.length - sortedTracksVisible.length}{" "}
            remaining)
          </button>
        </div>
      )}
      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          trackCount={allSortedTracks.length}
          localTrackCount={
            allSortedTracks.filter(([uri]) => uri.startsWith("spotify:local:"))
              .length
          }
          currentSearchTerm={searchTerm}
          activeTagDisplayNames={activeTagDisplayNames}
          activeTagFormula={activeTagFormula}
          energyMinFilter={energyMinFilter}
          energyMaxFilter={energyMaxFilter}
          ratingFilters={ratingFilters}
          bpmMinFilter={bpmMinFilter}
          bpmMaxFilter={bpmMaxFilter}
          camelotKeyFilters={normalizedCamelotKeyFilters}
          editingSmartPlaylistName={editingSmartPlaylist?.playlistName}
          statsListLabel={statsTrackSet?.label}
          onClose={handleCloseCreatePlaylistModal}
          onCreatePlaylist={handleCreatePlaylist}
        />
      )}
      {showSmartPlaylistModal && (
        <SmartPlaylistModal
          smartPlaylists={smartPlaylists}
          taxonomy={taxonomy}
          tracks={tracks}
          onEditPlaylist={handleEditSmartPlaylist}
          onUpdateSmartPlaylists={onSetSmartPlaylists}
          onSyncPlaylist={onSyncPlaylist}
          onExportSmartPlaylists={(selected, personalBackup) => onExportSmartPlaylists(taxonomy, selected, personalBackup)}
          onImportSmartPlaylists={onImportSmartPlaylists}
          onBindRecipe={handleBindSmartPlaylistRecipe}
          onClose={() => setShowSmartPlaylistModal(false)}
        />
      )}
    </div>
  );
};

export default TrackList;
