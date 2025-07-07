import React, { useState, useEffect } from "react";
import styles from "./TagManager.module.css";
import { TagCategory } from "../hooks/useTagData";
import Portal from "../utils/Portal";

interface TagManagerProps {
  categories: TagCategory[];
  onClose: () => void;

  // Category operations
  onAddCategory: (name: string) => void;
  onRemoveCategory: (categoryId: string) => void;
  onRenameCategory: (categoryId: string, name: string) => void;

  // Subcategory operations
  onAddSubcategory: (categoryId: string, name: string) => void;
  onRemoveSubcategory: (categoryId: string, subcategoryId: string) => void;
  onRenameSubcategory: (categoryId: string, subcategoryId: string, name: string) => void;

  // Tag operations
  onAddTag: (categoryId: string, subcategoryId: string, name: string) => void;
  onRemoveTag: (categoryId: string, subcategoryId: string, tagId: string) => void;
  onRenameTag: (categoryId: string, subcategoryId: string, tagId: string, name: string) => void;
}

const TagManager: React.FC<TagManagerProps> = ({
  categories,
  onClose,
  onAddCategory,
  onRemoveCategory,
  onRenameCategory,
  onAddSubcategory,
  onRemoveSubcategory,
  onRenameSubcategory,
  onAddTag,
  onRemoveTag,
  onRenameTag,
}) => {
  // State for new items
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newSubcategoryInputs, setNewSubcategoryInputs] = useState<{
    [categoryId: string]: string;
  }>({});
  const [newTagInputs, setNewTagInputs] = useState<{ [key: string]: string }>({});

  // State for expanded categories and subcategories
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [expandedSubcategories, setExpandedSubcategories] = useState<string[]>([]);

  // Initialize input states
  useEffect(() => {
    // Initialize empty inputs for all categories
    const initialSubInputs: { [categoryId: string]: string } = {};
    const initialTagInputs: { [key: string]: string } = {};

    categories.forEach((category) => {
      initialSubInputs[category.id] = "";

      category.subcategories.forEach((subcategory) => {
        const key = `${category.id}-${subcategory.id}`;
        initialTagInputs[key] = "";
      });
    });

    setNewSubcategoryInputs(initialSubInputs);
    setNewTagInputs(initialTagInputs);
  }, [categories]);

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
      onAddCategory(newCategoryName.trim());
      setNewCategoryName("");
    }
  };

  // Handle adding a new subcategory
  const handleAddSubcategory = (categoryId: string) => {
    const name = newSubcategoryInputs[categoryId]?.trim();
    if (name) {
      onAddSubcategory(categoryId, name);
      setNewSubcategoryInputs((prev) => ({
        ...prev,
        [categoryId]: "",
      }));
    }
  };

  // Handle adding a new tag
  const handleAddTag = (categoryId: string, subcategoryId: string) => {
    const key = `${categoryId}-${subcategoryId}`;
    const name = newTagInputs[key]?.trim();
    if (name) {
      onAddTag(categoryId, subcategoryId, name);
      setNewTagInputs((prev) => ({
        ...prev,
        [key]: "",
      }));
    }
  };

  // Handle renaming a category
  const handleRenameCategory = (categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const newName = window.prompt("Enter new name for category:", category.name);
    if (newName && newName.trim() && newName !== category.name) {
      onRenameCategory(categoryId, newName.trim());
    }
  };

  // Handle renaming a subcategory
  const handleRenameSubcategory = (categoryId: string, subcategoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return;

    const newName = window.prompt("Enter new name for subcategory:", subcategory.name);
    if (newName && newName.trim() && newName !== subcategory.name) {
      onRenameSubcategory(categoryId, subcategoryId, newName.trim());
    }
  };

  // Handle renaming a tag
  const handleRenameTag = (categoryId: string, subcategoryId: string, tagId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return;

    const tag = subcategory.tags.find((t) => t.id === tagId);
    if (!tag) return;

    const newName = window.prompt("Enter new name for tag:", tag.name);
    if (newName && newName.trim() && newName !== tag.name) {
      onRenameTag(categoryId, subcategoryId, tagId, newName.trim());
    }
  };

  // Handle removing a category with confirmation
  const handleRemoveCategory = (categoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const confirm = window.confirm(
      `Are you sure you want to delete the category "${category.name}" and all its subcategories and tags?`
    );
    if (confirm) {
      onRemoveCategory(categoryId);
    }
  };

  // Handle removing a subcategory with confirmation
  const handleRemoveSubcategory = (categoryId: string, subcategoryId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return;

    const confirm = window.confirm(
      `Are you sure you want to delete the subcategory "${subcategory.name}" and all its tags?`
    );
    if (confirm) {
      onRemoveSubcategory(categoryId, subcategoryId);
    }
  };

  // Handle removing a tag with confirmation
  const handleRemoveTag = (categoryId: string, subcategoryId: string, tagId: string) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const subcategory = category.subcategories.find((s) => s.id === subcategoryId);
    if (!subcategory) return;

    const tag = subcategory.tags.find((t) => t.id === tagId);
    if (!tag) return;

    const confirm = window.confirm(`Are you sure you want to delete the tag "${tag.name}"?`);
    if (confirm) {
      onRemoveTag(categoryId, subcategoryId, tagId);
    }
  };

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Manage Tag Hierarchy</h2>
            <button className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>

          <div className={styles.modalBody}>
            {/* Categories */}
            <div className={styles.categoriesList}>
              {categories?.map((category) => (
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
                                  {subcategory.tags.map((tag) => (
                                    <div key={tag.id} className={styles.tagItem}>
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
                                  ))}
                                </div>

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
              <h3 className={styles.sectionTitle}>Add New Category</h3>
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
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default TagManager;
