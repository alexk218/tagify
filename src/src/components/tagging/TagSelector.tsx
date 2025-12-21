import React, { useEffect, useRef } from "react";
import styles from "./TagSelector.module.css";
import { TagCategory, TrackTag } from "@/hooks/data/useTagData";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { Lightbulb, Lock, Tag } from "lucide-react";

interface TagSelectorProps {
  categories: TagCategory[];
  trackTags: TrackTag[];
  onToggleTag: (
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => void;
  onOpenTagManager: () => void;
  isMultiTagging: boolean;
  isLockedTrack: boolean;
}

const TagSelector: React.FC<TagSelectorProps> = ({
  categories,
  trackTags,
  onToggleTag,
  onOpenTagManager,
  isMultiTagging = false,
  isLockedTrack = false,
}) => {
  // Store arrays in localStorage and convert to Sets when needed
  const [expandedCategoryIds, setExpandedCategoryIds] = useLocalStorage<
    string[]
  >("tagify:expandedCategories", []);
  const [expandedSubcategoryIds, setExpandedSubcategoryIds] = useLocalStorage<
    string[]
  >("tagify:expandedSubcategories", []);
  const [areAllExpanded, setAreAllExpanded] = useLocalStorage<boolean>(
    "tagify:areAllExpanded",
    false
  );
  const [searchTerm, setSearchTerm] = useLocalStorage<string>(
    "tagify:tagSearchTerm",
    ""
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Create Set objects from the stored arrays for efficient lookups
  const expandedCategories = new Set(expandedCategoryIds);
  const expandedSubcategories = new Set(expandedSubcategoryIds);

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    setExpandedCategoryIds((prev) => {
      if (prev.includes(categoryId)) {
        return prev.filter((id) => id !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  };

  // Toggle subcategory expansion
  const toggleSubcategory = (subcategoryId: string) => {
    setExpandedSubcategoryIds((prev) => {
      if (prev.includes(subcategoryId)) {
        return prev.filter((id) => id !== subcategoryId);
      } else {
        return [...prev, subcategoryId];
      }
    });
  };

  // Function to expand all categories and subcategories
  const expandAll = () => {
    const allCategoryIds = categories.map((category) => category.id);
    const allSubcategoryIds = categories.flatMap((category) =>
      category.subcategories.map((subcategory) => subcategory.id)
    );

    setExpandedCategoryIds(allCategoryIds);
    setExpandedSubcategoryIds(allSubcategoryIds);
    setAreAllExpanded(true);
  };

  // Function to collapse all categories and subcategories
  const collapseAll = () => {
    setExpandedCategoryIds([]);
    setExpandedSubcategoryIds([]);
    setAreAllExpanded(false);
  };

  // Toggle expand/collapse all
  const toggleExpandAll = () => {
    if (areAllExpanded) {
      collapseAll();
    } else {
      expandAll();
    }
  };

  // Check if a tag is applied to the track
  const isTagApplied = (
    categoryId: string,
    subcategoryId: string,
    tagId: string
  ) => {
    return trackTags.some(
      (tag) =>
        tag.categoryId === categoryId &&
        tag.subcategoryId === subcategoryId &&
        tag.tagId === tagId
    );
  };

  // Filter function for tags
  const filterTag = (tagName: string) => {
    if (!searchTerm) return true;
    return tagName.toLowerCase().includes(searchTerm.toLowerCase());
  };

  // Auto-expand categories and subcategories when searching
  useEffect(() => {
    if (!searchTerm) return;

    // Find categories and subcategories that contain matching tags
    const matchingCategoryIds: string[] = [];
    const matchingSubcategoryIds: string[] = [];

    categories.forEach((category) => {
      let categoryHasMatches = false;

      category.subcategories.forEach((subcategory) => {
        const hasMatchingTags = subcategory.tags.some((tag) =>
          tag.name.toLowerCase().includes(searchTerm.toLowerCase())
        );

        if (hasMatchingTags) {
          matchingSubcategoryIds.push(subcategory.id);
          categoryHasMatches = true;
        }
      });

      if (categoryHasMatches) {
        matchingCategoryIds.push(category.id);
      }
    });

    // Expand matching categories and subcategories
    setExpandedCategoryIds(matchingCategoryIds);
    setExpandedSubcategoryIds(matchingSubcategoryIds);
  }, [
    searchTerm,
    categories,
    setExpandedCategoryIds,
    setExpandedSubcategoryIds,
  ]);

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <div className={styles.titleContainer}>
          <h2 className={styles.title}>
            {isMultiTagging
              ? "Add tags to all selected tracks"
              : "Tag your tracks"}
          </h2>

          <div className={styles.helpTooltip}>
            ?
            <div className={styles.tooltipContent}>
              <Lightbulb size={16} />{" "}
              <strong>Pro tip:</strong> Select multiple tracks in any playlist,
              right-click, and choose "Bulk Tag" to tag multiple tracks at once!
            </div>
          </div>
        </div>
        <div className={styles.controls}>
          <button
            className={styles.expandCollapseButton}
            onClick={toggleExpandAll}
            title={
              areAllExpanded
                ? "Collapse all categories"
                : "Expand all categories"
            }
          >
            <span className={styles.expandCollapseIcon}>
              {areAllExpanded ? "▼" : "►"}
            </span>
            {areAllExpanded ? "Collapse All" : "Expand All"}
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
          <div className="search-box">
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
        {categories?.map((category) => {
          const hasMatchingTags = category.subcategories.some((subcategory) =>
            subcategory.tags.some((tag) => filterTag(tag.name))
          );

          if (searchTerm && !hasMatchingTags) return null;

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
                  {category.subcategories?.map((subcategory) => {
                    const hasMatchingSubcategoryTags = subcategory.tags.some(
                      (tag) => filterTag(tag.name)
                    );

                    if (searchTerm && !hasMatchingSubcategoryTags) return null;

                    const isSubcategoryExpanded = expandedSubcategories.has(
                      subcategory.id
                    );

                    return (
                      <div key={subcategory.id} className={styles.subcategory}>
                        <div
                          className={styles.subcategoryHeader}
                          onClick={() => toggleSubcategory(subcategory.id)}
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
                            {subcategory.tags
                              .filter((tag) => filterTag(tag.name))
                              .map((tag) => (
                                <button
                                  key={tag.id}
                                  className={`${styles.tagButton} ${
                                    isTagApplied(
                                      category.id,
                                      subcategory.id,
                                      tag.id
                                    )
                                      ? styles.tagApplied
                                      : ""
                                  }`}
                                  onClick={() =>
                                    onToggleTag(
                                      category.id,
                                      subcategory.id,
                                      tag.id
                                    )
                                  }
                                >
                                  {tag.name}
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
