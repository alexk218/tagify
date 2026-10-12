import { albumTrackListsStore } from "../services/albumTrackLists";
import type { PlaylistTrackInsights } from "@/features/track-insights";
import { useAlbumMembership, useAlbumTrackListLookups } from "../hooks/useAlbumTracks";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import {
  AlbumTrackSummary,
  PlaylistData,
  TagAccentId,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";
import {
  buildResolvedTagLookup,
  compareResolvedTagsByTaxonomyOrder,
} from "@/utils/tagTaxonomy";
import {
  evaluateTagFilterFormula,
  TAG_FILTER_OPERATORS,
  TagFilterClause,
  TagFilterOperator,
} from "@/utils/tagFilterGroups";
import { formatCondensedDate, formatTimestamp } from "@/utils/formatters";
import { buildTagAccentCssVars } from "@/features/tag-data";
import {
  EntityListRow,
  type EntityMetaItem,
  type EntityRowTrackTag,
} from "@/features/entity-views";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import {
  BasicTagFilterBar,
  getBasicTagFilterOperatorStorageKey,
} from "@/features/filter-state";
import {
  buildAlbumTrackSummaries,
  formatTrackAverage,
  getAlbumProgress,
  type AlbumProgress,
} from "../utils/albumTrackSummary";
import {
  useAlbumTrackTotalLookups,
  useKnownAlbumTrackTotals,
} from "../hooks/useAlbumTrackTotals";
import AlbumProgressBar from "./AlbumProgressBar";
import styles from "./TaggedPlaylistsList.module.css";

type SortBy =
  | "dateModified"
  | "name"
  | "trackCount"
  | "rating"
  | "trackAverage"
  | "annotatedCount"
  | "progress"
  | "energy";
type SortOrder = "asc" | "desc";
type PlaylistEntityType = "album" | "playlist";

const SORT_OPTIONS: Record<PlaylistEntityType, Array<{ value: SortBy; label: string }>> = {
  album: [
    { value: "dateModified", label: "Last updated" },
    { value: "name", label: "Name" },
    { value: "rating", label: "Your album rating" },
    { value: "trackAverage", label: "Average track rating" },
    { value: "progress", label: "Progress" },
    { value: "annotatedCount", label: "Most tracks rated/tagged" },
    { value: "energy", label: "Album energy" },
  ],
  playlist: [
    { value: "dateModified", label: "Last updated" },
    { value: "name", label: "Name" },
    { value: "rating", label: "Your playlist rating" },
    { value: "energy", label: "Energy" },
    { value: "trackCount", label: "Track count" },
    { value: "trackAverage", label: "Average track rating" },
    { value: "annotatedCount", label: "Most tracks rated/tagged" },
  ],
};
const MAX_ROW_TRACK_TAGS = 3;

interface TaggedPlaylistsListProps {
  playlists: Record<string, PlaylistData>;
  tracks: Record<string, TrackData>;
  albumTrackSummaries?: Map<string, AlbumTrackSummary>;
  playlistTrackInsights?: Readonly<Record<string, PlaylistTrackInsights>>;
  entityType: PlaylistEntityType;
  taxonomy: TagTaxonomy;
  includeTagClauses: TagFilterClause[];
  clauseConnectors: ("AND" | "OR")[];
  activeTagFilters: string[];
  excludedTagFilters: string[];
  activePlaylistUri: string | null;
  onSelectPlaylist: (playlistUri: string) => void;
  onOpenPlaylist: (playlistUri: string) => void;
  /** Filters panel: include, then exclude, then off. */
  onCycleTagFilter: (tagId: string, operator: TagFilterOperator) => void;
  /** Tags on a row: on, then off. */
  onToggleTagFilter: (tagId: string, operator: TagFilterOperator) => void;
  onRemoveTagFilter: (tagId: string) => void;
  onSetTagFilterOperator: (operator: TagFilterOperator) => void;
  onClearTagFilters: () => void;
}

const NO_SUMMARIES = new Map<string, AlbumTrackSummary>();

function isTrackTotal(value: number | null | undefined): value is number {
  return typeof value === "number" && value > 0;
}

function pluralizeTracks(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

const TaggedPlaylistsList: React.FC<TaggedPlaylistsListProps> = ({
  playlists,
  tracks,
  albumTrackSummaries,
  playlistTrackInsights,
  entityType,
  taxonomy,
  includeTagClauses,
  clauseConnectors,
  activeTagFilters,
  excludedTagFilters,
  activePlaylistUri,
  onSelectPlaylist,
  onOpenPlaylist,
  onCycleTagFilter,
  onToggleTagFilter,
  onRemoveTagFilter,
  onSetTagFilterOperator,
  onClearTagFilters,
}) => {
  const isAlbumList = entityType === "album";
  const entityLabel = isAlbumList ? "Album" : "Playlist";
  const entityLabelLower = entityLabel.toLowerCase();
  const entityLabelPlural = isAlbumList ? "Albums" : "Playlists";
  const entityLabelPluralLower = entityLabelPlural.toLowerCase();
  const entityStoragePrefix = isAlbumList ? "tagify:albumList" : "tagify:playlistList";
  const [searchTerm, setSearchTerm] = useLocalStorage(
    `${entityStoragePrefix}SearchTerm`,
    "",
  );
  const [tagSearchTerm, setTagSearchTerm] = useLocalStorage(
    `${entityStoragePrefix}TagSearchTerm`,
    "",
  );
  const [storedSortBy, setSortBy] = useLocalStorage<SortBy>(
    `${entityStoragePrefix}SortBy`,
    "dateModified",
  );
  const [sortOrder, setSortOrder] = useLocalStorage<SortOrder>(
    `${entityStoragePrefix}SortOrder`,
    "desc",
  );
  const [showSingleTrackAlbums, setShowSingleTrackAlbums] = useLocalStorage(
    "tagify:albumListShowSingleTrackAlbums",
    false,
  );
  const [showFilterOptions, setShowFilterOptions] = useLocalStorage(
    `${entityStoragePrefix}ShowFilterOptions`,
    false,
  );
  const [ratingFilters, setRatingFilters] = useLocalStorage<number[]>(
    `${entityStoragePrefix}RatingFilters`,
    [],
  );
  const [energyMinFilter, setEnergyMinFilter] = useLocalStorage<number | null>(
    `${entityStoragePrefix}EnergyMinFilter`,
    null,
  );
  const [energyMaxFilter, setEnergyMaxFilter] = useLocalStorage<number | null>(
    `${entityStoragePrefix}EnergyMaxFilter`,
    null,
  );
  const [tagFilterOperator, setTagFilterOperator] =
    useLocalStorage<TagFilterOperator>(
      getBasicTagFilterOperatorStorageKey(isAlbumList ? "albums" : "playlists"),
      TAG_FILTER_OPERATORS.OR,
    );
  const sortOptions = SORT_OPTIONS[entityType];
  // Sort choices saved by older versions may no longer exist for this list.
  const sortBy = sortOptions.some((option) => option.value === storedSortBy)
    ? storedSortBy
    : "dateModified";
  const basicTagClause = includeTagClauses[0];

  useEffect(() => {
    if (basicTagClause && basicTagClause.operator !== tagFilterOperator) {
      setTagFilterOperator(basicTagClause.operator);
    }
  }, [basicTagClause, setTagFilterOperator, tagFilterOperator]);
  const resolvedLookup = useMemo(() => buildResolvedTagLookup(taxonomy), [taxonomy]);
  const customAccentsById = taxonomy.customAccentsById;
  const appliedTagFilters = useMemo(
    () => [
      ...activeTagFilters.map((tagId) => {
        const resolved = resolvedLookup.get(tagId);
        return {
          id: tagId,
          name: resolved?.name ?? tagId,
          accentId: resolved?.tag.accentId ?? null,
          excluded: false,
        };
      }),
      ...excludedTagFilters.map((tagId) => {
        const resolved = resolvedLookup.get(tagId);
        return {
          id: tagId,
          name: resolved?.name ?? tagId,
          accentId: resolved?.tag.accentId ?? null,
          excluded: true,
        };
      }),
    ],
    [activeTagFilters, excludedTagFilters, resolvedLookup],
  );
  const handleSetTagFilterOperator = (operator: TagFilterOperator) => {
    setTagFilterOperator(operator);
    if (basicTagClause) {
      onSetTagFilterOperator(operator);
    }
  };
  const membership = useAlbumMembership();
  const resolvedAlbumTrackSummaries = useMemo(
    () =>
      isAlbumList
        ? albumTrackSummaries || buildAlbumTrackSummaries(tracks, taxonomy, membership)
        : NO_SUMMARIES,
    [albumTrackSummaries, isAlbumList, taxonomy, tracks, membership],
  );
  const entityTrackSummaries = useMemo(() => isAlbumList ? resolvedAlbumTrackSummaries
    : new Map(Object.entries(playlistTrackInsights ?? {}).flatMap(([uri, state]) => state.summary ? [[uri, state.summary]] : [])),
    [isAlbumList, resolvedAlbumTrackSummaries, playlistTrackInsights],
  );
  const allPlaylistEntries = useMemo(() => {
    const entries = Object.entries(playlists).filter(
      ([playlistUri, playlist]) =>
        playlistUri.startsWith(isAlbumList ? "spotify:album:" : "spotify:playlist:") &&
        (playlist.tagIds.length > 0 ||
          playlist.rating > 0 ||
          playlist.energy > 0 ||
          resolvedAlbumTrackSummaries.has(playlistUri)),
    );
    if (!isAlbumList) {
      return entries;
    }

    const annotatedAlbums = new Set(entries.map(([albumUri]) => albumUri));
    const entriesWithCovers = entries.map(([albumUri, album]): [string, PlaylistData] => {
      const summaryImageUrl = resolvedAlbumTrackSummaries.get(albumUri)?.imageUrl;
      return !album.imageUrl && summaryImageUrl
        ? [albumUri, { ...album, imageUrl: summaryImageUrl }]
        : [albumUri, album];
    });
    // Albums are also listed when only some of their tracks are tagged.
    const albumsFromTracks = Array.from(resolvedAlbumTrackSummaries)
      .filter(([albumUri]) => !annotatedAlbums.has(albumUri))
      .map(([albumUri, summary]): [string, PlaylistData] => [
        albumUri,
        {
          name: summary.albumName || "Unknown Album",
          ownerName: summary.artistName,
          imageUrl: summary.imageUrl,
          rating: 0,
          energy: 0,
          tagIds: [],
        },
      ]);

    return [...entriesWithCovers, ...albumsFromTracks];
  }, [isAlbumList, playlists, resolvedAlbumTrackSummaries]);
  // An album you haven't rated or tagged yourself, with just one rated or
  // tagged track, says nothing about the album; that track lives in Tracks.
  const singleTrackAlbumUris = useMemo(
    () =>
      new Set(
        isAlbumList
          ? allPlaylistEntries
              .filter(
                ([albumUri, album]) =>
                  album.tagIds.length === 0 &&
                  album.rating <= 0 &&
                  album.energy <= 0 &&
                  (resolvedAlbumTrackSummaries.get(albumUri)?.taggedTrackCount ?? 0) <= 1,
              )
              .map(([albumUri]) => albumUri)
          : [],
      ),
    [allPlaylistEntries, isAlbumList, resolvedAlbumTrackSummaries],
  );
  const hiddenSingleTrackAlbumCount = showSingleTrackAlbums ? 0 : singleTrackAlbumUris.size;
  const playlistEntries = useMemo(
    () =>
      showSingleTrackAlbums
        ? allPlaylistEntries
        : allPlaylistEntries.filter(([albumUri]) => !singleTrackAlbumUris.has(albumUri)),
    [allPlaylistEntries, showSingleTrackAlbums, singleTrackAlbumUris],
  );
  const getLastUpdated = useCallback(
    (playlistUri: string, playlist: PlaylistData): number =>
      Math.max(
        playlist.dateModified || 0,
        resolvedAlbumTrackSummaries.get(playlistUri)?.lastTaggedAt || 0,
      ),
    [resolvedAlbumTrackSummaries],
  );
  const effectiveTagIdsByUri = useMemo(
    () =>
      new Map(
        playlistEntries.map(([playlistUri, playlist]) => [
          playlistUri,
          Array.from(
            new Set([
              ...playlist.tagIds,
              ...(!isAlbumList
                ? entityTrackSummaries.get(playlistUri)?.commonTags.map((tag) => tag.tagId) || []
                : []),
            ]),
          ),
        ]),
      ),
    [playlistEntries, entityTrackSummaries, isAlbumList],
  );
  const allRatings = useMemo(
    () =>
      new Set(
        playlistEntries
          .map(([, playlist]) => playlist.rating || 0)
          .filter((rating) => rating > 0),
      ),
    [playlistEntries],
  );
  const allEnergyLevels = useMemo(
    () =>
      new Set(
        playlistEntries
          .map(([, playlist]) => playlist.energy || 0)
          .filter((energy) => energy > 0),
      ),
    [playlistEntries],
  );

  const playlistTagFilters = useMemo(() => {
    const filters = new Map<
      string,
      {
        name: string;
        displayPath: string;
        accentId: TagAccentId | null;
      }
    >();

    playlistEntries.forEach(([playlistUri]) => {
      (effectiveTagIdsByUri.get(playlistUri) || []).forEach((tagId) => {
        if (filters.has(tagId)) {
          return;
        }

        const resolvedTag = resolvedLookup.get(tagId);
        filters.set(tagId, {
          name: resolvedTag?.name || tagId,
          displayPath: resolvedTag?.displayPath || tagId,
          accentId: resolvedTag?.tag.accentId ?? null,
        });
      });
    });

    const normalizedTagSearch = tagSearchTerm.trim().toLowerCase();

    return Array.from(filters.entries())
      .sort(([, left], [, right]) => left.displayPath.localeCompare(right.displayPath))
      .filter(
        ([, tag]) =>
          normalizedTagSearch === "" ||
          tag.name.toLowerCase().includes(normalizedTagSearch) ||
          tag.displayPath.toLowerCase().includes(normalizedTagSearch),
      );
  }, [effectiveTagIdsByUri, playlistEntries, resolvedLookup, tagSearchTerm]);

  const filteredPlaylists = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return playlistEntries.filter(([playlistUri, playlist]) => {
      const matchesTags =
        includeTagClauses.length === 0 ||
        evaluateTagFilterFormula(effectiveTagIdsByUri.get(playlistUri) || [], {
          clauses: includeTagClauses,
          connectors: clauseConnectors,
        });
      const matchesRating =
        ratingFilters.length === 0 || ratingFilters.includes(playlist.rating || 0);
      const playlistEnergy = playlist.energy || 0;
      const matchesEnergy =
        (energyMinFilter === null && energyMaxFilter === null) ||
        (playlistEnergy > 0 &&
          (energyMinFilter === null || playlistEnergy >= energyMinFilter) &&
          (energyMaxFilter === null || playlistEnergy <= energyMaxFilter));

      const matchesSearch =
        normalizedSearch === "" ||
        (playlist.name || playlistUri).toLowerCase().includes(normalizedSearch) ||
        (playlist.ownerName || "").toLowerCase().includes(normalizedSearch);

      return matchesTags && matchesRating && matchesEnergy && matchesSearch;
    });
  }, [
    clauseConnectors,
    energyMaxFilter,
    energyMinFilter,
    effectiveTagIdsByUri,
    includeTagClauses,
    playlistEntries,
    ratingFilters,
    searchTerm,
  ]);

  const albumTrackTotals = useKnownAlbumTrackTotals();
  const getTrackTotal = useCallback(
    (playlistUri: string, playlist: PlaylistData): number | null =>
      resolvedAlbumTrackSummaries.get(playlistUri)?.totalTrackCount ?? (isTrackTotal(playlist.trackCount)
        ? playlist.trackCount
        : isAlbumList
          ? (albumTrackTotals[playlistUri] ?? null)
          : null),
    [albumTrackTotals, isAlbumList, resolvedAlbumTrackSummaries],
  );

  const sortedPlaylists = useMemo(
    () =>
      [...filteredPlaylists].sort((left, right) => {
        const [leftUri, leftData] = left;
        const [rightUri, rightData] = right;
        let comparison = 0;

        if (sortBy === "name") {
          comparison = (leftData.name || "").localeCompare(rightData.name || "");
        } else if (sortBy === "trackCount") {
          comparison = (playlistTrackInsights?.[leftUri]?.listedTrackCount ?? leftData.trackCount ?? 0) - (playlistTrackInsights?.[rightUri]?.listedTrackCount ?? rightData.trackCount ?? 0);
        } else if (sortBy === "rating") {
          comparison = (leftData.rating || 0) - (rightData.rating || 0);
        } else if (sortBy === "trackAverage") {
          const leftAverage = entityTrackSummaries.get(leftUri)?.ratingAverage;
          const rightAverage = entityTrackSummaries.get(rightUri)?.ratingAverage;
          if (leftAverage == null || rightAverage == null) return leftAverage == null ? (rightAverage == null ? 0 : 1) : -1;
          comparison = leftAverage - rightAverage;
        } else if (sortBy === "annotatedCount") {
          comparison = (entityTrackSummaries.get(leftUri)?.taggedTrackCount ?? 0) -
            (entityTrackSummaries.get(rightUri)?.taggedTrackCount ?? 0);
        } else if (sortBy === "progress") {
          const leftProgress = getAlbumProgress(
            entityTrackSummaries.get(leftUri)?.taggedTrackCount || 0,
            getTrackTotal(leftUri, leftData),
          );
          const rightProgress = getAlbumProgress(
            entityTrackSummaries.get(rightUri)?.taggedTrackCount || 0,
            getTrackTotal(rightUri, rightData),
          );
          comparison =
            (leftProgress.ratio ?? -1) - (rightProgress.ratio ?? -1) ||
            leftProgress.taggedTrackCount - rightProgress.taggedTrackCount;
        } else if (sortBy === "energy") {
          comparison = (leftData.energy || 0) - (rightData.energy || 0);
        } else {
          comparison =
            getLastUpdated(leftUri, leftData) - getLastUpdated(rightUri, rightData);
        }

        return sortOrder === "desc" ? -comparison : comparison;
      }),
    [
      filteredPlaylists,
      getLastUpdated,
      getTrackTotal,
      entityTrackSummaries,
      playlistTrackInsights,
      sortBy,
      sortOrder,
    ],
  );
  const listRef = useRef<HTMLUListElement>(null);
  const [visibleUris, setVisibleUris] = useState<string[]>([]);
  const displayedUrisKey = JSON.stringify(sortedPlaylists.map(([uri]) => uri));
  useEffect(() => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-entity-uri]");
    if (!rows) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisibleUris(JSON.parse(displayedUrisKey).slice(0, 20));
      return;
    }
    const visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const uri = (entry.target as HTMLElement).dataset.entityUri!;
        if (entry.isIntersecting) visible.add(uri); else visible.delete(uri);
      }
      setVisibleUris([...visible]);
    }, { rootMargin: "200px" });
    rows.forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [displayedUrisKey]);
  const albumUrisToLoad = useMemo(() => isAlbumList
    ? [...new Set([...(activePlaylistUri ? [activePlaylistUri] : []), ...visibleUris])]
    : [], [activePlaylistUri, visibleUris, isAlbumList]);
  useAlbumTrackListLookups(albumUrisToLoad);
  // A full tracklist also supplies its total; only failed lists need a separate lookup.
  const albumUrisToLookUp = useMemo(() => albumUrisToLoad.filter(uri =>
    !membership[uri] && !isTrackTotal(playlists[uri]?.trackCount) && albumTrackListsStore.getSnapshot()[uri]?.status === "failed"), [albumUrisToLoad, membership]);
  useAlbumTrackTotalLookups(albumUrisToLookUp);

  const activeTagFilterCount = activeTagFilters.length + excludedTagFilters.length;
  const activeFilterCount =
    activeTagFilterCount +
    (searchTerm.trim() !== "" ? 1 : 0) +
    (ratingFilters.length > 0 ? 1 : 0) +
    (energyMinFilter !== null || energyMaxFilter !== null ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const toggleRatingFilter = (rating: number) => {
    setRatingFilters((currentRatings) =>
      currentRatings.includes(rating)
        ? currentRatings.filter((currentRating) => currentRating !== rating)
        : [...currentRatings, rating],
    );
  };

  const handleEnergyMinChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value, 10);
    setEnergyMinFilter(value);

    if (value !== null && energyMaxFilter !== null && value > energyMaxFilter) {
      setEnergyMaxFilter(value);
    }
  };

  const handleEnergyMaxChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value, 10);
    setEnergyMaxFilter(value);

    if (value !== null && energyMinFilter !== null && energyMinFilter > value) {
      setEnergyMinFilter(value);
    }
  };

  const clearAllFilters = () => {
    setSearchTerm("");
    setTagSearchTerm("");
    setRatingFilters([]);
    setEnergyMinFilter(null);
    setEnergyMaxFilter(null);
    onClearTagFilters();
  };

  const getTagFilterTitle = (tagName: string, tagId: string) =>
    activeTagFilters.includes(tagId)
      ? `Exclude "${tagName}" from ${entityLabelLower} results`
      : excludedTagFilters.includes(tagId)
        ? `Remove "${tagName}" from ${entityLabelLower} filters`
        : `Filter ${entityLabelPluralLower} by "${tagName}"`;
  const getRowTagTitle = (tagName: string, tagId: string) =>
    activeTagFilters.includes(tagId) || excludedTagFilters.includes(tagId)
      ? `Remove "${tagName}" from ${entityLabelLower} filters`
      : `Filter ${entityLabelPluralLower} by "${tagName}"`;

  return (
    <section className={styles.container}>
      <div className={styles.filterControlsGrid}>
        <div className={styles.filterControlsLeftGrid}>
          <div className={styles.header}>
            <div className={styles.titleSection}>
              <h2 className={styles.title}>Tagged {entityLabelPlural}</h2>
              <span className={styles.count}>
                {hasActiveFilters ? `${sortedPlaylists.length}/` : ""}
                {playlistEntries.length}{" "}
                {playlistEntries.length === 1 ? entityLabelLower : entityLabelPluralLower}
                {singleTrackAlbumUris.size > 0 ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    <button
                      type="button"
                      className={styles.countToggle}
                      onClick={() => setShowSingleTrackAlbums((current) => !current)}
                      title="Albums you haven't rated or tagged yourself, where just one track is rated or tagged"
                    >
                      {showSingleTrackAlbums
                        ? `Hide ${singleTrackAlbumUris.size} with one rated or tagged track`
                        : `Show ${singleTrackAlbumUris.size} more with one rated or tagged track`}
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.filterControlsRightGrid}>
          <div className={styles.searchBox}>
            <input
              className={styles.searchInput}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={`Search ${entityLabelPluralLower}...`}
              type="text"
            />
          </div>
        </div>
      </div>

      <div className={styles.filterControlsGrid}>
        <div className={styles.filterControlsLeftGrid}>
          <button
            className={`${styles.filterToggle} ${
              showFilterOptions ? styles.filterToggleActive : ""
            }`}
            onClick={() => setShowFilterOptions((current) => !current)}
          >
            Filters
            {activeFilterCount > 0 ? (
              <span className={styles.filterBadge}>{activeFilterCount}</span>
            ) : null}
          </button>
        </div>

        <div className={styles.filterControlsRightGrid}>
          <label className="form-label">Sort by:</label>
          <select
            className={styles.select}
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortBy)}
            aria-label={`Sort ${entityLabelPluralLower} by`}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className={styles.sortButton}
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            title={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`}
          >
            {sortOrder === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      {showFilterOptions ? (
        <div className={styles.filterOptions}>
          <div className={styles.filterOptionsTopRow}>
            {allRatings.size > 0 ? (
              <div className={`${styles.filterSection} ${styles.filterPrimarySection}`}>
                <h3 className={styles.filterSectionTitle}>{entityLabel} rating</h3>
                <div className={styles.ratingFilters}>
                  {Array.from(allRatings)
                    .sort((a, b) => b - a)
                    .map((rating) => (
                      <button
                        key={`playlist-rating-${rating}`}
                        className={`${styles.ratingFilter} ${
                          ratingFilters.includes(rating)
                            ? styles.ratingFilterActive
                            : ""
                        }`}
                        onClick={() => toggleRatingFilter(rating)}
                        aria-label={`Filter ${entityLabelPluralLower} by ${rating} star rating`}
                        aria-pressed={ratingFilters.includes(rating)}
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
                <button className={styles.clearButton} onClick={clearAllFilters}>
                  Clear All
                </button>
              ) : null}
            </div>
          </div>

          <div className={styles.filterSectionsRow}>
            {allEnergyLevels.size > 0 ? (
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>{entityLabel} energy</h3>
                <div className={styles.rangeFilter}>
                  <div className="form-field">
                    <label className="form-label">From:</label>
                    <select
                      value={energyMinFilter === null ? "" : energyMinFilter.toString()}
                      onChange={handleEnergyMinChange}
                      className="form-select"
                      aria-label={`Minimum ${entityLabelLower} energy`}
                    >
                      <option value="">Any</option>
                      {Array.from(allEnergyLevels)
                        .sort((a, b) => a - b)
                        .map((energy) => (
                          <option key={`playlist-min-energy-${energy}`} value={energy}>
                            {energy}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label className="form-label">To:</label>
                    <select
                      value={energyMaxFilter === null ? "" : energyMaxFilter.toString()}
                      onChange={handleEnergyMaxChange}
                      className="form-select"
                      aria-label={`Maximum ${entityLabelLower} energy`}
                    >
                      <option value="">Any</option>
                      {Array.from(allEnergyLevels)
                        .sort((a, b) => a - b)
                        .map((energy) => (
                          <option key={`playlist-max-energy-${energy}`} value={energy}>
                            {energy}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className={styles.tagSectionHeader}>
            <h3 className={styles.filterSectionTitle}>Tags</h3>
            <input
              className={styles.tagSearchInput}
              value={tagSearchTerm}
              onChange={(event) => setTagSearchTerm(event.target.value)}
              placeholder="Search tags..."
            />
          </div>
          {isAlbumList ? (
            <p className={styles.filterHint}>
              Matches tags you've added to albums. Tags shown under From tracks don't affect album filters.
            </p>
          ) : null}

          <BasicTagFilterBar
            appliedTags={appliedTagFilters}
            operator={tagFilterOperator}
            customAccentsById={customAccentsById}
            onRemoveTag={onRemoveTagFilter}
            onSetOperator={handleSetTagFilterOperator}
          />

          <div className={styles.tagFilterGrid}>
            {playlistTagFilters.length > 0 ? (
              playlistTagFilters.map(([tagId, tag]) => {
                const isActive = activeTagFilters.includes(tagId);
                const isExcluded = excludedTagFilters.includes(tagId);

                return (
                  <button
                    key={tagId}
                    className={`${styles.tagFilterButton} ${
                      tag.accentId ? styles.tagFilterButtonAccented : ""
                    } ${isActive ? styles.tagFilterButtonActive : ""} ${
                      isExcluded ? styles.tagFilterButtonExcluded : ""
                    }`}
                    style={buildTagAccentCssVars(
                      tag.accentId,
                      customAccentsById,
                    )}
                    onClick={() => onCycleTagFilter(tagId, tagFilterOperator)}
                    aria-label={
                      isActive
                        ? `Exclude "${tag.name}"`
                        : isExcluded
                          ? `Remove "${tag.name}" filter`
                          : `Include "${tag.name}"`
                    }
                    title={getTagFilterTitle(tag.name, tagId)}
                  >
                    {tag.name}
                  </button>
                );
              })
            ) : (
              <span className={styles.emptyFilterState}>
                No {entityLabelLower} tags
              </span>
            )}
          </div>
        </div>
      ) : null}

      {sortedPlaylists.length === 0 ? (
        <p className={styles.emptyState}>
          {playlistEntries.length === 0
            ? isAlbumList
              ? "No albums yet. Rate or tag an album, or two of its tracks, to see it here."
              : "No tagged or rated playlists yet."
            : `No ${entityLabelPluralLower} match your filters.`}
          {hiddenSingleTrackAlbumCount > 0 ? (
            <>
              {" "}
              Albums with just one rated or tagged track are hidden.{" "}
              <button
                type="button"
                className={styles.emptyStateAction}
                onClick={() => setShowSingleTrackAlbums(true)}
              >
                Show them
              </button>
            </>
          ) : null}
        </p>
      ) : (
        <ul ref={listRef} className={styles.list}>
          {sortedPlaylists.map(([playlistUri, playlist]) => {
            const ownTags = playlist.tagIds
              .map((tagId) => resolvedLookup.get(tagId))
              .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
              .sort(compareResolvedTagsByTaxonomyOrder)
              .map((tag) => ({
                id: tag.id,
                name: tag.name,
                accentId: tag.tag.accentId ?? null,
                title: getRowTagTitle(tag.name, tag.id),
              }));
            const lastUpdated = getLastUpdated(playlistUri, playlist);
            const playlistInsights = !isAlbumList ? playlistTrackInsights?.[playlistUri] : undefined;
            const listedTrackCount = playlistInsights?.listedTrackCount ?? playlist.trackCount;
            const meta: EntityMetaItem[] = [
              ...(playlist.ownerName ? [{ key: "owner", content: playlist.ownerName }] : []),
              ...(!isAlbumList && listedTrackCount !== null && listedTrackCount !== undefined
                ? [{ key: "tracks", content: pluralizeTracks(listedTrackCount) }]
                : []),
              ...(lastUpdated > 0
                ? [{
                    key: "updated",
                    content: `Updated ${formatCondensedDate(lastUpdated)}`,
                    title: `Last updated ${formatTimestamp(lastUpdated)}`,
                  }]
                : []),
            ];
            const trackSummary = isAlbumList
              ? resolvedAlbumTrackSummaries.get(playlistUri)
              : playlistInsights?.summary;
            const trackTags: EntityRowTrackTag[] = (trackSummary?.commonTags || [])
              .filter((tag) => !playlist.tagIds.includes(tag.tagId))
              .flatMap((tag) => {
                const resolved = resolvedLookup.get(tag.tagId);
                if (!resolved) return [];
                const coverage = isAlbumList
                  ? `${resolved.name} is on ${tag.trackCount} of the ${pluralizeTracks(
                      trackSummary?.taggedTrackCount || 0,
                    )} you've rated or tagged from this album.`
                  : `${resolved.name} is on ${tag.trackCount} of the ${
                      trackSummary?.taggedTrackCount || 0
                    } tracks you've rated or tagged. Click to filter by this tag.`;
                return [{ id: tag.tagId, name: resolved.name, trackCount: tag.trackCount, title: coverage }];
              });
            const average =
              trackSummary && trackSummary.ratingAverage !== null
                ? {
                    text: `Track average: ${formatTrackAverage(trackSummary.ratingAverage)} · ${trackSummary.ratedTrackCount} rated`,
                    title: `Average rating of ${pluralizeTracks(trackSummary.ratedTrackCount)} you've rated`,
                  }
                : null;

            let progress: AlbumProgress | null = null;
            let progressText: string | null = null;
            let progressTitle: string | undefined;
            let status: string | null = null;
            if (isAlbumList) {
              progress = getAlbumProgress(trackSummary?.taggedTrackCount || 0, getTrackTotal(playlistUri, playlist));
              // While an album's length is still unknown, say what was counted
              // rather than "4 tracks", which reads like the album's length.
              progressText =
                progress.totalTrackCount !== null
                  ? `${progress.taggedTrackCount}/${pluralizeTracks(progress.totalTrackCount)}`
                  : progress.taggedTrackCount > 0
                    ? `${progress.taggedTrackCount} rated or tagged`
                    : null;
              progressTitle = `${
                progress.totalTrackCount === null
                  ? pluralizeTracks(progress.taggedTrackCount)
                  : `${progress.taggedTrackCount} of ${pluralizeTracks(progress.totalTrackCount)}`
              } rated or tagged`;
            } else if (trackSummary && playlistInsights?.totalTrackCount) {
              const total = playlistInsights.totalTrackCount;
              progress = getAlbumProgress(trackSummary.taggedTrackCount, total);
              // Repeated songs count once, so say so when the totals differ.
              progressText = `${progress.taggedTrackCount}/${total} ${
                total === listedTrackCount ? "tracks" : "distinct tracks"
              }`;
              progressTitle = `${progress.taggedTrackCount} of ${total} distinct tracks rated or tagged`;
            } else if (!trackSummary && playlistInsights?.status === "loading") {
              status = "Checking tracks…";
            } else if (!trackSummary && playlistInsights?.status === "failed") {
              status = "Couldn't check tracks";
            }

            return (
              <EntityListRow
                key={playlistUri}
                entityUri={playlistUri}
                kind={isAlbumList ? "album" : "playlist"}
                entityLabel={entityLabel}
                name={playlist.name || `Unknown ${entityLabel}`}
                imageUrl={playlist.imageUrl}
                isActive={activePlaylistUri === playlistUri}
                openTitle={`Open ${entityLabelLower} in Spotify`}
                onSelect={() => onSelectPlaylist(playlistUri)}
                onOpen={() => onOpenPlaylist(playlistUri)}
                meta={meta}
                rating={playlist.rating}
                energy={playlist.energy}
                tags={ownTags}
                trackTags={trackTags.slice(0, MAX_ROW_TRACK_TAGS)}
                hiddenTrackTagCount={Math.max(0, trackTags.length - MAX_ROW_TRACK_TAGS)}
                canFilterByTrackTags={!isAlbumList}
                customAccentsById={customAccentsById}
                activeTagFilters={activeTagFilters}
                excludedTagFilters={excludedTagFilters}
                onToggleTag={(tagId) => onToggleTagFilter(tagId, tagFilterOperator)}
                progressBar={progress?.ratio != null ? (
                  <AlbumProgressBar
                    progress={progress}
                    label={`${playlist.name || entityLabel} progress`}
                  />
                ) : null}
                progressText={progressText}
                progressTitle={progressTitle}
                isProgressComplete={progress?.isComplete}
                average={average}
                status={status}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default TaggedPlaylistsList;
