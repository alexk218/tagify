import React, { useState, useEffect } from "react";
import styles from "./TagManager.module.css";
import { TagCategory, Tag, TagSubcategory } from "../hooks/useTagData";
import Portal from "../utils/Portal";

interface DragState {
  draggedTag: {
    categoryId: string;
    subcategoryId: string;
    tagId: string;
    tagIndex: number;
  } | null;
  dragOverIndex: number | null;
  dragOverSubcategory: string | null;
}

interface TagManagerProps {
  categories: TagCategory[];
  onClose: () => void;
  onReplaceCategories: (newCategories: TagCategory[]) => void;
}

// Utilities copied from useTagData.ts
const generateTagCategoryIdFromName = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/[\s_]+/g, "-") // Replace spaces and underscores with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading and trailing hyphens
};

const ensureUniqueId = (id: string, existingIds: string[]): string => {
  if (!existingIds.includes(id)) return id;

  let counter = 1;
  let newId = `${id}-${counter}`;

  while (existingIds.includes(newId)) {
    counter++;
    newId = `${id}-${counter}`;
  }

  return newId;
};

// Deep clone utility
const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

const TagManager: React.FC<TagManagerProps> = ({ categories, onClose, onReplaceCategories }) => {
  // Local state for categories
  const [localCategories, setLocalCategories] = useState<TagCategory[]>(() =>
    deepClone(categories)
  );
  const [hasChanges, setHasChanges] = useState(false);

  // Custom notification state
  const [notification, setNotification] = useState<{ message: string; isError: boolean } | null>(
    null
  );

  // State for new items
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newSubcategoryInputs, setNewSubcategoryInputs] = useState<{
    [categoryId: string]: string;
  }>({});
  const [newTagInputs, setNewTagInputs] = useState<{ [key: string]: string }>({});

  // State for expanded categories and subcategories
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [expandedSubcategories, setExpandedSubcategories] = useState<string[]>([]);

  const [dragState, setDragState] = useState<DragState>({
    draggedTag: null,
    dragOverIndex: null,
    dragOverSubcategory: null,
  });

  // Reset local state when categories prop changes
  useEffect(() => {
    setLocalCategories(deepClone(categories));
    setHasChanges(false);
  }, [categories]);

  // Initialize input states
  useEffect(() => {
    // Initialize empty inputs for all categories
    const initialSubInputs: { [categoryId: string]: string } = {};
    const initialTagInputs: { [key: string]: string } = {};

    localCategories.forEach((category) => {
      initialSubInputs[category.id] = "";

      category.subcategories.forEach((subcategory) => {
        const key = `${category.id}-${subcategory.id}`;
        initialTagInputs[key] = "";
      });
    });

    setNewSubcategoryInputs(initialSubInputs);
    setNewTagInputs(initialTagInputs);
  }, [localCategories]);

  // Custom notification function
  const showModalNotification = (message: string, isError: boolean = false) => {
    setNotification({ message, isError });
    setTimeout(() => setNotification(null), 4000);
  };

  // Validation functions
  const isTagNameUnique = (name: string, excludeTagId?: string): boolean => {
    const existingTagNames = localCategories.flatMap((category) =>
      category.subcategories.flatMap((subcategory) =>
        subcategory.tags
          .filter((tag) => tag.id !== excludeTagId)
          .map((tag) => tag.name.toLowerCase())
      )
    );

    if (existingTagNames.includes(name.toLowerCase())) {
      const subcategoryWithExistingTagName = localCategories
        .flatMap((category) =>
          category.subcategories.map((subcategory) => ({
            category: category.name,
            subcategory: subcategory.name,
            tags: subcategory.tags,
          }))
        )
        .find((item) => item.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase()));

      showModalNotification(
        `Tag "${name}" already exists in category "${subcategoryWithExistingTagName?.category}" > subcategory "${subcategoryWithExistingTagName?.subcategory}"`,
        true
      );
      return false;
    }
    return true;
  };

  const isCategoryNameUnique = (name: string, excludeCategoryId?: string): boolean => {
    const categoryNameExists = localCategories
      .filter((category) => category.id !== excludeCategoryId)
      .some((category) => category.name.toLowerCase() === name.toLowerCase());

    if (categoryNameExists) {
      showModalNotification(`Category "${name}" already exists`, true);
      return false;
    }
    return true;
  };

  const isSubcategoryNameUnique = (name: string, excludeSubcategoryId?: string): boolean => {
    const subcategoryNameExists = localCategories.some((category) =>
      category.subcategories
        .filter((subcategory) => subcategory.id !== excludeSubcategoryId)
        .some((subcategory) => subcategory.name.toLowerCase() === name.toLowerCase())
    );

    if (subcategoryNameExists) {
      showModalNotification(`Subcategory "${name}" already exists`, true);
      return false;
    }
    return true;
  };

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) =>
      prev.includes(categoryId) ? prev.filter((id) => id !== categoryId) : [...prev, categoryId]
    );
  };

  // Toggle subcategory expansion
  const toggleSubcategory = (subcategoryId: string) => {
    setExpandedSubcategories((prev) =>
      prev.includes(subcategoryId)
        ? prev.filter((id) => id !== subcategoryId)
        : [...prev, subcategoryId]
    );
  };

  // Handle adding a new category
  const handleAddCategory = () => {
    if (newCategoryName.trim()) {
      if (!isCategoryNameUnique(newCategoryName.trim())) return;

      const existingCategoryIds = localCategories.map((c) => c.id);
      const baseId = generateTagCategoryIdFromName(newCategoryName.trim());
      const uniqueId = ensureUniqueId(baseId, existingCategoryIds);

      const newCategory: TagCategory = {
        name: newCategoryName.trim(),
        id: uniqueId,
        subcategories: [],
      };

      setLocalCategories([...localCategories, newCategory]);
      setNewCategoryName("");
      setHasChanges(true);
    }
  };

  // Handle adding a new subcategory
  const handleAddSubcategory = (categoryId: string) => {
    const name = newSubcategoryInputs[categoryId]?.trim();
    if (name) {
      if (!isSubcategoryNameUnique(name)) return;

      const category = localCategories.find((c) => c.id === categoryId);
      if (!category) return;

      const existingSubcategoryIds = category.subcategories.map((s) => s.id);
      const baseId = generateTagCategoryIdFromName(name);
      const uniqueId = ensureUniqueId(baseId, existingSubcategoryIds);

      const newSubcategory: TagSubcategory = {
        name,
        id: uniqueId,
        tags: [],
      };

      const updatedCategories = localCategories.map((cat) =>
        cat.id === categoryId
          ? {
              ...cat,
              subcategories: [...cat.subcategories, newSubcategory],
            }
          : cat
      );

      setLocalCategories(updatedCategories);
      setNewSubcategoryInputs((prev) => ({
        ...prev,
        [categoryId]: "",
      }));
      setHasChanges(true);
    }
  };

  // Handle adding a new tag
  const handleAddTag = (categoryId: string, subcategoryId: string) => {
    const key = `${categoryId}-${subcategoryId}`;
    const name = newTagInputs[key]?.trim();
    if (name) {
      if (!isTagNameUnique(name)) return;

      const category = localCategories.find((c) => c.id === categoryId);
      if (!category) return;

      const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
      if (!subcategory) return;

      const existingTagIds = subcategory.tags.map((t) => t.id);
      const baseId = generateTagCategoryIdFromName(name);
      const uniqueId = ensureUniqueId(baseId, existingTagIds);

      const newTag: Tag = {
        name,
        id: uniqueId,
      };

      const updatedCategories = localCategories.map((cat) =>
        cat.id === categoryId
          ? {
              ...cat,
              subcategories: cat.subcategories.map((sub) =>
                sub.id === subcategoryId
                  ? {
                      ...sub,
                      tags: [...sub.tags, newTag],
                    }
                  : sub
              ),
            }
          : cat
      );

      setLocalCategories(updatedCategories);
      setNewTagInputs((prev) => ({
        ...prev,
        [key]: "",
      }));
      setHasChanges(true);
    }
  };

  // Handle renaming a category
  const handleRenameCategory = (categoryId: string) => {
    const category = localCategories.find((c) => c.id === categoryId);
    if (!category) return;

    const newName = window.prompt("Enter new name for category:", category.name);
    if (newName && newName.trim() && newName !== category.name) {
      if (!isCategoryNameUnique(newName.trim(), categoryId)) return;

      const updatedCategories = localCategories.map((cat) =>
        cat.id === categoryId ? { ...cat, name: newName.trim() } : cat
      );

      setLocalCategories(updatedCategories);
      setHasChanges(true);
    }
  };

  // Handle renaming a subcategory
  const handleRenameSubcategory = (categoryId: string, subcategoryId: string) => {
    const category = localCategories.find((c) => c.id === categoryId);
    if (!category) return;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return;

    const newName = window.prompt("Enter new name for subcategory:", subcategory.name);
    if (newName && newName.trim() && newName !== subcategory.name) {
      if (!isSubcategoryNameUnique(newName.trim(), subcategoryId)) return;

      const updatedCategories = localCategories.map((cat) =>
        cat.id === categoryId
          ? {
              ...cat,
              subcategories: cat.subcategories.map((sub) =>
                sub.id === subcategoryId ? { ...sub, name: newName.trim() } : sub
              ),
            }
          : cat
      );

      setLocalCategories(updatedCategories);
      setHasChanges(true);
    }
  };

  // Handle renaming a tag
  const handleRenameTag = (categoryId: string, subcategoryId: string, tagId: string) => {
    const category = localCategories.find((c) => c.id === categoryId);
    if (!category) return;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return;

    const tag = subcategory.tags.find((t) => t.id === tagId);
    if (!tag) return;

    const newName = window.prompt("Enter new name for tag:", tag.name);
    if (newName && newName.trim() && newName !== tag.name) {
      if (!isTagNameUnique(newName.trim(), tagId)) return;

      const updatedCategories = localCategories.map((cat) =>
        cat.id === categoryId
          ? {
              ...cat,
              subcategories: cat.subcategories.map((sub) =>
                sub.id === subcategoryId
                  ? {
                      ...sub,
                      tags: sub.tags.map((t) =>
                        t.id === tagId ? { ...t, name: newName.trim() } : t
                      ),
                    }
                  : sub
              ),
            }
          : cat
      );

      setLocalCategories(updatedCategories);
      setHasChanges(true);
    }
  };

  // Handle removing a category with confirmation
  const handleRemoveCategory = (categoryId: string) => {
    const category = localCategories.find((c) => c.id === categoryId);
    if (!category) return;

    const confirm = window.confirm(
      `Are you sure you want to delete the category "${category.name}" and all its subcategories and tags?`
    );
    if (confirm) {
      const updatedCategories = localCategories.filter((cat) => cat.id !== categoryId);
      setLocalCategories(updatedCategories);
      setHasChanges(true);
    }
  };

  // Handle removing a subcategory with confirmation
  const handleRemoveSubcategory = (categoryId: string, subcategoryId: string) => {
    const category = localCategories.find((c) => c.id === categoryId);
    if (!category) return;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return;

    const confirm = window.confirm(
      `Are you sure you want to delete the subcategory "${subcategory.name}" and all its tags?`
    );
    if (confirm) {
      const updatedCategories = localCategories.map((cat) =>
        cat.id === categoryId
          ? {
              ...cat,
              subcategories: cat.subcategories.filter((sub) => sub.id !== subcategoryId),
            }
          : cat
      );

      setLocalCategories(updatedCategories);
      setHasChanges(true);
    }
  };

  // Handle removing a tag with confirmation
  const handleRemoveTag = (categoryId: string, subcategoryId: string, tagId: string) => {
    const category = localCategories.find((c) => c.id === categoryId);
    if (!category) return;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return;

    const tag = subcategory.tags.find((t) => t.id === tagId);
    if (!tag) return;

    const confirm = window.confirm(`Are you sure you want to delete the tag "${tag.name}"?`);
    if (confirm) {
      const updatedCategories = localCategories.map((cat) =>
        cat.id === categoryId
          ? {
              ...cat,
              subcategories: cat.subcategories.map((sub) =>
                sub.id === subcategoryId
                  ? {
                      ...sub,
                      tags: sub.tags.filter((t) => t.id !== tagId),
                    }
                  : sub
              ),
            }
          : cat
      );

      setLocalCategories(updatedCategories);
      setHasChanges(true);
    }
  };

  // Save and cancel handlers
  const handleSaveChanges = () => {
    onReplaceCategories(localCategories);
    setHasChanges(false);
    onClose();
  };

  const handleCancel = () => {
    if (hasChanges) {
      const confirmDiscard = window.confirm(
        "You have unsaved changes. Are you sure you want to discard them?"
      );
      if (!confirmDiscard) return;
    }
    setLocalCategories(deepClone(categories));
    setHasChanges(false);
    onClose();
  };

  // Drag and Drop handlers
  const handleDragStart = (
    e: React.DragEvent,
    categoryId: string,
    subcategoryId: string,
    tagId: string,
    tagIndex: number
  ) => {
    setDragState({
      draggedTag: { categoryId, subcategoryId, tagId, tagIndex },
      dragOverIndex: null,
      dragOverSubcategory: null,
    });

    // Set drag effect
    e.dataTransfer.effectAllowed = "move";

    // Add some visual feedback
    e.currentTarget.classList.add("dragging");
  };

  const handleDragEnd = (e: React.DragEvent) => {
    // Clean up
    setDragState({
      draggedTag: null,
      dragOverIndex: null,
      dragOverSubcategory: null,
    });

    e.currentTarget.classList.remove("dragging");
  };

  const handleDragOver = (e: React.DragEvent, subcategoryId: string, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    // Only allow drop within the same subcategory
    if (dragState.draggedTag && dragState.draggedTag.subcategoryId === subcategoryId) {
      setDragState((prev) => ({
        ...prev,
        dragOverIndex: targetIndex,
        dragOverSubcategory: subcategoryId,
      }));
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're actually leaving the drop zone
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragState((prev) => ({
        ...prev,
        dragOverIndex: null,
        dragOverSubcategory: null,
      }));
    }
  };

  const handleDrop = (
    e: React.DragEvent,
    targetCategoryId: string,
    targetSubcategoryId: string,
    targetIndex: number
  ) => {
    e.preventDefault();

    if (!dragState.draggedTag) return;

    const {
      categoryId: sourceCategoryId,
      subcategoryId: sourceSubcategoryId,
      tagIndex: sourceIndex,
    } = dragState.draggedTag;

    // Only allow reordering within the same subcategory
    if (sourceSubcategoryId !== targetSubcategoryId) return;

    // Don't do anything if dropping in the same position
    if (sourceIndex === targetIndex) return;

    // Reorder the tags
    const updatedCategories = localCategories.map((category) => {
      if (category.id === sourceCategoryId) {
        return {
          ...category,
          subcategories: category.subcategories.map((subcategory) => {
            if (subcategory.id === sourceSubcategoryId) {
              const newTags = [...subcategory.tags];
              const [draggedTag] = newTags.splice(sourceIndex, 1);
              newTags.splice(targetIndex, 0, draggedTag);

              return {
                ...subcategory,
                tags: newTags,
              };
            }
            return subcategory;
          }),
        };
      }
      return category;
    });

    setLocalCategories(updatedCategories);
    setHasChanges(true);

    // Clear drag state
    setDragState({
      draggedTag: null,
      dragOverIndex: null,
      dragOverSubcategory: null,
    });
  };

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={handleCancel}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          {/* Custom notification */}
          {notification && (
            <div
              className={`${styles.modalNotification} ${
                notification.isError ? styles.error : styles.success
              }`}
            >
              {notification.message}
            </div>
          )}

          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Manage Tag Hierarchy</h2>
            <button className={styles.closeButton} onClick={handleCancel}>
              ×
            </button>
          </div>

          <div className={styles.modalBody}>
            {/* Categories */}
            <div className={styles.categoriesList}>
              {localCategories?.map((category) => (
                <div key={category.id} className={styles.categorySection}>
                  <div
                    className={styles.categoryHeader}
                    onClick={() => toggleCategory(category.id)}
                  >
                    <span
                      className={`${styles.expandIcon} ${
                        expandedCategories.includes(category.id) ? styles.expanded : ""
                      }`}
                    >
                      {expandedCategories.includes(category.id) ? "▼" : "►"}
                    </span>
                    <h3 className={styles.categoryTitle}>{category.name}</h3>
                    <div className={styles.categoryActions}>
                      <button
                        className={styles.actionButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameCategory(category.id);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className={`${styles.actionButton} ${styles.deleteButton}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveCategory(category.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {expandedCategories.includes(category.id) && (
                    <div className={styles.categoryContent}>
                      {/* Subcategories */}
                      <div className={styles.subcategoriesList}>
                        {category.subcategories?.map((subcategory) => (
                          <div key={subcategory.id} className={styles.subcategorySection}>
                            <div
                              className={styles.subcategoryHeader}
                              onClick={() => toggleSubcategory(subcategory.id)}
                            >
                              <span
                                className={`${styles.expandIcon} ${
                                  expandedSubcategories.includes(subcategory.id)
                                    ? styles.expanded
                                    : ""
                                }`}
                              >
                                {expandedSubcategories.includes(subcategory.id) ? "▼" : "►"}
                              </span>
                              <h4 className={styles.subcategoryTitle}>{subcategory.name}</h4>
                              <div className={styles.subcategoryActions}>
                                <button
                                  className={styles.actionButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRenameSubcategory(category.id, subcategory.id);
                                  }}
                                >
                                  Rename
                                </button>
                                <button
                                  className={`${styles.actionButton} ${styles.deleteButton}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveSubcategory(category.id, subcategory.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>

                            {expandedSubcategories.includes(subcategory.id) && (
                              <div className={styles.subcategoryContent}>
                                {/* Tags */}
                                <div className={styles.tagList}>
                                  {subcategory.tags.map((tag, tagIndex) => {
                                    const isDragging = dragState.draggedTag?.tagId === tag.id;
                                    const isDropTarget =
                                      dragState.dragOverSubcategory === subcategory.id &&
                                      dragState.dragOverIndex === tagIndex &&
                                      dragState.draggedTag?.subcategoryId === subcategory.id;

                                    return (
                                      <div
                                        key={tag.id}
                                        className={`${styles.tagItem} ${
                                          isDragging ? styles.tagDragging : ""
                                        } ${isDropTarget ? styles.tagDropTarget : ""}`}
                                        draggable={true}
                                        onDragStart={(e) =>
                                          handleDragStart(
                                            e,
                                            category.id,
                                            subcategory.id,
                                            tag.id,
                                            tagIndex
                                          )
                                        }
                                        onDragEnd={handleDragEnd}
                                        onDragOver={(e) =>
                                          handleDragOver(e, subcategory.id, tagIndex)
                                        }
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) =>
                                          handleDrop(e, category.id, subcategory.id, tagIndex)
                                        }
                                      >
                                        <span className={styles.dragHandle}>⋮⋮</span>
                                        <span className={styles.tagName}>{tag.name}</span>
                                        <div className={styles.tagActions}>
                                          <button
                                            className={styles.tagAction}
                                            onClick={() =>
                                              handleRenameTag(category.id, subcategory.id, tag.id)
                                            }
                                          >
                                            Rename
                                          </button>
                                          <button
                                            className={`${styles.tagAction} ${styles.tagDelete}`}
                                            onClick={() =>
                                              handleRemoveTag(category.id, subcategory.id, tag.id)
                                            }
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* DROP ZONE */}
                                {dragState.draggedTag?.subcategoryId === subcategory.id && (
                                  <div
                                    className={`${styles.tagDropZone} ${
                                      dragState.dragOverIndex === subcategory.tags.length
                                        ? styles.tagDropTarget
                                        : ""
                                    }`}
                                    onDragOver={(e) =>
                                      handleDragOver(e, subcategory.id, subcategory.tags.length)
                                    }
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) =>
                                      handleDrop(
                                        e,
                                        category.id,
                                        subcategory.id,
                                        subcategory.tags.length
                                      )
                                    }
                                  >
                                    Drop here to place at end
                                  </div>
                                )}

                                {/* Add new tag form */}
                                <div className={styles.addTagForm}>
                                  <input
                                    type="text"
                                    placeholder="New tag..."
                                    value={newTagInputs[`${category.id}-${subcategory.id}`] || ""}
                                    onChange={(e) =>
                                      setNewTagInputs({
                                        ...newTagInputs,
                                        [`${category.id}-${subcategory.id}`]: e.target.value,
                                      })
                                    }
                                    className={styles.input}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleAddTag(category.id, subcategory.id);
                                      }
                                    }}
                                  />
                                  <button
                                    className={styles.addButton}
                                    onClick={() => handleAddTag(category.id, subcategory.id)}
                                  >
                                    Add Tag
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Add new subcategory form */}
                      <div className={styles.addSubcategoryForm}>
                        <input
                          type="text"
                          placeholder="New subcategory..."
                          value={newSubcategoryInputs[category.id] || ""}
                          onChange={(e) =>
                            setNewSubcategoryInputs({
                              ...newSubcategoryInputs,
                              [category.id]: e.target.value,
                            })
                          }
                          className={styles.input}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleAddSubcategory(category.id);
                            }
                          }}
                        />
                        <button
                          className={styles.addButton}
                          onClick={() => handleAddSubcategory(category.id)}
                        >
                          Add Subcategory
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add new category form */}
            <div className={styles.addCategorySection}>
              <div className={styles.addCategoryForm}>
                <input
                  type="text"
                  placeholder="New category name..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className={styles.input}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddCategory();
                    }
                  }}
                />
                <button className={styles.addButton} onClick={handleAddCategory}>
                  Add Category
                </button>
              </div>
            </div>

            {/* Modal Footer with Save/Cancel buttons */}
            <div className={styles.modalFooter}>
              <button
                className={`${styles.actionButton} ${styles.cancelButton}`}
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                className={`${styles.actionButton} ${styles.saveButton}`}
                onClick={handleSaveChanges}
                disabled={!hasChanges}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default TagManager;
