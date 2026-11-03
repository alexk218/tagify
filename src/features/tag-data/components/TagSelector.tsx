import { getQuickTagMatches } from "../utils/quickTag";
import React, { useEffect, useMemo, useRef } from "react";
import styles from "./TagSelector.module.css";
import { CustomTagAccent, Tag as TagNode, TagCategory, TagSubcategory } from "@/types/tagData";
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
import { isTastePackFolderId } from "@/utils/tastePackTaxonomy";

// The taste pack folders a new library's picker has shown. Kept across closing the picker and
// reloading Spotify, so packs added while the picker was hidden still open when it comes back.
const SHOWN_PACK_FOLDERS_KEY = "tagify:shownTastePackFolders";

function readShownPackFolders(): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SHOWN_PACK_FOLDERS_KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function writeShownPackFolders(keys: string[]): void {
  try {
    localStorage.setItem(SHOWN_PACK_FOLDERS_KEY, JSON.stringify(keys));
  } catch { /* The picker may then open these folders again next time. */ }
}

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
  // A library with no tags yet opens every group, unless the person already chose what's open.
  expandForFirstRun?: boolean;
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
  expandForFirstRun = false,
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

  const matches = useMemo(() => getQuickTagMatches(categories, searchTerm), [categories, searchTerm]);
  const exactMatches = matches.filter((tag) => tag.name.toLocaleLowerCase() === searchTerm.trim().toLocaleLowerCase());
  const enterMatch = exactMatches.length === 1 ? exactMatches[0] : exactMatches.length === 0 && matches.length === 1 ? matches[0] : null;

  const expandedCategories = new Set(expandedCategoryIds);
  const expandedSubcategories = new Set(expandedSubcategoryKeys);

  const buildSubcategoryKey = (categoryId: string, subcategoryId: string) =>
    `${categoryId}:${subcategoryId}`;
  const collectSubcategoryKeys = (category: TagCategory) => {
    const keys: string[] = [];
    const visit = (subcategory: TagSubcategory) => {
      keys.push(buildSubcategoryKey(category.id, subcategory.id));
      (subcategory.subcategories || []).forEach(visit);
    };
    category.subcategories.forEach(visit);
    return keys;
  };

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
    const allSubcategoryIds = sortedCategories.flatMap(collectSubcategoryKeys);

    setExpandedCategoryIds(allCategoryIds);
    setExpandedSubcategoryKeys(allSubcategoryIds);
    setAreAllExpanded(true);
  };

  const collapseAll = () => {
    setExpandedCategoryIds([]);
    setExpandedSubcategoryKeys([]);
    setAreAllExpanded(false);
  };

  // Set when the effect below opens everything, which taste pack folders included.
  const openedAllForFirstRun = useRef(false);
  useEffect(() => {
    if (!expandForFirstRun || sortedCategories.length === 0) return;
    try {
      if (localStorage.getItem("tagify:expandedCategories") !== null) return;
    } catch { return; }
    expandAll();
    openedAllForFirstRun.current = true;
    // Only the first render of a new library decides this.
  }, [expandForFirstRun, sortedCategories.length]);

  // In a new library, taste packs open the first time the picker shows them, whether they were added
  // while it was open or hidden. Folders it has already shown keep whatever the person chose.
  useEffect(() => {
    if (!expandForFirstRun) return;
    const openedAll = openedAllForFirstRun.current;
    openedAllForFirstRun.current = false;
    const packFolders = sortedCategories.flatMap((category) => category.subcategories
      .filter((folder) => isTastePackFolderId(folder.id))
      .map((folder) => ({ categoryId: category.id, key: buildSubcategoryKey(category.id, folder.id) })));
    const shown = readShownPackFolders();
    const added = packFolders.filter((folder) => !shown.has(folder.key));
    if (added.length === 0) return;
    writeShownPackFolders([...shown, ...added.map((folder) => folder.key)]);
    // The local storage setters update from this render's value, so they would undo opening everything.
    if (openedAll) return;
    setExpandedCategoryIds((prev) => [...new Set([...prev, ...added.map((folder) => folder.categoryId)])]);
    setExpandedSubcategoryKeys((prev) => [...new Set([...prev, ...added.map((folder) => folder.key)])]);
    // The setters change identity on every render; the folders decide this.
  }, [expandForFirstRun, sortedCategories]);

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

    const categoryIds = visibleCategories.map(category => category.id);
    const subcategoryKeys = visibleCategories.flatMap(collectSubcategoryKeys);
    // Storage setters may change identity; avoid repeatedly storing identical expansion.
    const same = (left: string[], right: string[]) => left.length === right.length && left.every((id, index) => id === right[index]);
    if (!same(expandedCategoryIds, categoryIds)) setExpandedCategoryIds(categoryIds);
    if (!same(expandedSubcategoryKeys, subcategoryKeys)) setExpandedSubcategoryKeys(subcategoryKeys);
  }, [searchTerm, setExpandedCategoryIds, setExpandedSubcategoryKeys, visibleCategories, expandedCategoryIds, expandedSubcategoryKeys]);

  const renderTagGrid = (tags: TagNode[]) => (
    <div className={styles.tagGrid}>
      {tags.map((tag) => (
        <button
          key={tag.id}
          className={`${styles.tagButton} ${
            tag.accentId ? styles.tagButtonAccented : ""
          } ${isTagApplied(tag.id) ? styles.tagApplied : ""}`}
          style={buildTagAccentCssVars(tag.accentId, customAccentsById)}
          title={tag.name}
          aria-pressed={isTagApplied(tag.id)}
          onClick={() => onToggleTag(tag.id)}
        >
          <span className={styles.tagButtonLabel}>
            {tag.name}
          </span>
        </button>
      ))}
    </div>
  );

  const renderSubcategory = (categoryId: string, subcategory: TagSubcategory) => {
    const subcategoryKey = buildSubcategoryKey(categoryId, subcategory.id);
    const isSubcategoryExpanded = expandedSubcategories.has(subcategoryKey);
    const childSubcategories = subcategory.subcategories || [];

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
          <>
            {subcategory.tags.length > 0 && renderTagGrid(subcategory.tags)}
            {childSubcategories.length > 0 && (
              <div className={styles.nestedSubcategoryList}>
                {childSubcategories.map((child) =>
                  renderSubcategory(categoryId, child),
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className={styles.container} ref={containerRef} data-tagify-tag-selector="">
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
              aria-label="Search tags"
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (enterMatch && !isTagApplied(enterMatch.id)) onToggleTag(enterMatch.id);
                }
                if (event.key === "Escape") setSearchTerm("");
              }}
              className={styles.searchInput}
            />
            {searchTerm && <button className={styles.clearSearch} aria-label="Clear tag search" onClick={() => setSearchTerm("")}>×</button>}
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
                  {category.tags && category.tags.length > 0 && renderTagGrid(category.tags)}
                  {category.subcategories.map((subcategory) =>
                    renderSubcategory(category.id, subcategory),
                  )}
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
