import React, { useState } from "react";
import styles from "./ExportModal.module.css";
import Portal from "@/components/ui/Portal";

interface ExportTrack {
  rating: number;
  energy: number;
  bpm: number | null;
  tags: Array<{
    categoryId: string;
    subcategoryId: string;
    tagId: string;
    name: string;
  }>;
  rekordbox_comment: string;
}

interface ExportData {
  version: string;
  exported_at: string;
  tracks: {
    [trackId: string]: ExportTrack;
  };
  tag_analytics?: {
    total_categories: number;
    total_subcategories: number;
    total_tags: number;
    used_tags: number;
    unused_tags: number;
    categories: Array<{
      id: string;
      name: string;
      order: number;
      total_subcategories: number;
      total_tags: number;
      used_tags: number;
      unused_tags: number;
      subcategories: Array<{
        id: string;
        name: string;
        order: number;
        total_tags: number;
        used_tags: number;
        unused_tags: number;
        tags: Array<{
          id: string;
          name: string;
          order: number;
          usage_count: number;
          is_used: boolean;
          full_path: string;
        }>;
      }>;
    }>;
    tag_usage_summary: {
      most_used_tags: Array<{ name: string; usage_count: number }>;
      unused_tag_names: string[];
      usage_percentage: number;
    };
  };
}

interface ExportModalProps {
  data: ExportData;
  onClose: () => void;
}

