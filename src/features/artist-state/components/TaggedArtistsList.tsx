import React, { useEffect, useMemo } from "react";
import ReactStars from "react-rating-stars-component";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faStarHalf } from "@fortawesome/free-solid-svg-icons";
import { ArtistData, TagAccentId, TagTaxonomy } from "@/types/tagData";
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
import { buildTagAccentCssVars } from "@/features/tag-data/utils/tagAccent";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { BasicTagFilterBar } from "@/features/filter-state";
import styles from "./TaggedArtistsList.module.css";

type SortBy = "dateModified" | "name" | "followerCount" | "rating" | "energy";
type SortOrder = "asc" | "desc";

interface TaggedArtistsListProps {
  artists: Record<string, ArtistData>;
  taxonomy: TagTaxonomy;
  includeTagClauses: TagFilterClause[];
  clauseConnectors: ("AND" | "OR")[];
  activeTagFilters: string[];
  excludedTagFilters: string[];
  activeArtistUri: string | null;
  onSelectArtist: (artistUri: string) => void;
  onOpenArtist: (artistUri: string) => void;
  onCycleTagFilter: (tagId: string, operator: TagFilterOperator) => void;
  onRemoveTagFilter: (tagId: string) => void;
  onSetTagFilterOperator: (operator: TagFilterOperator) => void;
  onClearTagFilters: () => void;
}

function formatFollowers(followerCount: number): string {
  return new Intl.NumberFormat().format(followerCount);
}

