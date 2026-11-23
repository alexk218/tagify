import { connectExistingSmartPlaylist } from "@/features/smart-playlists";
import { addableHere } from "@/services/localFilesOnThisComputer";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./TrackList.module.css";
import { parseLocalFileUri } from "@/utils/LocalFileParser";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
import type { SmartPlaylistImportSummary } from "@/features/smart-playlists";
import { createSharedSmartPlaylist, type SmartPlaylistRecipeSelection } from "@/features/smart-playlists";
import { TagTaxonomy } from "@/types/tagData";
import { CreatePlaylistModal } from "@/features/playlist-state";
import { trackService } from "@/services/TrackService";
import { spotifyService } from "@/services/SpotifyService";
import { openSpotifyArtist } from "@/services/spotifyNavigation";
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
import { revealElement } from "@/utils/revealElement";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faCheck,
  faBoltLightning,
  faFloppyDisk,
  faXmark,
  faStar,
  faStarHalf,
  faUserGroup,
} from "@fortawesome/free-solid-svg-icons";
import { normalizeCamelotKey } from "@/utils/camelotKey";
import {
  formatLength,
  LENGTH_FILTER_OPTIONS,
  parseBpmInput,
  parseLengthInput,
  parseYearInput,
} from "@/utils/songDetails";
import { FilterValueField } from "./FilterValueField";
import { songDetailsProgress } from "@/features/metadata-backfill";
import { SongDetailsProgressBar } from "./SongDetailsFillProgress";

/** The standard choices, plus a saved value that isn't one of them (from a shared playlist, for example). */
function lengthOptions(current: number | null): number[] {
  return current === null || LENGTH_FILTER_OPTIONS.includes(current)
    ? LENGTH_FILTER_OPTIONS
    : [...LENGTH_FILTER_OPTIONS, current].sort((a, b) => a - b);
}

/** Every year from the oldest to the newest release in the list, so a range like 1990–1999 can be picked even with gaps. */
function yearOptions(years: Set<number>, current: number | null): number[] {
  const known = current === null ? [...years] : [...years, current];
  if (!known.length) return [];
  const oldest = Math.min(...known), newest = Math.max(...known);
  // An odd date far outside the rest shouldn't turn the list into hundreds of empty years.
  if (newest - oldest > 150) return [...new Set(known)].sort((a, b) => a - b);
  return Array.from({ length: newest - oldest + 1 }, (_, index) => oldest + index);
}
import {
  TAG_FILTER_OPERATORS,
  TagFilterClause,
  TagFilterFormula,
  buildTagGroupFilterOptions,
  formatTagFilterFormula,
  getTagGroupFilterGroupId,
} from "@/utils/tagFilterGroups";
import { useTrackListControls } from "@/features/track-session/hooks/useTrackListControls";
import { useTrackListCommunity } from "@/features/track-session/hooks/useTrackListCommunity";
import { COMMUNITY_ROW_TAGS, formatCommunityPeople, communityPeopleTitle } from "@/features/track-session/utils/communityPeople";
import { TrackCommunityPanel } from "@/features/track-session/components/TrackCommunityPanel";
import { useNewFeatureHighlight } from "@/hooks/shared/useNewFeatureHighlight";
import { recordProductInteraction, sortDetail } from "@/features/product-analytics/productAnalytics";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import type { CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import { communityTagDestination } from "@/features/onboarding/services/communityTagPlacement";
import { sameTagNameKey } from "@tagify/community-contracts";
import { ChevronDown } from "lucide-react";
import { RowTimestamps } from "./TimestampIcon";
import { preloadTaggedByOthers } from "@/features/community/taggedByOthers/useTaggedByOthers";
import { OthersTagsGate } from "@/features/track-session/components/OthersTagsGate";
import { communitySwitchOn } from "@/features/community/communitySwitches";
import type { TaggedByOthersItem } from "@/features/community/taggedByOthers/taggedByOthersScan";
import { recordCommunityTeaserViewed } from "@/features/community/taggedByOthers/communityTeaserPreview";
import {
  buildTagDisplayLookup,
  buildSmartPlaylistCriteria,
  buildTagPositionLookup,
  buildTrackInfoMap,
  collectTrackFilterData,
  filterTrackEntries,
  getResolvedTrackTags,
  hasIncompleteTags,
  listedTaggedTrackEntries,
  sortResolvedTags,
  sortTrackEntries,
} from "@/features/track-session/utils/trackList.logic";
import {
  TagDisplayInfo,
  TrackListEntry,
  TrackListTrackData,
} from "@/features/track-session/model/trackList.types";
import { buildTagAccentCssVars } from "@/features/tag-data";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { setAdvancedFilters, useAdvancedFilters } from "@/features/filter-state/advancedFiltersSetting";
import { removeFromToTag, useToTagList } from "@/features/to-tag/toTagStore";
import { useFillToTagNames } from "@/features/to-tag/useFillToTagNames";
import { collapseRecordingEntries, recordingDisplayKeys } from "@/features/recording-reuse/utils/recordingLibrary";
import { buildValidTagIdSet } from "@/utils/tagTaxonomy";
import { CommunityTagSearch, tagSearchQuery } from "@/features/community/tagSearch/CommunityTagResults";
import { useCommunityTagSearch } from "@/features/community/tagSearch/useCommunityTagSearch";
import { useTagSearchNewLabel } from "@/features/community/tagSearch/tagSearchNewLabel";
import { usePrivateNotePreviews } from "@/features/private-notes/hooks/usePrivateNotePreviews";
import { PrivateNotePreview, PrivateNotePreviewError } from "@/features/private-notes/components/PrivateNotePreview";
import { TrackCover } from "./TrackCover";
import { CoverPlay, usePlayerNow } from "@/components/ui";
import { useSharingLockReason } from "@/features/community/sharingLockReason";

const CAMELOT_KEY_LINE_A = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}A`,
);
const CAMELOT_KEY_LINE_B = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}B`,
);
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
  onSyncPlaylist: (playlist: SmartPlaylistCriteria, trigger?: "manual") => Promise<void>;
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
  /** Puts other members' tags on a song in the list, adding any the library doesn't have yet. */
  onAddCommunityTags?: (uri: string, tags: CommunityMatchTag[]) => Promise<void>;
  /**
   * The "Tagged by others" view: the Liked Songs other members tagged. When given, the title becomes
   * a choice between it and Tagged Tracks (switch `taggedByOthersTrackList`).
   */
  taggedByOthersView?: React.ReactNode;
  /**
   * The member doesn't share their tags on Community, so a row's "N others" opens a request to share
   * instead of every tag (switch `othersTagsSharingGate`). Everyone still sees the first tags.
   */
  othersTagsLocked?: boolean;
  /** Opens the existing sharing choice. */
  onShareTags?: () => void;
  /**
   * Not connected to Community: other members' tags on songs in the list (how many people and their
   * tags, never who), as a preview with adding locked until they connect (switch `communityTeasers`).
   */
  communityTeaser?: { others: ReadonlyMap<string, TaggedByOthersItem>; found?: number; onConnect: () => void };
  /**
   * "On Community" under the list's own songs while a tag filter is on: songs other members tagged
   * that way (switch `communityTagSearch`). `viewer` changes when who is asking changes (connected, sharing).
   */
  communityTagSearch?: { viewer: string; onConnect: () => void; onShare: () => void; onPlay: (uri: string) => void };
}

