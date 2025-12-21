import React, { useState, useEffect } from "react";
import styles from "./TagManager.module.css";
import { TagCategory, Tag, TagSubcategory } from "@/hooks/data/useTagData";
import Portal from "@/components/ui/Portal";

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

const MAX_NAME_LENGTH: number = 30;

const TagManager: React.FC<TagManagerProps> = ({ categories, onClose, onReplaceCategories }) => {
  // Local state for categories
  const [localCategories, setLocalCategories] = useState<TagCategory[]>(() =>
    deepClone(categories)
  );
  const [hasChanges, setHasChanges] = useState<boolean>(false);

  // Custom notification state
  const [notification, setNotification] = useState<{ message: string; isError: boolean } | null>(
    null
  );

  // State for new items
  const [newCategoryName, setNewCategoryName] = useState<string>("");
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

      if (newCategoryName.trim().length > MAX_NAME_LENGTH) {
        showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
        return;
      }

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

      if (name.length > MAX_NAME_LENGTH) {
        showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
        return;
      }

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

      if (name.length > MAX_NAME_LENGTH) {
        showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
        return;
      }

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

      if (newName.trim().length > MAX_NAME_LENGTH) {
        showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
        return;
      }

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

      if (newName.trim().length > MAX_NAME_LENGTH) {
        showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
        return;
      }

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

      if (newName.trim().length > MAX_NAME_LENGTH) {
        showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
        return;
      }

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
      <div className="modal-overlay" onClick={handleCancel}>
        <div className={`modal modal--wide ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
          {notification && (
            <div
              className={`notification ${
                notification.isError ? "notification--error" : "notification--success"
              } ${styles.modalNotification}`}
            >
              {notification.message}
            </div>
          )}

          <div className="modal-header">
            <h2 className="modal-title">Manage Tags</h2>
            <button className="modal-close-button" onClick={handleCancel}>
              ×
            </button>
          </div>

          <div className="modal-body">
            <div className={styles.categoriesList}>
              {localCategories?.map((category) => (
                <div key={category.id} className={`container ${styles.categorySection}`}>
                  <div
                    className={`expandable-header ${styles.categoryHeader}`}
                    onClick={() => toggleCategory(category.id)}
                  >
                    <span
                      className={`expand-icon ${
                        expandedCategories.includes(category.id) ? "expand-icon--expanded" : ""
                      }`}
                    >
                      {expandedCategories.includes(category.id) ? "▼" : "►"}
                    </span>
                    <h3 className="section-title" style={{ margin: 0, flexGrow: 1 }}>
                      {category.name}
                    </h3>
                    <div className="flex gap-2">
                      <button
                        className="btn btn--small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameCategory(category.id);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="btn btn--danger btn--small"
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
                    <div className="flex flex-col gap-3" style={{ marginLeft: "8px" }}>
                      <div className="flex flex-col gap-2" style={{ marginBottom: "12px" }}>
                        {category.subcategories?.map((subcategory) => (
                          <div key={subcategory.id} className={styles.subcategorySection}>
                            <div
                              className={`expandable-header ${styles.subcategoryHeader}`}
                              onClick={() => toggleSubcategory(subcategory.id)}
                            >
                              <span
                                className={`expand-icon ${
                                  expandedSubcategories.includes(subcategory.id)
                                    ? "expand-icon--expanded"
                                    : ""
                                }`}
                              >
                                {expandedSubcategories.includes(subcategory.id) ? "▼" : "►"}
                              </span>
                              <h4 className="section-subtitle" style={{ margin: 0, flexGrow: 1 }}>
                                {subcategory.name}
                              </h4>
                              <div className="flex gap-1">
                                <button
                                  className="btn btn--small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRenameSubcategory(category.id, subcategory.id);
                                  }}
                                >
                                  Rename
                                </button>
                                <button
                                  className="btn btn--danger btn--small"
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
                                        <div className={styles.tagContent}>
                                          <span className={styles.dragHandle}>⋮⋮</span>
                                          <span className={styles.tagName}>{tag.name}</span>
                                        </div>
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
                                            ×
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {dragState.draggedTag?.subcategoryId === subcategory.id && (
                                  <div
                                    className={`drop-zone ${
                                      dragState.dragOverIndex === subcategory.tags.length
                                        ? "drop-zone--active"
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

                                <div className="form-row">
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
                                    className="form-input"
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleAddTag(category.id, subcategory.id);
                                      }
                                    }}
                                  />
                                  <button
                                    className="btn"
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

                      <div className="form-row">
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
                          className="form-input"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleAddSubcategory(category.id);
                            }
                          }}
                        />
                        <button
                          className="btn"
                          title="Add Subcategory"
                          onClick={() => handleAddSubcategory(category.id)}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.addCategorySection}>
              <div className="form-row">
                <input
                  type="text"
                  placeholder="New category name..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="form-input"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddCategory();
                    }
                  }}
                />
                <button className="btn" title="Add Category" onClick={handleAddCategory}>
                  Add
                </button>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn" onClick={handleCancel}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={handleSaveChanges} disabled={!hasChanges}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default TagManager;
