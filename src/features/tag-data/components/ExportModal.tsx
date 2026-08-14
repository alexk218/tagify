import React, { useState } from "react";
import styles from "./ExportModal.module.css";
import { Portal } from "@/components/ui";

interface ExportTrack {
  rating: number;
  energy: number;
  bpm: number | null;
  tags: Array<{
    tagId: string;
    categoryId: string;
    subcategoryId: string;
    name: string;
    full_path?: string;
  }>;
  rekordbox_comment: string;
}

interface ExportData {
  version: string;
  exported_at: string;
  tracks: {
    [trackId: string]: ExportTrack;
  };
  playlists?: {
    [playlistId: string]: {
      name: string;
      owner_name: string | null;
      description: string | null;
      image_url: string | null;
      track_count: number | null;
      snapshot_id: string | null;
      tags: ExportTrack["tags"];
    };
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

const RATING_BUCKETS = Array.from({ length: 10 }, (_, index) => (index + 1) * 0.5);

const BPM_BUCKETS = [
  { label: "<80", min: null, max: 80 },
  { label: "80-100", min: 80, max: 100 },
  { label: "100-120", min: 100, max: 120 },
  { label: "120-125", min: 120, max: 125 },
  { label: "125-128", min: 125, max: 128 },
  { label: "128-130", min: 128, max: 130 },
  { label: "130-135", min: 130, max: 135 },
  { label: "135-140", min: 135, max: 140 },
  { label: "140-150", min: 140, max: 150 },
  { label: "150-160", min: 150, max: 160 },
  { label: "160+", min: 160, max: null },
];

export function buildRatingDistribution(tracks: Array<Pick<ExportTrack, "rating">>) {
  return RATING_BUCKETS.map((rating) => ({
    rating,
    count: tracks.filter((track) => track.rating === rating).length,
  }));
}

export function formatRatingStars(rating: number): string {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 === 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  return `${"★".repeat(fullStars)}${hasHalfStar ? "½" : ""}${"☆".repeat(emptyStars)}`;
}

export function buildBpmDistribution(tracks: Array<Pick<ExportTrack, "bpm">>) {
  return BPM_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: tracks.filter((track) => {
      if (track.bpm === null) return false;

      const isAboveMin = bucket.min === null || track.bpm >= bucket.min;
      const isBelowMax = bucket.max === null || track.bpm < bucket.max;

      return isAboveMin && isBelowMax;
    }).length,
  }));
}

function getDistributionBarWidth(count: number, maxCount: number): number {
  if (maxCount === 0) return 5;

  return Math.max((count / maxCount) * 100, 5);
}

const ExportModal: React.FC<ExportModalProps> = ({ data, onClose }) => {
  // Calculate tag distribution
  const tagDistribution: { [tagName: string]: number } = {};

  // Pagination for tags
  const [tagsPage, setTagsPage] = useState(1);
  const tagsPerPage = 20;
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

  const tracks = Object.values(data.tracks);

  // Calculate rating distribution
  const ratingDistribution = buildRatingDistribution(tracks);

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
  const bpmDistribution = buildBpmDistribution(tracks);
  const maxBpmCount = Math.max(...bpmDistribution.map((range) => range.count), 0);
  const maxEnergyCount = Math.max(...energyDistribution.slice(1), 0);
  const maxRatingCount = Math.max(...ratingDistribution.map((rating) => rating.count), 0);

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
                    {bpmDistribution.map(({ label, count }) => (
                      <div key={label} className={styles.distributionItem}>
                        <div className={styles.rangeName}>{label}</div>
                        <div className={styles.rangeCount}>{count}</div>
                        <div className={styles.rangeBar}>
                          <div
                            className={styles.rangeBarFill}
                            style={{
                              width: `${getDistributionBarWidth(count, maxBpmCount)}%`,
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
                              width: `${getDistributionBarWidth(count, maxEnergyCount)}%`,
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
                    {ratingDistribution.map(({ rating, count }) => (
                      <div key={rating} className={styles.distributionItem}>
                        <div className={styles.ratingLevel}>{formatRatingStars(rating)}</div>
                        <div className={styles.ratingCount}>{count}</div>
                        <div className={styles.ratingBar}>
                          <div
                            className={styles.ratingBarFill}
                            style={{
                              width: `${getDistributionBarWidth(count, maxRatingCount)}%`,
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
