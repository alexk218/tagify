import React, { useEffect, useMemo } from "react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { PlaylistData, TagAccentId, TagTaxonomy } from "@/types/tagData";
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
import { formatTimestamp } from "@/utils/formatters";
import { buildTagAccentCssVars } from "@/features/tag-data";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { BasicTagFilterBar } from "@/features/filter-state";
import styles from "./TaggedPlaylistsList.module.css";

type SortBy = "dateModified" | "name" | "trackCount" | "rating" | "energy";
type SortOrder = "asc" | "desc";
type PlaylistEntityType = "album" | "playlist";

function getPlaylistEntityLabel(uri: string): "Album" | "Playlist" {
  return uri.startsWith("spotify:album:") ? "Album" : "Playlist";
}

interface TaggedPlaylistsListProps {
  playlists: Record<string, PlaylistData>;
  entityType: PlaylistEntityType;
  taxonomy: TagTaxonomy;
  includeTagClauses: TagFilterClause[];
  clauseConnectors: ("AND" | "OR")[];
  activeTagFilters: string[];
  excludedTagFilters: string[];
  activePlaylistUri: string | null;
  onSelectPlaylist: (playlistUri: string) => void;
  onOpenPlaylist: (playlistUri: string) => void;
  onCycleTagFilter: (tagId: string, operator: TagFilterOperator) => void;
  onRemoveTagFilter: (tagId: string) => void;
  onSetTagFilterOperator: (operator: TagFilterOperator) => void;
  onClearTagFilters: () => void;
}

