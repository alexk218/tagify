import React, { useEffect, useMemo, useRef } from "react";
import styles from "./TagSelector.module.css";
import { CustomTagAccent, TagCategory } from "@/types/tagData";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { Lightbulb, Lock, Tag } from "lucide-react";
import {
  DEFAULT_TAG_SELECTOR_SORT_MODE,
  filterTagSelectorCategories,
  isTagSelectorSortMode,
  sortTagSelectorCategories,
  TAG_SELECTOR_SORT_MODE_OPTIONS,
  type TagSelectorSortMode,
} from "@/features/tag-data/utils/tagSelector.sorting";
import { buildTagAccentCssVars } from "@/features/tag-data/utils/tagAccent";

interface TagSelectorProps {
  categories: TagCategory[];
  customAccentsById: Record<string, CustomTagAccent>;
  selectedTagIds?: string[];
  trackTagIds?: string[];
  onToggleTag: (tagId: string) => void;
  onOpenTagManager: () => void;
  targetType?: "track" | "tracks" | "playlist" | "album" | "artist";
  isMultiTagging: boolean;
  isLockedTrack: boolean;
}

const TagSelector: React.FC<TagSelectorProps> = ({
  categories,
  customAccentsById,
  selectedTagIds,
  trackTagIds,
  onToggleTag,
  onOpenTagManager,
  targetType = "track",
  isMultiTagging = false,
  isLockedTrack = false,
}) => {
  const [expandedCategoryIds, setExpandedCategoryIds] = useLocalStorage<string[]>(
    "tagify:expandedCategories",
    [],
  );
  const [expandedSubcategoryKeys, setExpandedSubcategoryKeys] = useLocalStorage<string[]>(
    "tagify:expandedSubcategories",
    [],
  );
  const [areAllExpanded, setAreAllExpanded] = useLocalStorage<boolean>(
    "tagify:areAllExpanded",
    false,
  );
  const [searchTerm, setSearchTerm] = useLocalStorage<string>(
    "tagify:tagSearchTerm",
    "",
  );
  const [storedSortMode, setStoredSortMode] = useLocalStorage<TagSelectorSortMode>(
    "tagify:tagSelectorSortMode",
    DEFAULT_TAG_SELECTOR_SORT_MODE,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const sortMode = isTagSelectorSortMode(storedSortMode)
    ? storedSortMode
    : DEFAULT_TAG_SELECTOR_SORT_MODE;
  const sortedCategories = useMemo(
    () => sortTagSelectorCategories(categories, sortMode),
    [categories, sortMode],
  );
  const visibleCategories = useMemo(
    () => filterTagSelectorCategories(sortedCategories, searchTerm),
    [sortedCategories, searchTerm],
  );

  const expandedCategories = new Set(expandedCategoryIds);
  const expandedSubcategories = new Set(expandedSubcategoryKeys);

  const buildSubcategoryKey = (categoryId: string, subcategoryId: string) =>
    `${categoryId}:${subcategoryId}`;

  const toggleCategory = (categoryId: string) => {
    setExpandedCategoryIds((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId],
    );
  };

  const toggleSubcategory = (subcategoryKey: string) => {
    setExpandedSubcategoryKeys((prev) =>
      prev.includes(subcategoryKey)
        ? prev.filter((id) => id !== subcategoryKey)
        : [...prev, subcategoryKey],
    );
  };

  const expandAll = () => {
    const allCategoryIds = sortedCategories.map((category) => category.id);
    const allSubcategoryIds = sortedCategories.flatMap((category) =>
      category.subcategories.map((subcategory) =>
        buildSubcategoryKey(category.id, subcategory.id),
      ),
    );

    setExpandedCategoryIds(allCategoryIds);
    setExpandedSubcategoryKeys(allSubcategoryIds);
    setAreAllExpanded(true);
  };

  const collapseAll = () => {
    setExpandedCategoryIds([]);
    setExpandedSubcategoryKeys([]);
    setAreAllExpanded(false);
  };

  const toggleExpandAll = () => {
    if (areAllExpanded) {
      collapseAll();
    } else {
      expandAll();
    }
  };

  const appliedTagIds = selectedTagIds ?? trackTagIds ?? [];
  const isTagApplied = (tagId: string) => appliedTagIds.includes(tagId);
  const selectorTitle =
    targetType === "artist"
      ? "Tag this artist"
      : targetType === "album"
        ? "Tag this album"
      : targetType === "playlist"
        ? "Tag this playlist"
      : isMultiTagging || targetType === "tracks"
        ? "Add tags to all selected tracks"
        : "Tag your tracks";

  useEffect(() => {
    if (!searchTerm) return;

    setExpandedCategoryIds(visibleCategories.map((category) => category.id));
    setExpandedSubcategoryKeys(
      visibleCategories.flatMap((category) =>
        category.subcategories.map((subcategory) =>
          buildSubcategoryKey(category.id, subcategory.id),
        ),
      ),
    );
  }, [searchTerm, setExpandedCategoryIds, setExpandedSubcategoryKeys, visibleCategories]);

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <div className={styles.titleContainer}>
          <h2 className={styles.title}>
            {selectorTitle}
          </h2>

          {targetType !== "playlist" && (
            <div className={styles.helpTooltip}>
              ?
              <div className={styles.tooltipContent}>
                <Lightbulb size={16} /> <strong>Pro tip:</strong> Select multiple
                tracks, right-click, and choose "Bulk Tag" to tag multiple tracks at
                once!
              </div>
            </div>
          )}
        </div>
        <div className={styles.controls}>
          <label className={styles.sortControl}>
            <select
              aria-label="Tag sort order"
              className={styles.sortSelect}
              value={sortMode}
              onChange={(event) =>
                setStoredSortMode(event.target.value as TagSelectorSortMode)
              }
            >
              {TAG_SELECTOR_SORT_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.expandCollapseButton}
            onClick={toggleExpandAll}
            aria-label={
              areAllExpanded
                ? "Collapse all categories"
                : "Expand all categories"
            }
            title={
              areAllExpanded
                ? "Collapse all categories"
                : "Expand all categories"
            }
          >
            <span className={styles.expandCollapseIcon}>
              {areAllExpanded ? "▼" : "►"}
            </span>
            {areAllExpanded ? "Collapse" : "Expand"}
          </button>

          <button
            className={styles.manageButton}
            onClick={(e) => {
              e.stopPropagation();
              onOpenTagManager();
            }}
          >
            Manage Tags
          </button>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder="Search tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={styles.searchInput}
            />
          </div>
        </div>
      </div>

      {isMultiTagging && (
        <div
          className={`${styles.multiTaggingBanner} ${
            isLockedTrack ? styles.locked : ""
          }`}
        >
          <span className={styles.multiTaggingIcon}>
            {isLockedTrack ? <Lock size={16} /> : <Tag size={16} />}
          </span>
          <span className={styles.multiTaggingText}>
            {isLockedTrack
              ? "Tags will be applied to the locked track only"
              : "Tags will be applied to all selected tracks"}
          </span>
        </div>
      )}

      <div className={styles.categoryList}>
        {visibleCategories.map((category) => {
          const isCategoryExpanded = expandedCategories.has(category.id);

          return (
            <div key={category.id} className={styles.category}>
              <div
                className={styles.categoryHeader}
                onClick={() => toggleCategory(category.id)}
              >
                <span className={styles.categoryToggle}>
                  {isCategoryExpanded ? "▼" : "►"}
                </span>
                <h3 className={styles.categoryTitle}>{category.name}</h3>
              </div>

              {isCategoryExpanded && (
                <div className={styles.subcategoryList}>
                  {category.subcategories.map((subcategory) => {
                    const subcategoryKey = buildSubcategoryKey(
                      category.id,
                      subcategory.id,
                    );
                    const isSubcategoryExpanded =
                      expandedSubcategories.has(subcategoryKey);

                    return (
                      <div key={subcategory.id} className={styles.subcategory}>
                        <div
                          className={styles.subcategoryHeader}
                          onClick={() => toggleSubcategory(subcategoryKey)}
                        >
                          <span className={styles.subcategoryToggle}>
                            {isSubcategoryExpanded ? "▼" : "►"}
                          </span>
                          <h4 className={styles.subcategoryTitle}>
                            {subcategory.name}
                          </h4>
                        </div>

                        {isSubcategoryExpanded && (
                          <div className={styles.tagGrid}>
                            {subcategory.tags.map((tag) => (
                              <button
                                key={tag.id}
                                className={`${styles.tagButton} ${
                                  tag.accentId ? styles.tagButtonAccented : ""
                                } ${
                                  isTagApplied(tag.id) ? styles.tagApplied : ""
                                }`}
                                style={buildTagAccentCssVars(
                                  tag.accentId,
                                  customAccentsById,
                                )}
                                onClick={() => onToggleTag(tag.id)}
                              >
                                <span className={styles.tagButtonLabel}>
                                  {tag.name}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TagSelector;