const TaggedArtistsList: React.FC<TaggedArtistsListProps> = ({
  artists,
  taxonomy,
  includeTagClauses,
  clauseConnectors,
  activeTagFilters,
  excludedTagFilters,
  activeArtistUri,
  onSelectArtist,
  onOpenArtist,
  onCycleTagFilter,
  onRemoveTagFilter,
  onSetTagFilterOperator,
  onClearTagFilters,
}) => {
  const [searchTerm, setSearchTerm] = useLocalStorage(
    "tagify:artistListSearchTerm",
    "",
  );
  const [tagSearchTerm, setTagSearchTerm] = useLocalStorage(
    "tagify:artistListTagSearchTerm",
    "",
  );
  const [sortBy, setSortBy] = useLocalStorage<SortBy>(
    "tagify:artistListSortBy",
    "dateModified",
  );
  const [sortOrder, setSortOrder] = useLocalStorage<SortOrder>(
    "tagify:artistListSortOrder",
    "desc",
  );
  const [showFilterOptions, setShowFilterOptions] = useLocalStorage(
    "tagify:artistListShowFilterOptions",
    false,
  );
  const [ratingFilters, setRatingFilters] = useLocalStorage<number[]>(
    "tagify:artistListRatingFilters",
    [],
  );
  const [energyMinFilter, setEnergyMinFilter] = useLocalStorage<number | null>(
    "tagify:artistListEnergyMinFilter",
    null,
  );
  const [energyMaxFilter, setEnergyMaxFilter] = useLocalStorage<number | null>(
    "tagify:artistListEnergyMaxFilter",
    null,
  );
  const [tagFilterOperator, setTagFilterOperator] =
    useLocalStorage<TagFilterOperator>(
      "tagify:artistListTagFilterOperator",
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
  const artistEntries = useMemo(
    () =>
      Object.entries(artists).filter(([, artist]) => {
        return (
          artist.tagIds.length > 0 ||
          artist.rating > 0 ||
          artist.energy > 0
        );
      }),
    [artists],
  );
  const allRatings = useMemo(
    () =>
      new Set(
        artistEntries
          .map(([, artist]) => artist.rating || 0)
          .filter((rating) => rating > 0),
      ),
    [artistEntries],
  );
  const allEnergyLevels = useMemo(
    () =>
      new Set(
        artistEntries
          .map(([, artist]) => artist.energy || 0)
          .filter((energy) => energy > 0),
      ),
    [artistEntries],
  );

  const artistTagFilters = useMemo(() => {
    const filters = new Map<
      string,
      {
        name: string;
        displayPath: string;
        accentId: TagAccentId | null;
      }
    >();

    artistEntries.forEach(([, artist]) => {
      artist.tagIds.forEach((tagId) => {
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
  }, [artistEntries, resolvedLookup, tagSearchTerm]);

  const filteredArtists = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return artistEntries.filter(([artistUri, artist]) => {
      const matchesTags =
        includeTagClauses.length === 0 ||
        evaluateTagFilterFormula(artist.tagIds, {
          clauses: includeTagClauses,
          connectors: clauseConnectors,
        });
      const matchesRating =
        ratingFilters.length === 0 || ratingFilters.includes(artist.rating || 0);
      const artistEnergy = artist.energy || 0;
      const matchesEnergy =
        (energyMinFilter === null && energyMaxFilter === null) ||
        (artistEnergy > 0 &&
          (energyMinFilter === null || artistEnergy >= energyMinFilter) &&
          (energyMaxFilter === null || artistEnergy <= energyMaxFilter));

      const matchesSearch =
        normalizedSearch === "" ||
        (artist.name || artistUri).toLowerCase().includes(normalizedSearch) ||
        (artist.genres || []).some((genre) =>
          genre.toLowerCase().includes(normalizedSearch),
        );

      return matchesTags && matchesRating && matchesEnergy && matchesSearch;
    });
  }, [
    artistEntries,
    clauseConnectors,
    energyMaxFilter,
    energyMinFilter,
    includeTagClauses,
    ratingFilters,
    searchTerm,
  ]);

  const sortedArtists = useMemo(
    () =>
      [...filteredArtists].sort((left, right) => {
        const [, leftData] = left;
        const [, rightData] = right;
        let comparison = 0;

        if (sortBy === "name") {
          comparison = (leftData.name || "").localeCompare(rightData.name || "");
        } else if (sortBy === "followerCount") {
          comparison = (leftData.followerCount || 0) - (rightData.followerCount || 0);
        } else if (sortBy === "rating") {
          comparison = (leftData.rating || 0) - (rightData.rating || 0);
        } else if (sortBy === "energy") {
          comparison = (leftData.energy || 0) - (rightData.energy || 0);
        } else {
          comparison = (leftData.dateModified || 0) - (rightData.dateModified || 0);
        }

        return sortOrder === "desc" ? -comparison : comparison;
      }),
    [filteredArtists, sortBy, sortOrder],
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
              <h2 className={styles.title}>Tagged Artists</h2>
              <span className={styles.count}>
                {hasActiveFilters
                  ? `${sortedArtists.length}/${artistEntries.length} artists`
                  : `${artistEntries.length} artists`}
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
              placeholder="Search artists..."
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
            aria-label="Sort artists by"
          >
            <option value="dateModified">Last updated</option>
            <option value="name">Name</option>
            <option value="rating">Rating</option>
            <option value="energy">Energy</option>
            <option value="followerCount">Followers</option>
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
                        key={`artist-rating-${rating}`}
                        className={`${styles.ratingFilter} ${
                          ratingFilters.includes(rating)
                            ? styles.ratingFilterActive
                            : ""
                        }`}
                        onClick={() => toggleRatingFilter(rating)}
                        aria-label={`Filter artists by ${rating} star rating`}
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

          {allEnergyLevels.size > 0 ? (
            <div className={styles.filterSectionsRow}>
              <div className={styles.filterSection}>
                <h3 className={styles.filterSectionTitle}>Energy Level</h3>
                <div className={styles.rangeFilter}>
                  <div className="form-field">
                    <label className="form-label">From:</label>
                    <select
                      value={energyMinFilter === null ? "" : energyMinFilter.toString()}
                      onChange={handleEnergyMinChange}
                      className="form-select"
                      aria-label="Minimum artist energy"
                    >
                      <option value="">Any</option>
                      {Array.from(allEnergyLevels)
                        .sort((a, b) => a - b)
                        .map((energy) => (
                          <option key={`artist-min-energy-${energy}`} value={energy}>
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
                      aria-label="Maximum artist energy"
                    >
                      <option value="">Any</option>
                      {Array.from(allEnergyLevels)
                        .sort((a, b) => a - b)
                        .map((energy) => (
                          <option key={`artist-max-energy-${energy}`} value={energy}>
                            {energy}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

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
            {artistTagFilters.length > 0 ? (
              artistTagFilters.map(([tagId, tag]) => {
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
                        ? `Exclude "${tag.name}" from artist results`
                        : isExcluded
                          ? `Remove "${tag.name}" from artist filters`
                          : `Filter artists by "${tag.name}"`
                    }
                  >
                    {tag.name}
                  </button>
                );
              })
            ) : (
              <span className={styles.emptyFilterState}>No artist tags</span>
            )}
          </div>
        </div>
      ) : null}

      <div className={styles.list}>
        {sortedArtists.length === 0 ? (
          <p className={styles.emptyState}>
            {artistEntries.length === 0
              ? "No tagged artists yet. Right-click a Spotify artist and choose Tag artist with Tagify."
              : "No artists match your filters."}
          </p>
        ) : (
          sortedArtists.map(([artistUri, artist]) => {
            const resolvedTags = artist.tagIds
              .map((tagId) => resolvedLookup.get(tagId))
              .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
              .sort(compareResolvedTagsByTaxonomyOrder);

            return (
              <div
                key={artistUri}
                className={`${styles.artistItem} ${
                  activeArtistUri === artistUri ? styles.artistItemActive : ""
                }`}
                onClick={() => onSelectArtist(artistUri)}
              >
                {artist.imageUrl ? (
                  <img
                    src={artist.imageUrl}
                    alt={`${artist.name || "Artist"} image`}
                    className={styles.cover}
                  />
                ) : (
                  <div className={`${styles.cover} ${styles.coverPlaceholder}`}>♪</div>
                )}

                <div className={styles.artistText}>
                  <button
                    type="button"
                    className={styles.artistName}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenArtist(artistUri);
                    }}
                    title="Open artist in Spotify"
                  >
                    {artist.name || "Unknown Artist"}
                  </button>
                  <div className={styles.artistMeta}>
                    {artist.followerCount !== null &&
                    artist.followerCount !== undefined ? (
                      <span>{formatFollowers(artist.followerCount)} followers</span>
                    ) : null}
                    {artist.rating > 0 ? (
                      <span className={styles.artistRating} title="Rating">
                        <ReactStars
                          key={`${artistUri}-rating-${artist.rating}`}
                          count={5}
                          value={artist.rating}
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
                    {artist.energy > 0 ? (
                      <span className={styles.artistEnergy} title="Energy">
                        {artist.energy}
                      </span>
                    ) : null}
                    {artist.dateModified ? (
                      <span>Updated {formatTimestamp(artist.dateModified)}</span>
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
                            ? `Exclude "${tag.name}" from artist results`
                            : excludedTagFilters.includes(tag.id)
                              ? `Remove "${tag.name}" from artist filters`
                              : `Filter artists by "${tag.name}"`
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

export default TaggedArtistsList;
