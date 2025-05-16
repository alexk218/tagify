import React, { useState, useEffect } from "react";
import styles from "./ExportPanel.module.css";
import Portal from "../utils/Portal";

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
}

interface ExportPanelProps {
  data: ExportData;
  onClose: () => void;
}

const ExportPanel: React.FC<ExportPanelProps> = ({ data, onClose }) => {
  const [serverUrl, setServerUrl] = useState<string>(() => {
    return localStorage.getItem("tagify:localServerUrl") || "http://localhost:8765";
  });
  const [serverStatus, setServerStatus] = useState<"unknown" | "connected" | "disconnected">(
    "unknown"
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Pagination for tags
  const [tagsPage, setTagsPage] = useState(1);
  const [tagsPerPage, setTagsPerPage] = useState(20);
  const [tagSortMethod, setTagSortMethod] = useState<"frequency" | "alphabetical">("frequency");
  const [tagFilterText, setTagFilterText] = useState("");

  // Active section tracking
  const [activeSection, setActiveSection] = useState<string>("statistics");

  const rekordboxXmlPath = localStorage.getItem("tagify:rekordboxXmlPath") || "";

  // Calculate export statistics
  const trackCount = Object.keys(data.tracks).length;
  const ratedTrackCount = Object.values(data.tracks).filter((track) => track.rating > 0).length;
  const taggedTrackCount = Object.values(data.tracks).filter(
    (track) => track.tags.length > 0
  ).length;

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

  // Calculate tag distribution
  const tagDistribution: { [tagName: string]: number } = {};
  Object.values(data.tracks).forEach((track) => {
    track.tags.forEach((tag) => {
      if (!tagDistribution[tag.name]) {
        tagDistribution[tag.name] = 0;
      }
      tagDistribution[tag.name]++;
    });
  });

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
    "< 100": 0,
    "100-120": 0,
    "120-125": 0,
    "125-128": 0,
    "128-130": 0,
    "130-135": 0,
    "135+": 0,
  };

  Object.values(data.tracks).forEach((track) => {
    if (track.bpm === null) return;

    if (track.bpm < 100) bpmRanges["< 100"]++;
    else if (track.bpm < 120) bpmRanges["100-120"]++;
    else if (track.bpm < 125) bpmRanges["120-125"]++;
    else if (track.bpm < 128) bpmRanges["125-128"]++;
    else if (track.bpm < 130) bpmRanges["128-130"]++;
    else if (track.bpm < 135) bpmRanges["130-135"]++;
    else bpmRanges["135+"]++;
  });

  // Check server connection on mount
  useEffect(() => {
    checkServerConnection();
  }, []);

  // Check server connection
  const checkServerConnection = async () => {
    try {
      setServerStatus("unknown");

      const response = await fetch(`${serverUrl}/status`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (response.ok) {
        setServerStatus("connected");
        return true;
      } else {
        setServerStatus("disconnected");
        Spicetify.showNotification("Failed to connect to server", true);
        return false;
      }
    } catch (err) {
      console.error("Error connecting to server:", err);
      setServerStatus("disconnected");
      Spicetify.showNotification("Error connecting to server", true);
      return false;
    }
  };

  // Generate rekordbox XML
  const handleGenerateRekordboxXml = async () => {
    setIsGenerating(true);
    setGenerationResult(null);

    // First, check server connection
    const isConnected = await checkServerConnection();
    if (!isConnected) {
      setIsGenerating(false);
      return;
    }

    try {
      // Prepare the rating data
      const ratingData: Record<string, { rating: number; energy: number }> = {};
      Object.entries(data.tracks).forEach(([key, value]) => {
        // Only include tracks that have ratings or energy values
        if (value.rating || value.energy) {
          ratingData[key] = {
            rating: value.rating || 0,
            energy: value.energy || 0,
          };
        }
      });

      // Call the rekordbox XML generation endpoint
      const response = await fetch(`${serverUrl}/api/generate-rekordbox-xml`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          rekordboxXmlPath: rekordboxXmlPath,
          ratingData: ratingData,
          masterTracksDir: localStorage.getItem("tagify:masterTracksDir") || "",
          playlistsDir: localStorage.getItem("tagify:playlistsDir") || "",
        }),
      });

      const result = await response.json();

      setGenerationResult({
        success: result.success,
        message: result.message || JSON.stringify(result),
      });

      if (result.success) {
        Spicetify.showNotification(
          `Success: ${result.message || "rekordbox XML generated"}`,
          false,
          3000
        );
      } else {
        Spicetify.showNotification(
          `Error: ${result.message || "Failed to generate rekordbox XML"}`,
          true
        );
      }
    } catch (err: any) {
      console.error("Error generating rekordbox XML:", err);
      setGenerationResult({
        success: false,
        message: err.message || String(err),
      });
      Spicetify.showNotification(`Error: ${err.message || String(err)}`, true);
    } finally {
      setIsGenerating(false);
    }
  };

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
            <h2 className={styles.modalTitle}>Export for rekordbox</h2>
            <button className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>

          <div className={styles.modalBody}>
            {/* Top Action Section - XML Generation */}
            <div className={styles.exportSection}>
              <div className={styles.primaryActionContainer}>
                <button
                  className={styles.primaryActionButton}
                  onClick={handleGenerateRekordboxXml}
                  disabled={isGenerating}
                >
                  {isGenerating ? "Generating..." : "Generate rekordbox XML"}
                </button>

                <div className={styles.serverStatusContainer}>
                  <div className={`${styles.serverStatus} ${styles[serverStatus]}`}>
                    <span className={styles.statusDot}></span>
                    {serverStatus === "connected"
                      ? "Server connected"
                      : serverStatus === "disconnected"
                      ? "Server disconnected"
                      : "Checking server status..."}
                  </div>
                </div>
              </div>

              <p className={styles.info}>
                <strong>Note:</strong> Generating a rekordbox XML file requires the Python server to
                be running.
                <br />
                {rekordboxXmlPath !== "Not configured" ? (
                  <span>
                    The XML file will be generated at:{" "}
                    <code className={styles.pathCode}>{rekordboxXmlPath}</code>
                  </span>
                ) : (
                  <span>Please configure the rekordbox XML path in Settings.</span>
                )}
              </p>

              {generationResult && (
                <div
                  className={`${styles.result} ${
                    generationResult.success ? styles.success : styles.error
                  }`}
                >
                  {formatGenerationMessage(generationResult.message)}
                </div>
              )}
            </div>

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
              <button
                className={`${styles.tabButton} ${
                  activeSection === "information" ? styles.activeTab : ""
                }`}
                onClick={() => setActiveSection("information")}
              >
                Information
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

            {/* Information Section */}
            {activeSection === "information" && (
              <div className={styles.informationSection}>
                <div className={styles.infoSection}>
                  <h3 className={styles.sectionTitle}>Export Format</h3>
                  <p className={styles.infoText}>
                    The exported data is formatted for use with rekordbox. It includes:
                  </p>
                  <ul className={styles.infoList}>
                    <li>Star ratings (1-5) that will map to rekordbox ratings</li>
                    <li>Energy levels (1-10) for each track</li>
                    <li>All tags organized by category</li>
                    <li>
                      Formatted comments for rekordbox in the format: "Energy X - Tag1, Tag2, Tag3"
                    </li>
                  </ul>
                </div>

                <div className={styles.instructionsSection}>
                  <h3 className={styles.sectionTitle}>Next Steps</h3>
                  <ol className={styles.instructionsList}>
                    <li>Configure your rekordbox XML path in Settings if not already done</li>
                    <li>
                      Click the "Generate rekordbox XML" button at the top to create the XML file
                    </li>
                    <li>Import this XML file into rekordbox to see the updated metadata</li>
                  </ol>
                  <p className={styles.note}>
                    <strong>Note:</strong> The XML file will contain all your ratings, energy
                    values, and tags in a format that rekordbox can understand. You can import this
                    file directly into rekordbox to update your library's metadata.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default ExportPanel;