const TaggedPlaylistsList: React.FC<TaggedPlaylistsListProps> = ({
  playlists,
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
  onRemoveTagFilter,
  onSetTagFilterOperator,
  onClearTagFilters,
}) => {
  const entityLabel = entityType === "album" ? "Album" : "Playlist";
  const entityLabelLower = entityLabel.toLowerCase();
  const entityLabelPlural = entityType === "album" ? "Albums" : "Playlists";
  const entityLabelPluralLower = entityLabelPlural.toLowerCase();
  const entityStoragePrefix =
    entityType === "album" ? "tagify:albumList" : "tagify:playlistList";
  const [searchTerm, setSearchTerm] = useLocalStorage(
    `${entityStoragePrefix}SearchTerm`,
    "",
  );
  const [tagSearchTerm, setTagSearchTerm] = useLocalStorage(
    `${entityStoragePrefix}TagSearchTerm`,
    "",
  );
  const [sortBy, setSortBy] = useLocalStorage<SortBy>(
    `${entityStoragePrefix}SortBy`,
    "dateModified",
  );
  const [sortOrder, setSortOrder] = useLocalStorage<SortOrder>(
    `${entityStoragePrefix}SortOrder`,
    "desc",
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
      `${entityStoragePrefix}TagFilterOperator`,
      TAG_FILTER_OPERATORS.OR,
    );
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
  const playlistEntries = useMemo(
    () =>
      Object.entries(playlists).filter(
        ([playlistUri, playlist]) =>
          (entityType === "album"
            ? playlistUri.startsWith("spotify:album:")
            : playlistUri.startsWith("spotify:playlist:")) &&
          (playlist.tagIds.length > 0 ||
            playlist.rating > 0 ||
            playlist.energy > 0),
      ),
    [entityType, playlists],
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

    playlistEntries.forEach(([, playlist]) => {
      playlist.tagIds.forEach((tagId) => {
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
  }, [playlistEntries, resolvedLookup, tagSearchTerm]);

  const filteredPlaylists = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return playlistEntries.filter(([playlistUri, playlist]) => {
      const matchesTags =
        includeTagClauses.length === 0 ||
        evaluateTagFilterFormula(playlist.tagIds, {
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
    includeTagClauses,
    playlistEntries,
    ratingFilters,
    searchTerm,
  ]);

  const sortedPlaylists = useMemo(
    () =>
      [...filteredPlaylists].sort((left, right) => {
        const [, leftData] = left;
        const [, rightData] = right;
        let comparison = 0;

        if (sortBy === "name") {
          comparison = (leftData.name || "").localeCompare(rightData.name || "");
        } else if (sortBy === "trackCount") {
          comparison = (leftData.trackCount || 0) - (rightData.trackCount || 0);
        } else if (sortBy === "rating") {
          comparison = (leftData.rating || 0) - (rightData.rating || 0);
        } else if (sortBy === "energy") {
          comparison = (leftData.energy || 0) - (rightData.energy || 0);
        } else {
          comparison = (leftData.dateModified || 0) - (rightData.dateModified || 0);
        }

        return sortOrder === "desc" ? -comparison : comparison;
      }),
    [filteredPlaylists, sortBy, sortOrder],
  );

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

  return (
    <section className={styles.container}>
      <div className={styles.filterControlsGrid}>
        <div className={styles.filterControlsLeftGrid}>
          <div className={styles.header}>
            <div className={styles.titleSection}>
              <h2 className={styles.title}>Tagged {entityLabelPlural}</h2>
              <span className={styles.count}>
                {hasActiveFilters
                  ? `${sortedPlaylists.length}/${playlistEntries.length} ${entityLabelPluralLower}`
                  : `${playlistEntries.length} ${entityLabelPluralLower}`}
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
            <option value="dateModified">Last updated</option>
            <option value="name">Name</option>
            <option value="rating">Rating</option>
            <option value="energy">Energy</option>
            <option value="trackCount">Track count</option>
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
                <h3 className={styles.filterSectionTitle}>Rating</h3>
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
                <h3 className={styles.filterSectionTitle}>Energy Level</h3>
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
                    title={
                      isActive
                        ? `Exclude "${tag.name}" from ${entityLabelLower} results`
                        : isExcluded
                          ? `Remove "${tag.name}" from ${entityLabelLower} filters`
                          : `Filter ${entityLabelPluralLower} by "${tag.name}"`
                    }
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

      <div className={styles.list}>
        {sortedPlaylists.length === 0 ? (
          <p className={styles.emptyState}>
            {playlistEntries.length === 0
              ? `No tagged or rated ${entityLabelPluralLower} yet.`
              : `No ${entityLabelPluralLower} match your filters.`}
          </p>
        ) : (
          sortedPlaylists.map(([playlistUri, playlist]) => {
            const entityLabel = getPlaylistEntityLabel(playlistUri);
            const entityLabelLower = entityLabel.toLowerCase();
            const resolvedTags = playlist.tagIds
              .map((tagId) => resolvedLookup.get(tagId))
              .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
              .sort(compareResolvedTagsByTaxonomyOrder);

            return (
              <div
                key={playlistUri}
                className={`${styles.playlistItem} ${
                  activePlaylistUri === playlistUri ? styles.playlistItemActive : ""
                }`}
                onClick={() => onSelectPlaylist(playlistUri)}
              >
                {playlist.imageUrl ? (
                  <img
                    src={playlist.imageUrl}
                    alt={`${playlist.name || entityLabel} cover`}
                    className={`${styles.cover} ${
                      entityLabel === "Album"
                        ? styles.albumCover
                        : styles.playlistCover
                    }`}
                  />
                ) : (
                  <div
                    className={`${styles.cover} ${styles.coverPlaceholder} ${
                      entityLabel === "Album"
                        ? styles.albumCover
                        : styles.playlistCover
                    }`}
                  >
                    ♪
                  </div>
                )}

                <div className={styles.playlistText}>
                  <button
                    type="button"
                    className={styles.playlistName}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenPlaylist(playlistUri);
                    }}
                    title={`Open ${entityLabelLower} in Spotify`}
                  >
                    {playlist.name || `Unknown ${entityLabel}`}
                  </button>
                  <div className={styles.playlistMeta}>
                    <span className={styles.entityBadge}>{entityLabel}</span>
                    {playlist.ownerName ? <span>{playlist.ownerName}</span> : null}
                    {playlist.trackCount !== null &&
                    playlist.trackCount !== undefined ? (
                      <span>{playlist.trackCount} tracks</span>
                    ) : null}
                    {playlist.rating > 0 ? (
                      <span className={styles.playlistRating} title="Rating">
                        <ReactStars
                          key={`${playlistUri}-rating-${playlist.rating}`}
                          count={5}
                          value={playlist.rating}
                          edit={false}
                          size={16}
                          isHalf={true}
                          emptyIcon={<FontAwesomeIcon icon={faStar} />}
                          halfIcon={<FontAwesomeIcon icon={faStarHalf} />}
                          fullIcon={<FontAwesomeIcon icon={faStar} />}
                          activeColor="#ffd700"
                          color="var(--spice-button-disabled)"
                        />
                      </span>
                    ) : null}
                    {playlist.energy > 0 ? (
                      <span className={styles.playlistEnergy} title="Energy">
                        {playlist.energy}
                      </span>
                    ) : null}
                    {playlist.dateModified ? (
                      <span>Updated {formatTimestamp(playlist.dateModified)}</span>
                    ) : null}
                  </div>
                  <div className={styles.tags}>
                    {resolvedTags.map((tag) => (
                      <span
                        key={tag.id}
                        className={`${styles.tag} ${
                          tag.tag.accentId ? styles.tagAccented : ""
                        } ${activeTagFilters.includes(tag.id) ? styles.tagActive : ""} ${
                          excludedTagFilters.includes(tag.id) ? styles.tagExcluded : ""
                        }`}
                        style={buildTagAccentCssVars(
                          tag.tag.accentId ?? null,
                          customAccentsById,
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          onCycleTagFilter(tag.id, tagFilterOperator);
                        }}
                        title={
                          activeTagFilters.includes(tag.id)
                            ? `Exclude "${tag.name}" from ${entityLabelLower} results`
                            : excludedTagFilters.includes(tag.id)
                              ? `Remove "${tag.name}" from ${entityLabelLower} filters`
                              : `Filter ${entityLabelLower}s by "${tag.name}"`
                        }
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default TaggedPlaylistsList;
