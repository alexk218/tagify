import React, { useState } from "react";
import styles from "./PythonActionsPanel.module.css";
import Portal from "../utils/Portal";

interface DuplicateMapping {
  file_path: string;
  uri: string;
  confidence: number;
  filename: string;
  source: string;
  track_info?: string;
}

interface DuplicateGroup {
  uri: string;
  track_info: string;
  mappings: DuplicateMapping[];
  recommended_mapping: DuplicateMapping;
  conflicting_mappings: DuplicateMapping[];
}

interface DuplicateDetectionResult {
  success: boolean;
  total_mappings: number;
  clean_mappings: number;
  duplicate_groups: number;
  duplicate_groups_data: DuplicateGroup[];
  clean_mappings_data: DuplicateMapping[];
  needs_user_resolution: boolean;
}

interface DuplicateResolutionPanelProps {
  duplicateDetection: DuplicateDetectionResult | null;
  isVisible: boolean;
  onResolve: (resolutions: Record<string, string>) => void;
  onCancel: () => void;
  isLoading: boolean;
}

const DuplicateResolutionPanel: React.FC<DuplicateResolutionPanelProps> = ({
  duplicateDetection,
  isVisible,
  onResolve,
  onCancel,
  isLoading,
}) => {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [autoResolveMode, setAutoResolveMode] = useState<"highest_confidence" | "manual">(
    "highest_confidence"
  );

  if (!isVisible || !duplicateDetection || !duplicateDetection.needs_user_resolution) {
    return null;
  }

  const handleSelectionChange = (uri: string, selectedFilePath: string) => {
    setSelections((prev) => ({
      ...prev,
      [uri]: selectedFilePath,
    }));
  };

  const handleAutoResolve = () => {
    const autoSelections: Record<string, string> = {};

    duplicateDetection.duplicate_groups_data.forEach((group) => {
      if (autoResolveMode === "highest_confidence") {
        autoSelections[group.uri] = group.recommended_mapping.file_path;
      }
    });

    setSelections(autoSelections);
  };

  const handleResolve = () => {
    // Ensure all groups have selections
    const finalSelections = { ...selections };

    duplicateDetection.duplicate_groups_data.forEach((group) => {
      if (!finalSelections[group.uri]) {
        // Use recommended mapping if no selection made
        finalSelections[group.uri] = group.recommended_mapping.file_path;
      }
    });

    onResolve(finalSelections);
  };

  const allGroupsResolved = duplicateDetection.duplicate_groups_data.every(
    (group) => selections[group.uri] || autoResolveMode === "highest_confidence"
  );

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.9) return "#4CAF50"; // Green
    if (confidence >= 0.8) return "#FF9800"; // Orange
    return "#F44336"; // Red
  };

  const formatFileSize = (filePath: string): string => {
    // This would typically come from file metadata
    // For now, just show the filename
    return filePath.split("\\").pop() || filePath.split("/").pop() || filePath;
  };

  return (
    <Portal>
      <div className={styles.modalOverlay}>
        <div className={styles.duplicateResolutionPanel}>
          <div className={styles.panelHeader}>
            <h3>🔄 Resolve Duplicate File Mappings</h3>
            <div className={styles.summaryStats}>
              <span className={styles.statItem}>
                <strong>{duplicateDetection.duplicate_groups}</strong> conflicts found
              </span>
              <span className={styles.statItem}>
                <strong>{duplicateDetection.clean_mappings}</strong> clean mappings
              </span>
              <span className={styles.statItem}>
                Total files: <strong>{duplicateDetection.total_mappings}</strong>
              </span>
            </div>
          </div>

          <div className={styles.resolutionOptions}>
            <div className={styles.autoResolveSection}>
              <h4>Quick Resolution</h4>
              <div className={styles.autoResolveControls}>
                <label>
                  <input
                    type="radio"
                    value="highest_confidence"
                    checked={autoResolveMode === "highest_confidence"}
                    onChange={(e) => setAutoResolveMode(e.target.value as any)}
                  />
                  Auto-select highest confidence matches
                </label>
                <label>
                  <input
                    type="radio"
                    value="manual"
                    checked={autoResolveMode === "manual"}
                    onChange={(e) => setAutoResolveMode(e.target.value as any)}
                  />
                  Manual selection for each conflict
                </label>
              </div>
              {autoResolveMode === "highest_confidence" && (
                <button
                  className={styles.autoResolveButton}
                  onClick={handleAutoResolve}
                  disabled={isLoading}
                >
                  Apply Auto-Resolution
                </button>
              )}
            </div>
          </div>

          <div className={styles.conflictsList}>
            <h4>Duplicate Conflicts ({duplicateDetection.duplicate_groups_data.length})</h4>

            {duplicateDetection.duplicate_groups_data.map((group, groupIndex) => {
              const selectedMapping = selections[group.uri];

              return (
                <div key={group.uri} className={styles.conflictGroup}>
                  <div className={styles.conflictHeader}>
                    <h5>🎵 {group.track_info}</h5>
                    <span className={styles.conflictUri}>URI: {group.uri}</span>
                  </div>

                  <div className={styles.conflictDescription}>
                    <strong>{group.mappings.length}</strong> files are competing for this track:
                  </div>

                  <div className={styles.mappingOptions}>
                    {group.mappings.map((mapping, mappingIndex) => {
                      const isSelected = selectedMapping === mapping.file_path;
                      const isRecommended = mapping === group.recommended_mapping;

                      return (
                        <div
                          key={mapping.file_path}
                          className={`${styles.mappingOption} ${
                            isSelected ? styles.selected : ""
                          } ${isRecommended ? styles.recommended : ""}`}
                        >
                          <div className={styles.mappingSelector}>
                            <input
                              type="radio"
                              name={`conflict-${groupIndex}`}
                              value={mapping.file_path}
                              checked={isSelected}
                              onChange={() => handleSelectionChange(group.uri, mapping.file_path)}
                            />
                          </div>

                          <div className={styles.mappingDetails}>
                            <div className={styles.mappingFilename}>
                              <strong>{mapping.filename}</strong>
                              {isRecommended && (
                                <span className={styles.recommendedBadge}>Recommended</span>
                              )}
                            </div>

                            <div className={styles.mappingMetadata}>
                              <span
                                className={styles.confidenceScore}
                                style={{ backgroundColor: getConfidenceColor(mapping.confidence) }}
                              >
                                {(mapping.confidence * 100).toFixed(1)}% confidence
                              </span>
                              <span className={styles.mappingSource}>
                                {mapping.source === "auto_match" ? "Auto-matched" : "User selected"}
                              </span>
                            </div>

                            <div className={styles.mappingPath}>
                              {formatFileSize(mapping.file_path)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.resolutionActions}>
            <div className={styles.resolutionSummary}>
              {autoResolveMode === "highest_confidence" ? (
                <span>
                  Will automatically select the highest confidence match for each conflict
                </span>
              ) : (
                <span>
                  {Object.keys(selections).length} of {duplicateDetection.duplicate_groups}{" "}
                  conflicts resolved
                </span>
              )}
            </div>

            <div className={styles.actionButtons}>
              <button className={styles.cancelButton} onClick={onCancel} disabled={isLoading}>
                Cancel
              </button>

              <button
                className={styles.resolveButton}
                onClick={handleResolve}
                disabled={isLoading || (autoResolveMode === "manual" && !allGroupsResolved)}
              >
                {isLoading ? "Resolving..." : `Resolve Conflicts & Create Mappings`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default DuplicateResolutionPanel;