type TrackListView = "tagged" | "others" | "toTag";

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
  onAddCommunityTags,
  taggedByOthersView,
  othersTagsLocked = false,
  onShareTags,
  communityTeaser,
  communityTagSearch,
}) => {
  const allTagsHidden = useSharingLockReason() === "all-hidden";
  const [savedView, setSavedView] = useLocalStorage<TrackListView>("tagify:trackListView", "tagged");
  const viewTabsRef = useRef<HTMLDivElement | null>(null);
  // A list opened from Stats is always Tagged Tracks.
  const othersActive = !!taggedByOthersView && !statsTrackSet && savedView === "others";
  const toTagList = useToTagList();
  const toTagActive = !statsTrackSet && savedView === "toTag";
  // Always shown, even before anything is on the list (Alex, 2026-11-23), so people find it.
  const toTagTabShown = !statsTrackSet;

  const [showCreatePlaylistModal, setShowCreatePlaylistModal] =
    useState<boolean>(false);
  const [showSmartPlaylistModal, setShowSmartPlaylistModal] =
    useState<boolean>(false);
  const [editingSmartPlaylist, setEditingSmartPlaylist] =
    useState<SmartPlaylistCriteria | null>(null);
  const handledSmartPlaylistEditRequestRef = useRef<string | null>(null);
  // Settings > Advanced filters: the tag group formula editor and the Camelot key filter.
  const advancedFilters = useAdvancedFilters();
  const tagFilterEditorMode: TagFilterEditorMode = advancedFilters ? "complex" : "basic";
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
    songDetailFilters,
    setSongDetailFilters,
    handleLengthMinChange,
    handleLengthMaxChange,
    handleReleaseYearMinChange,
    handleReleaseYearMaxChange,
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
    () => listedTaggedTrackEntries(Object.entries(deferredTracks)),
    [deferredTracks],
  );
  const statsTrackUris = useMemo(() => statsTrackSet ? new Set(statsTrackSet.trackUris) : null, [statsTrackSet]);
  // Search, filters and sorting still work inside a set opened from Stats.
  // The To Tag list shows songs whether or not they have anything saved yet. Songs with nothing
  // saved get a display-only placeholder; nothing is written to the library until they're tagged.
  const toTagEntries = useMemo<TrackListEntry[]>(
    () => toTagList.map((entry) => [entry.uri, deferredTracks[entry.uri] ?? {
      rating: 0, energy: 0, bpm: null, tagIds: [],
      name: entry.name || undefined, artists: entry.artists || undefined,
      albumName: entry.album || undefined, albumImageUrl: entry.image || null,
    }]),
    [toTagList, deferredTracks],
  );
  const toTagUnsaved = useMemo(() => toTagList.filter((entry) => !deferredTracks[entry.uri]), [toTagList, deferredTracks]);
  useFillToTagNames(toTagUnsaved, toTagActive);
  const listedEntries = useMemo(
    () => toTagActive ? toTagEntries : statsTrackUris ? trackEntries.filter(([uri]) => statsTrackUris.has(uri)) : trackEntries,
    [toTagActive, toTagEntries, trackEntries, statsTrackUris],
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
  const trackInfo = useMemo(() => buildTrackInfoMap(toTagActive ? [...trackEntries, ...toTagEntries] : trackEntries), [toTagActive, trackEntries, toTagEntries]);

  const filterTagBySearch = (tagName: string) => {
    if (!tagSearchTerm || typeof tagSearchTerm !== "string") return true;
    if (!tagSearchTerm.trim()) return true;
    return tagName.toLowerCase().includes(tagSearchTerm.toLowerCase());
  };

  const validTagIds = useMemo(() => buildValidTagIdSet(taxonomy), [taxonomy]);
  const recordingKeys = useMemo(() => recordingDisplayKeys(deferredTracks, validTagIds), [deferredTracks, validTagIds]);
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
        ...songDetailFilters,
      }, taxonomy),
    [
      taxonomy,
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
      songDetailFilters,
    ],
  );

  const listedUris = useMemo(() => listedEntries.map(([uri]) => uri), [listedEntries]);
  const community = useTrackListCommunity(listedUris);
  // A saved "Most tagged by others" falls back to Last updated on a computer that isn't connected,
  // without forgetting the choice.
  const effectiveSortBy = sortBy === SORT_OPTIONS.COMMUNITY_PEOPLE && !community.available ? SORT_OPTIONS.DATE_MODIFIED : sortBy;
  const communityPeople = effectiveSortBy === SORT_OPTIONS.COMMUNITY_PEOPLE ? community.people : undefined;
  // Rows whose other members' tags are open; several can be open at once.
  const [openCommunityRows, setOpenCommunityRows] = useState<ReadonlySet<string>>(new Set());
  const toggleCommunityRow = useCallback((uri: string) => {
    setOpenCommunityRows((current) => {
      const next = new Set(current);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  }, []);
  const libraryTagKeys = useMemo(
    () => new Set(Object.values(taxonomy.tagsById ?? {}).map((tag) => sameTagNameKey(tag.name))),
    [taxonomy.tagsById],
  );
  const ownCommunityHandle = community.available ? getDesktopSyncConfiguration()?.profile?.handle ?? null : null;
  // Once after the update: the sort dropdown points out its new "Most tagged by others" option.
  const sortHighlight = useNewFeatureHighlight(
    "track-list-sort-community-people",
    community.available && effectiveSortBy !== SORT_OPTIONS.COMMUNITY_PEOPLE,
    "3.4.0",
  );
  const player = usePlayerNow();
  // Read the saved Tagged by others check now, so switching to it doesn't flash an empty panel first.
  const othersTabAvailable = !!taggedByOthersView && !statsTrackSet;
  useEffect(() => {
    if (othersTabAvailable) void preloadTaggedByOthers(getDesktopSyncConfiguration()?.accountId || null);
  }, [othersTabAvailable]);
  // Once after the update, for connected members: the "Tagged by others" tab is marked New until they open it.
  const othersTabHighlight = useNewFeatureHighlight("track-list-tagged-by-others-view", community.available && !!taggedByOthersView && !statsTrackSet, "3.4.0");
  useEffect(() => {
    if (othersActive && othersTabHighlight.show) othersTabHighlight.dismiss();
  }, [othersActive, othersTabHighlight]);
  const filterCount = activeFilterCount;
  const clearEveryFilter = () => {
    clearAllFilters();
  };
  // Counted once each time the list goes from no tag filter to a tag filter, with the sort in use then.
  // A filter restored when the page opens is not counted.
  const hasTagFilter = activeTagFilters.length > 0 || excludedTagFilters.length > 0;
  const communityTagQuery = useMemo(
    () => tagSearchQuery(includeTagClauses, (tagId) => taxonomy.tagsById[tagId]?.name || ""),
    [includeTagClauses, taxonomy],
  );
  // "On Community": asked once here so the "Your library | On Community (N)" switch above the list can show
  // the count (Alex's pick 1A, 2026-11-23: scrolling all the way down to reach it was bad UX).
  const communityTagShown = !!communityTagSearch && !statsTrackSet && !toTagActive && communityTagQuery.tags.length > 0;
  const communityTagResults = useCommunityTagSearch({ tags: communityTagQuery.tags, match: communityTagQuery.match, enabled: communityTagShown, viewer: communityTagSearch?.viewer ?? "" });
  const communityTagFound = communityTagShown && communityTagResults.phase === "done" && communityTagResults.total > 0;
  const communityTagCount = `${communityTagResults.total.toLocaleString()}${communityTagResults.capped ? "+" : ""}`;
  const tagSearchNew = useTagSearchNewLabel();
  const [tagSearchView, setTagSearchView] = useState<"library" | "community">("library");
  const showingCommunityTags = communityTagShown && tagSearchView === "community";
  const openCommunityTags = () => {
    tagSearchNew.dismiss();
    setTagSearchView("community");
  };
  const hadTagFilter = useRef(hasTagFilter);
  useEffect(() => {
    if (hasTagFilter && !hadTagFilter.current) recordProductInteraction("tag_filter_used", { sort: sortDetail(effectiveSortBy) });
    hadTagFilter.current = hasTagFilter;
  }, [hasTagFilter, effectiveSortBy]);
  const filteredTracks = useMemo(
    () => collapseRecordingEntries(sortTrackEntries(matchingTracks, trackInfo, { sortBy: effectiveSortBy, sortOrder, communityPeople }), recordingKeys),
    [matchingTracks, trackInfo, effectiveSortBy, sortOrder, communityPeople, recordingKeys],
  );
  const allSortedTracks = filteredTracks;
  // Not connected: other members' tags on a few of these songs, with adding locked until they connect.
  const teaser = useMemo(
    () => (communityTeaser && !community.available && communitySwitchOn("communityTeasers") ? communityTeaser : null),
    [communityTeaser, community.available],
  );
  const teaserOthers = useMemo(() => teaser?.others ?? new Map<string, TaggedByOthersItem>(), [teaser]);
  useEffect(() => {
    if (teaser && teaser.others.size) recordCommunityTeaserViewed("rows", teaser.found);
  }, [teaser]);
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
    hasSongLengths,
    allReleaseYears,
  } = useMemo(
    () => collectTrackFilterData(trackEntries, filterTagDisplayLookup),
    [filterTagDisplayLookup, trackEntries],
  );
  const sortedBpmValues = useMemo(() => Array.from(allBpmValues).sort((a, b) => a - b), [allBpmValues]);

  const songDetailsFill = useMemo(() => songDetailsProgress(tracks), [tracks]);

  const allCamelotKeySet = useMemo(
    () => new Set(allCamelotKeys),
    [allCamelotKeys],
  );

  // Category terms ("Any Genre", "No Mood"), offered in the "Filter by
  // category" menu next to the tag search.
  const tagGroupOptions = useMemo(() => {
    const options = buildTagGroupFilterOptions(taxonomy).filter((option) =>
      option.tagIds.some((tagId) => allUniqueTagsMap.has(tagId)),
    );
    const nameCounts = new Map<string, number>();
    options.forEach((option) => nameCounts.set(option.name, (nameCounts.get(option.name) ?? 0) + 1));
    return options.map((option) => ({
      ...option,
      label: (nameCounts.get(option.name) ?? 0) > 1 ? option.path.join(" / ") : option.name,
    }));
  }, [allUniqueTagsMap, taxonomy]);
  const tagGroupOptionsByTerm = useMemo(
    () => new Map(tagGroupOptions.map((option) => [option.termId, option])),
    [tagGroupOptions],
  );
  const getTagDisplayInfo = (fullTagId: string): TagDisplayInfo => {
    const groupOption = tagGroupOptionsByTerm.get(fullTagId);
    if (groupOption) return { displayName: groupOption.label, accentId: null };
    if (getTagGroupFilterGroupId(fullTagId) !== null) {
      const groupId = getTagGroupFilterGroupId(fullTagId)!;
      const name = taxonomy.categoriesById[groupId]?.name ?? taxonomy.subcategoriesById[groupId]?.name ?? taxonomy.foldersById?.[groupId]?.name;
      return { displayName: name ?? "Category unavailable", accentId: null };
    }
    return (
      allUniqueTagsMap.get(fullTagId) ||
      filterTagDisplayLookup.get(fullTagId) || {
        displayName: fullTagId,
        accentId: null,
      }
    );
  };
  /** "Rock" / "NOT Rock" for tags; "Any Genre" / "No Genre" for categories. */
  const getFilterTermLabel = (termId: string, excluded: boolean): string => {
    const name = getTagDisplayInfo(termId).displayName;
    if (getTagGroupFilterGroupId(termId) === null) return name;
    return excluded ? `No ${name}` : `Any ${name}`;
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
    taxonomy,
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
      taxonomy,
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
              const isGroup = getTagGroupFilterGroupId(tagId) !== null;
              const termLabel = getFilterTermLabel(tagId, isExcluded);

              return (
                <button
                  key={`${clauseIndex}-${state}-${tagId}`}
                  className={`${styles.appliedFilterChip} ${
                    isExcluded ? styles.appliedFilterChipNegative : ""
                  } ${isGroup ? styles.appliedFilterChipCategory : ""} ${
                    tagInfo.accentId ? styles.appliedFilterChipAccented : ""
                  }`}
                  style={buildTagAccentCssVars(
                    tagInfo.accentId,
                    customAccentsById,
                  )}
                  onClick={() => onRemoveTagFilter(tagId)}
                  aria-label={isGroup ? `${termLabel} applied filter` : `${state} ${tagInfo.displayName} applied filter`}
                  title={`Remove "${termLabel}" filter`}
                >
                  <span className={styles.appliedFilterName}>
                    {termLabel}
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
  const renderBasicTagChip = (fullTagId: string, tagInfo: TagDisplayInfo) => {
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
  };
  const renderComplexTagChip = (fullTagId: string, tagInfo: TagDisplayInfo) => {
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
  };
  /** Adds "Any X" (include) or "No X" (exclude) to the clause being edited. */
  const applyCategoryTerm = (termId: string, lane: "include" | "exclude", mode: "basic" | "complex") => {
    if (mode === "basic" && includeTagClauses.length === 0) {
      onReplaceTagFilterFormula(
        {
          clauses: [{
            tagIds: lane === "include" ? [termId] : [],
            excludedTagIds: lane === "exclude" ? [termId] : [],
            operator: basicTagFilterOperator,
          }],
          connectors: [],
        },
        { selectedClauseIndex: 0 },
      );
      return;
    }
    onMoveTagToClauseLane(termId, lane, mode === "basic" ? 0 : resolvedSelectedClauseIndex ?? undefined);
  };
  const renderCategorySelect = (mode: "basic" | "complex") =>
    tagGroupOptions.length > 0 ? (
      <select
        className={styles.categorySelect}
        aria-label="Filter by category"
        value=""
        onChange={(event) => {
          const [lane, termId] = event.target.value.split("|");
          if (termId) applyCategoryTerm(termId, lane === "exclude" ? "exclude" : "include", mode);
        }}
      >
        <option value="">Filter by category…</option>
        <optgroup label="Songs with any tag in">
          {tagGroupOptions.map((option) => (
            <option key={`any-${option.termId}`} value={`include|${option.termId}`}>
              {`${"\u00a0\u00a0".repeat(option.depth)}Any ${option.name}`}
            </option>
          ))}
        </optgroup>
        <optgroup label="Songs missing a category">
          {tagGroupOptions.map((option) => (
            <option key={`no-${option.termId}`} value={`exclude|${option.termId}`}>
              {`${"\u00a0\u00a0".repeat(option.depth)}No ${option.name}`}
            </option>
          ))}
        </optgroup>
      </select>
    ) : null;
  const renderTagLibraryBody = (mode: "basic" | "complex") => {
    const renderChip = mode === "basic" ? renderBasicTagChip : renderComplexTagChip;
    return (
      <div className={styles.tagFilters}>
        {visibleTagEntries.map(([fullTagId, tagInfo]) => renderChip(fullTagId, tagInfo))}
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
  /** With advanced filters off, a saved multi-group formula can be folded into one group. */
  const handleCombineIntoOneGroup = () => {
    const confirmed = window.confirm(
      "Combine your tag groups into one Match Any/All filter? The groups can't be brought back.",
    );
    if (!confirmed) {
      return;
    }

    const nextFormula = buildBasicFormula(includeTagClauses, clauseConnectors);
    onReplaceTagFilterFormula(nextFormula, {
      selectedClauseIndex: nextFormula.clauses.length > 0 ? 0 : null,
    });
  };

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
          ...songDetailFilters,
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
          ...songDetailFilters,
        });
      try {
        await onCreateSmartPlaylist(smartPlaylistCriteria);
        // Local files on this computer were added with the rest; only others are left to add by hand.
        const { addable, localElsewhere } = await addableHere(trackUris);
        Spicetify.showNotification(
          `Created smart playlist "${playlistName}" with ${addable.length} ${addable.length === 1 ? "track" : "tracks"}.${localElsewhere.length ? " Local tracks need to be added manually." : ""}`,
        );
        if (!localElsewhere.length) {
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
      setSongDetailFilters(playlist.criteria);
      setShowFilterOptions(true);
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
      setShowFilterOptions,
      setSongDetailFilters,
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
      const matchingTrackUris = collectMatchingTrackUris(tracks, playlist.criteria, taxonomy);
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

  const navigateToArtist = (artistName: string, trackUri: string) => openSpotifyArtist(artistName, trackUri);

  const playAllFilteredTracks = async (): Promise<void> => {
    if (allSortedTracks.length === 0) return;

    const trackUris = allSortedTracks.map(([uri]) => uri);
    await trackService.playAllFilteredTracks(trackUris);
  };

  return (
    <div ref={listContainerRef} className={styles.container} data-tagify-track-list="">
      <div className={styles.toolbar}>
      <div className={styles.filterControlsGrid} data-toolbar-part="top" data-view-tabs-row={(taggedByOthersView || toTagTabShown) && !statsTrackSet ? "" : undefined}>
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
                  {taggedByOthersView || toTagTabShown ? (
                    <div ref={viewTabsRef} className={styles.viewTabs} role="tablist" aria-label="Songs to show">
                      <button type="button" role="tab" aria-selected={!othersActive && !toTagActive} className={`${styles.viewTab} ${othersActive || toTagActive ? "" : styles.viewTabActive}`} onClick={() => setSavedView("tagged")} data-tip="tagged-tab">
                        Tagged Tracks
                      </button>
                      {taggedByOthersView ? (
                        <button type="button" role="tab" aria-selected={othersActive} className={`${styles.viewTab} ${othersActive ? styles.viewTabActive : ""}`} onClick={() => setSavedView("others")} data-tip="others-tab">
                          Tagged by others
                          {othersTabHighlight.show ? <span className={styles.viewTabNew}>New</span> : null}
                        </button>
                      ) : null}
                      {toTagTabShown ? (
                        <button type="button" role="tab" aria-selected={toTagActive} className={`${styles.viewTab} ${toTagActive ? styles.viewTabActive : ""}`} onClick={() => setSavedView("toTag")}>
                          To Tag
                        </button>
                      ) : null}
                    </div>
                  ) : <h2 className={styles.title} data-tip="tagged-tab">Tagged Tracks</h2>}
                  {othersActive ? null : toTagActive ? (
                    <span className={styles.trackCount}>
                      {filterCount > 0 || searchTerm.trim() !== ""
                        ? `${filteredTracks.length}/${listedUniqueCount} ${listedUniqueCount === 1 ? "song" : "songs"}`
                        : `${listedUniqueCount} ${listedUniqueCount === 1 ? "song" : "songs"}`}
                    </span>
                  ) : (
                    <span className={styles.trackCount}>
                      {filterCount > 0 || searchTerm.trim() !== ""
                        ? `${filteredTracks.length}/${
                            uniqueTrackCount
                          } ${uniqueTrackCount === 1 ? "track" : "tracks"}`
                        : `${uniqueTrackCount} ${uniqueTrackCount === 1 ? "track" : "tracks"}`}
                    </span>
                  )}
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
        {othersActive ? null : <>
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
            data-tip="create-playlist"
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
              data-tip="smart-playlists"
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
        </>}
      </div>

      {othersActive ? null : <>
        {/* FILTER CONTROLS */}
        <div className={styles.filterControlsGrid} data-toolbar-part="bottom">
          {/* Left zone - Filter toggle. A list from Stats already is the filter; search and sorting still apply. */}
          {!statsTrackSet && (
            <div className={styles.filterControlsLeftGrid}>
              <button
                className={`${styles.filterToggle} ${
                  showFilterOptions ? styles.filterToggleActive : ""
                }`}
                onClick={() => setShowFilterOptions(!showFilterOptions)}
                data-tip="tag-filters"
              >
                Filters{" "}
                {filterCount > 0 && (
                  <span className={styles.filterBadge}>{filterCount}</span>
                )}
              </button>
            </div>
          )}

          {/* Center zone - active formula */}
          {/* Right zone - Sort controls */}
          <div className={styles.filterControlsRightGrid}>
            <label className={`form-label ${styles.sortLabel}`}>Sort by:</label>
            <span className={styles.sortSelectWrap}>
            <select
              value={effectiveSortBy}
              onChange={(e) => {
                setSortBy(e.target.value as SortOption);
                if (e.target.value === SORT_OPTIONS.COMMUNITY_PEOPLE) {
                  recordProductInteraction("track_list_sort_changed", { sort: "community_people", after_highlight: sortHighlight.show ? "yes" : "no" });
                }
                if (sortHighlight.show) sortHighlight.dismiss();
              }}
              onBlur={() => { if (sortHighlight.show) sortHighlight.dismiss(); }}
              className={`form-select ${sortHighlight.show ? styles.sortSelectNew : ""}`}
            >
              <option value={SORT_OPTIONS.DATE_MODIFIED}>Last updated</option>
              <option value={SORT_OPTIONS.DATE_CREATED}>Date created</option>
              <option value={SORT_OPTIONS.ALPHABETICAL}>Name</option>
              <option value={SORT_OPTIONS.RATING}>Rating</option>
              <option value={SORT_OPTIONS.ENERGY}>Energy</option>
              <option value={SORT_OPTIONS.BPM}>BPM</option>
              {community.available && (
                <option value={SORT_OPTIONS.COMMUNITY_PEOPLE}>
                  {sortHighlight.show ? "Most tagged by others (new)" : "Most tagged by others"}
                </option>
              )}
            </select>
            {sortHighlight.show && <span className={styles.sortNewBadge} aria-hidden="true">New</span>}
            </span>

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
            {effectiveSortBy === SORT_OPTIONS.COMMUNITY_PEOPLE && community.status === "checking" && (
              <span className={styles.communitySortStatus} role="status">Checking Community…</span>
            )}
          </div>
        </div>
      </>}
      </div>

      {othersActive ? <div className={styles.othersView} role="tabpanel">{taggedByOthersView}</div> : <>
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
              {filterCount > 0 ? (
                <button
                  className={styles.clearFilters}
                  onClick={clearEveryFilter}
                >
                  Clear All
                </button>
              ) : null}
            </div>
          </div>

          {/* Energy, BPM, Length and Released on one line, or two and two when the window is narrower. */}
          <div className={styles.filterSectionsRow}>
            {allEnergyLevels.size > 0 && (
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>Energy</h3>
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
                <h3 className={styles.filterSectionTitle}>BPM</h3>
                <div className={styles.rangeFilter}>
                  <div className={"form-field"}>
                    <label className={"form-label"}>From:</label>
                    <FilterValueField
                      ariaLabel="Lowest BPM"
                      value={bpmMinFilter}
                      options={sortedBpmValues}
                      parse={parseBpmInput}
                      hint="Type a BPM like 124"
                      onChange={handleBpmMinChange}
                    />
                  </div>

                  <div className={"form-field"}>
                    <label className={"form-label"}>To:</label>
                    <FilterValueField
                      ariaLabel="Highest BPM"
                      value={bpmMaxFilter}
                      options={sortedBpmValues}
                      parse={parseBpmInput}
                      hint="Type a BPM like 124"
                      onChange={handleBpmMaxChange}
                    />
                  </div>
                </div>
              </div>
            )}

            {(hasSongLengths || songDetailFilters.lengthMinFilter !== null || songDetailFilters.lengthMaxFilter !== null) && (
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>Length</h3>
                <div className={styles.rangeFilter}>
                  <div className={"form-field"}>
                    <label className={"form-label"}>From:</label>
                    <FilterValueField
                      ariaLabel="Shortest song length"
                      value={songDetailFilters.lengthMinFilter ?? null}
                      options={lengthOptions(songDetailFilters.lengthMinFilter ?? null)}
                      parse={parseLengthInput}
                      format={formatLength}
                      hint="Type a length like 3:30"
                      onChange={handleLengthMinChange}
                    />
                  </div>

                  <div className={"form-field"}>
                    <label className={"form-label"}>To:</label>
                    <FilterValueField
                      ariaLabel="Longest song length"
                      value={songDetailFilters.lengthMaxFilter ?? null}
                      options={lengthOptions(songDetailFilters.lengthMaxFilter ?? null)}
                      parse={parseLengthInput}
                      format={formatLength}
                      hint="Type a length like 3:30"
                      onChange={handleLengthMaxChange}
                    />
                  </div>
                </div>
              </div>
            )}

            {(allReleaseYears.size > 0 || songDetailFilters.releaseYearMinFilter !== null || songDetailFilters.releaseYearMaxFilter !== null) && (
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>Released</h3>
                <div className={styles.rangeFilter}>
                  <div className={"form-field"}>
                    <label className={"form-label"}>From:</label>
                    <FilterValueField
                      ariaLabel="Earliest release year"
                      value={songDetailFilters.releaseYearMinFilter ?? null}
                      options={yearOptions(allReleaseYears, songDetailFilters.releaseYearMinFilter ?? null)}
                      parse={parseYearInput}
                      hint="Type a year like 1995"
                      onChange={handleReleaseYearMinChange}
                    />
                  </div>

                  <div className={"form-field"}>
                    <label className={"form-label"}>To:</label>
                    <FilterValueField
                      ariaLabel="Latest release year"
                      value={songDetailFilters.releaseYearMaxFilter ?? null}
                      options={yearOptions(allReleaseYears, songDetailFilters.releaseYearMaxFilter ?? null)}
                      parse={parseYearInput}
                      hint="Type a year like 1995"
                      onChange={handleReleaseYearMaxChange}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <SongDetailsProgressBar progress={songDetailsFill} />

          {(advancedFilters || normalizedCamelotKeyFilters.length > 0) && (
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
            <div className={`${styles.filterSection} ${styles.tagsFilterSection}`}>
              {tagFilterEditorMode === "complex" ? (
                <div className={styles.tagSectionHeader}>
                  <h3 className={styles.filterSectionTitle}>Tags</h3>
                </div>
              ) : null}

              <div className={styles.groupBuilder}>

                {tagFilterEditorMode === "basic" && !canUseBasicMode ? (
                  <div className={styles.logicEmptyState}>
                    <p className={styles.groupBuilderEmpty}>
                      These tag filters use groups: {activeTagFormula}. Turn on
                      advanced filters to edit them.
                    </p>
                    <div className={styles.logicWorkspaceActions}>
                      <button
                        className={styles.addGroupButton}
                        onClick={() => setAdvancedFilters(true)}
                      >
                        Turn on advanced filters
                      </button>
                      <button
                        className={styles.addGroupButton}
                        onClick={handleCombineIntoOneGroup}
                      >
                        Combine into one group
                      </button>
                    </div>
                  </div>
                ) : tagFilterEditorMode === "basic" ? (
                  <div className={styles.basicTags}>
                    <div className={styles.basicTagBar}>
                      <h3 className={styles.filterSectionTitle}>Tags</h3>
                      <div className={styles.tagSearch}>
                        <input
                          type="text"
                          placeholder="Search tags in library..."
                          value={tagSearchTerm}
                          onChange={(e) => setTagSearchTerm(e.target.value)}
                          className={styles.tagSearchInput}
                        />
                      </div>
                      {renderCategorySelect("basic")}
                      <div className={styles.operatorToggle}>
                        {[TAG_FILTER_OPERATORS.OR, TAG_FILTER_OPERATORS.AND].map((operator) => (
                          <button
                            key={`basic-operator-${operator}`}
                            className={`${styles.operatorToggleButton} ${
                              basicClause.operator === operator ? styles.operatorToggleButtonActive : ""
                            }`}
                            onClick={() => handleSetBasicClauseOperator(operator)}
                          >
                            {operator === TAG_FILTER_OPERATORS.OR ? "Match Any" : "Match All"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {basicClause.tagIds.length + basicClause.excludedTagIds.length > 0
                      ? renderAppliedTagFilters(basicClause, 0)
                      : null}
                    <p className={styles.tagLibraryHelp}>
                      Click a tag to cycle it through{" "}
                      <strong>Match → NOT → off</strong>.
                    </p>
                    {renderTagLibraryBody("basic")}
                  </div>
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
                        <div className={`${styles.tagLibraryControls} ${styles.tagLibraryControlsWithCategory}`}>
                          <div className={styles.tagSearch}>
                            <input
                              type="text"
                              placeholder="Search tags in library..."
                              value={tagSearchTerm}
                              onChange={(e) => setTagSearchTerm(e.target.value)}
                              className={styles.tagSearchInput}
                            />
                          </div>
                          {renderCategorySelect("complex")}
                        </div>
                      </div>

                      {renderTagLibraryBody("complex")}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {communityTagShown && communityTagSearch ? (
        <div className={styles.communityTagSwitch} role="tablist" aria-label="Songs tagged this way">
          <button type="button" role="tab" aria-selected={tagSearchView === "library"} className={`${styles.communityTagOption} ${tagSearchView === "library" ? styles.communityTagOptionOn : ""}`} onClick={() => setTagSearchView("library")}>
            Your library
          </button>
          <button type="button" role="tab" aria-selected={tagSearchView === "community"} className={`${styles.communityTagOption} ${tagSearchView === "community" ? styles.communityTagOptionOn : ""}`} onClick={openCommunityTags}>
            On Community{communityTagFound ? ` (${communityTagCount})` : ""}
            {tagSearchNew.show ? <span className={styles.communityTagNew}>New</span> : null}
          </button>
        </div>
      ) : null}
      {showingCommunityTags && communityTagSearch ? (
        <CommunityTagSearch tags={communityTagQuery.tags} match={communityTagQuery.match} viewer={communityTagSearch.viewer} search={communityTagResults} bare
          onPlay={communityTagSearch.onPlay} onConnect={communityTagSearch.onConnect} onShare={communityTagSearch.onShare} />
      ) : null}

      {/* TRACK LIST */}
      {notePreviews.error && <PrivateNotePreviewError onRetry={notePreviews.retry} />}
      <div className={styles.trackList} hidden={showingCommunityTags}>
        {sortedTracksVisible.length === 0 ? (
          <p className={styles.noTracks}>
            {toTagActive && toTagList.length === 0
              ? "Nothing to tag. Right-click a song in Spotify and choose Add to To Tag to come back to it here."
              : Object.keys(deferredTracks).length === 0
              ? "No tagged tracks yet. Start tagging your favorite tracks!"
              : "No tracks match your filters."}
          </p>
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
                  isActiveTrack ? styles.activeTrackItem : styles.trackItemLockable
                } ${toTagActive ? styles.trackItemWithDone : ""}`}
                // Clicking a song locks it in the editor above, as in "Tagged by others"; its own
                // controls (Play, tags, links, ratings) keep their own clicks.
                tabIndex={isActiveTrack ? undefined : 0}
                aria-current={isActiveTrack ? "true" : undefined}
                aria-label={isActiveTrack ? undefined : `Edit ${displayInfo.name}`}
                onClick={(event) => {
                  if (isActiveTrack || isRowControl(event.target, event.currentTarget)) return;
                  onTagTrack(uri);
                }}
                onKeyDown={(event) => {
                  if (isActiveTrack || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onTagTrack(uri);
                }}
              >
                {/* Cover with Play under it on the left; title, artist and everything else in one column beside it,
                    so the stars line up with the title (Alex, 2026-11-17). */}
                <CoverPlay name={displayInfo.name} current={player.uri === uri} playing={player.uri === uri && player.playing} onPlay={() => onPlayTrack(uri)} size={TRACK_COVER_SIZE}>
                  <TrackCover imageUrl={isLocalFile ? null : trackData.albumImageUrl} />
                </CoverPlay>
                {/* Done sits in the card's top right (Alex's pick C, 2026-11-22). */}
                {toTagActive ? (
                  <button
                    type="button"
                    className={styles.toTagDone}
                    onClick={() => removeFromToTag([uri])}
                    title="Done: take this song off your To Tag list"
                    aria-label={`Done: take ${displayInfo.name} off your To Tag list`}
                  >
                    <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
                  </button>
                ) : null}
                <div className={styles.trackItemBody}>
                <div className={styles.trackItemInfo}>
                  <div className={styles.trackItemIdentity}>
                    <div className={styles.trackItemTextInfo}>
                      <span
                        className={`${styles.trackItemTitle} ${
                          !isLocalFile ? styles.clickable : ""
                        } ${isActiveTrack ? styles.activeTrackTitle : ""}`}
                        data-row-control={!isLocalFile ? "" : undefined}
                        onClick={(event) => {
                          if (isLocalFile) return;
                          event.stopPropagation();
                          navigateToAlbum(uri);
                        }}
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

                      {(community.others.has(uri) || teaserOthers.has(uri)) && (() => {
                        const others = community.others.get(uri) ?? teaserOthers.get(uri)!;
                        const teased = !community.others.has(uri);
                        const own = new Set(sortedTagsArray.map((tag) => sameTagNameKey(tag.displayName)));
                        const shown = others.tags.slice(0, COMMUNITY_ROW_TAGS);
                        const open = openCommunityRows.has(uri);
                        return (
                          <button
                            type="button"
                            className={`${styles.trackItemCommunityToggle} ${open ? styles.trackItemCommunityToggleOpen : ""}`}
                            aria-expanded={open}
                            aria-controls={`track-community-${uri}`}
                            title={open ? "Hide other members' tags"
                              : teased ? `${communityPeopleTitle(others)}\nCreate account or sign in to add the ones you like`
                              : othersTagsLocked ? `${communityPeopleTitle(others)}\n${allTagsHidden ? "All your tags are hidden. Show some of them" : "Share your tags on Community"} to see them all and add the ones you like`
                              : `${communityPeopleTitle(others)}\nClick to see them all and add the ones you like`}
                            onClick={() => {
                              if (!open && !othersTagsLocked && !teased) recordProductInteraction("track_list_others_opened");
                              toggleCommunityRow(uri);
                            }}
                          >
                            <span className={styles.trackItemCommunityPeople}>
                              <FontAwesomeIcon icon={faUserGroup} />
                              <span>{formatCommunityPeople(others)}</span>
                            </span>
                            <span className={styles.trackItemCommunityTags}>
                              {shown.map((tag) => (
                                <span
                                  key={tag.label}
                                  className={`${styles.trackItemCommunityTag} ${own.has(sameTagNameKey(tag.label)) ? styles.trackItemCommunityTagOwned : ""}`}
                                >
                                  {tag.label}
                                </span>
                              ))}
                              {others.tags.length > shown.length && (
                                <span className={styles.trackItemCommunityMore}>+{others.tags.length - shown.length}</span>
                              )}
                            </span>
                            <ChevronDown size={14} aria-hidden="true" className={styles.trackItemCommunityChevron} />
                          </button>
                        );
                      })()}

                      <RowTimestamps created={trackData.dateCreated} modified={trackData.dateModified} />
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
                  {openCommunityRows.has(uri) && !community.others.has(uri) && teaserOthers.has(uri) && teaser && (
                    <div id={`track-community-${uri}`}>
                      <OthersTagsGate
                        ask="connect"
                        onShare={teaser.onConnect}
                        onClose={() => toggleCommunityRow(uri)}
                      />
                    </div>
                  )}
                  {openCommunityRows.has(uri) && community.others.has(uri) && othersTagsLocked && (
                    <div id={`track-community-${uri}`}>
                      <OthersTagsGate
                        onShare={() => onShareTags?.()}
                        onClose={() => toggleCommunityRow(uri)}
                      />
                    </div>
                  )}
                  {openCommunityRows.has(uri) && community.others.has(uri) && !othersTagsLocked && onAddCommunityTags && (
                    <div id={`track-community-${uri}`}>
                      <TrackCommunityPanel
                        uri={uri}
                        songName={displayInfo.name}
                        others={community.others.get(uri)!}
                        songTagKeys={new Set(sortedTagsArray.map((tag) => sameTagNameKey(tag.displayName)))}
                        libraryTagKeys={libraryTagKeys}
                        destinationOf={(tag) => communityTagDestination(taxonomy, tag.paths)}
                        ownHandle={ownCommunityHandle}
                        onAdd={(tags) => onAddCommunityTags(uri, tags)}
                      />
                    </div>
                  )}
                </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {allSortedTracks.length > sortedTracksVisible.length && !showingCommunityTags && (
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
      </>}
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
          songDetailFilters={songDetailFilters}
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

/** A click on one of a row's own controls (Play, tag chips, links, stars), which must not lock the row. */
/** Tagged Tracks covers (with their play bar), a little larger than a list thumbnail. */
const TRACK_COVER_SIZE = 64;

function isRowControl(target: EventTarget, row: Element): boolean {
  const control = target instanceof Element ? target.closest("button, a, input, select, textarea, label, [role='button'], [role='slider'], [data-row-control], [class*='clickable']") : null;
  return !!control && control !== row && row.contains(control);
}

export default TrackList;