const ExportModal: React.FC<ExportModalProps> = ({ data, onClose }) => {
  // Calculate tag distribution
  const tagDistribution: { [tagName: string]: number } = {};

  // Pagination for tags
  const [tagsPage, setTagsPage] = useState(1);
  const [tagsPerPage, setTagsPerPage] = useState(20);
  const [tagSortMethod, setTagSortMethod] = useState<"frequency" | "alphabetical">("frequency");
  const [tagFilterText, setTagFilterText] = useState("");

  // Active section tracking
  const [activeSection, setActiveSection] = useState<string>("statistics");

  // Calculate export statistics

  const trackCount = Object.keys(data.tracks).length;
  const ratedTrackCount = Object.values(data.tracks).filter((track) => track.rating > 0).length;
  const taggedTrackCount = Object.values(data.tracks).filter(
    (track) => track.tags.length > 0
  ).length;

  const totalTags = data.tag_analytics?.total_tags || Object.keys(tagDistribution).length;
  const usedTags =
    data.tag_analytics?.used_tags ||
    Object.values(tagDistribution).filter((count) => count > 0).length;
  const unusedTags = data.tag_analytics?.unused_tags || 0;
  const tagUsagePercentage =
    data.tag_analytics?.tag_usage_summary.usage_percentage ||
    (totalTags > 0 ? Math.round((usedTags / totalTags) * 100) : 0);

  // Calculate energy level distribution
  const energyDistribution = Array(11).fill(0); // 0-10 energy levels
  Object.values(data.tracks).forEach((track) => {
    if (track.energy > 0) {
      energyDistribution[track.energy]++;
    }
  });

  // Calculate rating distribution
  const ratingDistribution = Array(6).fill(0); // 0-5 star ratings
  Object.values(data.tracks).forEach((track) => {
    ratingDistribution[track.rating]++;
  });

  if (data.tag_analytics) {
    // Build distribution from analytics data (includes all tags, even unused ones)
    data.tag_analytics.categories.forEach((category) => {
      category.subcategories.forEach((subcategory) => {
        subcategory.tags.forEach((tag) => {
          tagDistribution[tag.name] = tag.usage_count;
        });
      });
    });
  } else {
    // Fallback to old method for backward compatibility
    Object.values(data.tracks).forEach((track) => {
      track.tags.forEach((tag) => {
        if (!tagDistribution[tag.name]) {
          tagDistribution[tag.name] = 0;
        }
        tagDistribution[tag.name]++;
      });
    });
  }

  // Get sorted tag entries based on selected sort method and filter
  const getSortedTags = () => {
    const filteredTags = Object.entries(tagDistribution).filter(
      ([tagName]) => !tagFilterText || tagName.toLowerCase().includes(tagFilterText.toLowerCase())
    );

    if (tagSortMethod === "frequency") {
      return filteredTags.sort((a, b) => b[1] - a[1]);
    } else {
      return filteredTags.sort((a, b) => a[0].localeCompare(b[0]));
    }
  };

  const sortedTags = getSortedTags();
  const pageCount = Math.ceil(sortedTags.length / tagsPerPage);
  const paginatedTags = sortedTags.slice((tagsPage - 1) * tagsPerPage, tagsPage * tagsPerPage);

  // Calculate BPM ranges for visualization
  const bpmRanges = {
    "<80": 0,
    "80–100": 0,
    "100-120": 0,
    "120-125": 0,
    "125-128": 0,
    "128-130": 0,
    "130-135": 0,
    "135+": 0,
  };

  Object.values(data.tracks).forEach((track) => {
    if (track.bpm === null) return;

    if (track.bpm < 80) bpmRanges["<80"]++;
    else if (track.bpm < 100) bpmRanges["80–100"]++;
    else if (track.bpm < 120) bpmRanges["100-120"]++;
    else if (track.bpm < 125) bpmRanges["120-125"]++;
    else if (track.bpm < 128) bpmRanges["125-128"]++;
    else if (track.bpm < 130) bpmRanges["128-130"]++;
    else if (track.bpm < 135) bpmRanges["130-135"]++;
    else bpmRanges["135+"]++;
  });

  function formatGenerationMessage(message: string) {
    const [line1, line2] = message.split(". ");

    const boldNumbers = (text: string) =>
      text
        .split(/(\d+)/)
        .map((part, i) => (/^\d+$/.test(part) ? <strong key={i}>{part}</strong> : part));

    return (
      <>
        <div>{boldNumbers(line1)}.</div>
        {line2 && <div>{boldNumbers(line2)}</div>}
      </>
    );
  }

  return (
    <Portal>
      <div className={styles.modalOverlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Statistics</h2>
            <button className="modal-close-button" onClick={onClose}>
              ×
            </button>
          </div>

          <div className={styles.modalBody}>
            {/* Navigation Tabs */}
            <div className={styles.navigationTabs}>
              <button
                className={`${styles.tabButton} ${
                  activeSection === "statistics" ? styles.activeTab : ""
                }`}
                onClick={() => setActiveSection("statistics")}
              >
                Statistics
              </button>
              <button
                className={`${styles.tabButton} ${
                  activeSection === "tags" ? styles.activeTab : ""
                }`}
                onClick={() => setActiveSection("tags")}
              >
                Tags ({Object.keys(tagDistribution).length})
              </button>
            </div>

            {/* Statistics Section */}
            {activeSection === "statistics" && (
              <div className={styles.statisticsSection}>
                <div className={styles.statsOverview}>
                  <div className={styles.stats}>
                    <div className={styles.statItem}>
                      <span className={styles.statLabel}>Total Tracks:</span>
                      <span className={styles.statValue}>{trackCount}</span>
                    </div>
                    <div className={styles.statItem}>
                      <span className={styles.statLabel}>Rated Tracks:</span>
                      <span className={styles.statValue}>{ratedTrackCount}</span>
                    </div>
                    <div className={styles.statItem}>
                      <span className={styles.statLabel}>Tagged Tracks:</span>
                      <span className={styles.statValue}>{taggedTrackCount}</span>
                    </div>

                    {/* New analytics stats */}
                    {data.tag_analytics && (
                      <>
                        <div className={styles.statItem}>
                          <span className={styles.statLabel}>Total Tags:</span>
                          <span className={styles.statValue}>{totalTags}</span>
                        </div>
                        <div className={styles.statItem}>
                          <span className={styles.statLabel}>Used Tags:</span>
                          <span className={styles.statValue}>{usedTags}</span>
                        </div>
                        <div className={styles.statItem}>
                          <span className={styles.statLabel}>Tag Usage:</span>
                          <span className={styles.statValue}>{tagUsagePercentage}%</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className={styles.chartSection}>
                  <h3 className={styles.sectionTitle}>BPM Distribution</h3>
                  <div className={styles.bpmDistribution}>
                    {Object.entries(bpmRanges).map(([range, count]) => (
                      <div key={range} className={styles.distributionItem}>
                        <div className={styles.rangeName}>{range}</div>
                        <div className={styles.rangeCount}>{count}</div>
                        <div className={styles.rangeBar}>
                          <div
                            className={styles.rangeBarFill}
                            style={{
                              width: `${Math.max(
                                (count / Math.max(...Object.values(bpmRanges))) * 100,
                                5
                              )}%`,
                              backgroundColor: count > 0 ? undefined : "transparent",
                            }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.chartSection}>
                  <h3 className={styles.sectionTitle}>Energy Distribution</h3>
                  <div className={styles.energyDistribution}>
                    {energyDistribution.slice(1).map((count, index) => (
                      <div key={index + 1} className={styles.distributionItem}>
                        <div className={styles.energyLevel}>Energy {index + 1}</div>
                        <div className={styles.energyCount}>{count}</div>
                        <div className={styles.energyBar}>
                          <div
                            className={styles.energyBarFill}
                            style={{
                              width: `${Math.max(
                                (count / Math.max(...energyDistribution.slice(1))) * 100,
                                5
                              )}%`,
                              backgroundColor: count > 0 ? undefined : "transparent",
                            }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.chartSection}>
                  <h3 className={styles.sectionTitle}>Rating Distribution</h3>
                  <div className={styles.ratingDistribution}>
                    {ratingDistribution.slice(1).map((count, index) => (
                      <div key={index + 1} className={styles.distributionItem}>
                        <div className={styles.ratingLevel}>
                          {"★".repeat(index + 1)}
                          {"☆".repeat(5 - (index + 1))}
                        </div>
                        <div className={styles.ratingCount}>{count}</div>
                        <div className={styles.ratingBar}>
                          <div
                            className={styles.ratingBarFill}
                            style={{
                              width: `${Math.max(
                                (count / Math.max(...ratingDistribution.slice(1))) * 100,
                                5
                              )}%`,
                              backgroundColor: count > 0 ? undefined : "transparent",
                            }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tags Section */}
            {activeSection === "tags" && (
              <div className={styles.tagSection}>
                <div className={styles.tagControls}>
                  <div className={styles.tagSearch}>
                    <input
                      type="text"
                      placeholder="Search tags..."
                      value={tagFilterText}
                      onChange={(e) => {
                        setTagFilterText(e.target.value);
                        setTagsPage(1); // Reset to first page on filter change
                      }}
                      className={styles.tagSearchInput}
                    />
                  </div>

                  <div className={styles.tagSortControls}>
                    <span className={styles.sortLabel}>Sort by:</span>
                    <button
                      className={`${styles.sortButton} ${
                        tagSortMethod === "frequency" ? styles.activeSort : ""
                      }`}
                      onClick={() => setTagSortMethod("frequency")}
                    >
                      Most Used
                    </button>
                    <button
                      className={`${styles.sortButton} ${
                        tagSortMethod === "alphabetical" ? styles.activeSort : ""
                      }`}
                      onClick={() => setTagSortMethod("alphabetical")}
                    >
                      A-Z
                    </button>
                  </div>
                </div>

                <div className={styles.tagResults}>
                  <div className={styles.tagResultsHeader}>
                    <p className={styles.tagResultsCount}>
                      Showing {paginatedTags.length} of {sortedTags.length} tags
                      {tagFilterText && ` (filtered by "${tagFilterText}")`}
                    </p>
                  </div>

                  <div className={styles.tagDistribution}>
                    {paginatedTags.map(([tagName, count]) => (
                      <div key={tagName} className={styles.distributionItem}>
                        <div className={styles.tagName}>{tagName}</div>
                        <div className={styles.tagCount}>{count}</div>
                        <div className={styles.tagBar}>
                          <div
                            className={styles.tagBarFill}
                            style={{
                              width: `${(count / (sortedTags[0] ? sortedTags[0][1] : 1)) * 100}%`,
                              minWidth: "5px",
                            }}
                          ></div>
                        </div>
                      </div>
                    ))}

                    {sortedTags.length === 0 && (
                      <div className={styles.noResults}>
                        No tags found {tagFilterText && `matching "${tagFilterText}"`}
                      </div>
                    )}
                  </div>

                  {pageCount > 1 && (
                    <div className={styles.pagination}>
                      <button
                        className={styles.paginationButton}
                        disabled={tagsPage === 1}
                        onClick={() => setTagsPage(Math.max(1, tagsPage - 1))}
                      >
                        Previous
                      </button>

                      <div className={styles.pageInfo}>
                        Page {tagsPage} of {pageCount}
                      </div>

                      <button
                        className={styles.paginationButton}
                        disabled={tagsPage === pageCount}
                        onClick={() => setTagsPage(Math.min(pageCount, tagsPage + 1))}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default ExportModal;
