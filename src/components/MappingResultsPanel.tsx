import React, { useState } from "react";
import styles from "./PythonActionsPanel.module.css";
import Portal from "../utils/Portal";

interface FileMappingResult {
  filename: string;
  uri: string;
  success: boolean;
  confidence?: number;
  source?: string;
  reason?: string;
  track_info?: string;
}

interface FileMappingResponse {
  success: boolean;
  stage: string;
  message: string;
  successful_mappings: number;
  failed_mappings: number;
  results: FileMappingResult[];
  total_processed: number;
  pendingSelections?: any[];
}

interface MappingResultsPanelProps {
  mappingResults: FileMappingResponse | null;
  showMappingResults: boolean;
  onFinish: () => void;
  onClose: () => void;
  onConfirmChanges?: (selections: any[]) => Promise<void>;
  isApplyingMapping: boolean;
}

const MappingResultsPanel: React.FC<MappingResultsPanelProps> = ({
  mappingResults,
  showMappingResults,
  onFinish,
  onClose,
  onConfirmChanges,
  isApplyingMapping,
}) => {
  const [successPage, setSuccessPage] = useState(1);
  const [failedPage, setFailedPage] = useState(1);
  const resultsPerPage = 20;

  const isConfirmationStage = mappingResults?.stage === "confirmation";

  if (!mappingResults || !showMappingResults) return null;

  const successfulMappings = mappingResults.results.filter((r) => r.success);
  const failedMappings = mappingResults.results.filter((r) => !r.success);

  const getPagedResults = (results: FileMappingResult[], page: number) => {
    const startIndex = (page - 1) * resultsPerPage;
    return results.slice(startIndex, startIndex + resultsPerPage);
  };

  const handleConfirmApply = async () => {
    if (!mappingResults?.pendingSelections || !onConfirmChanges || isApplyingMapping) return;

    try {
      await onConfirmChanges(mappingResults.pendingSelections);
    } catch (error) {
      console.error("Error applying changes:", error);
      Spicetify.showNotification(`Error applying changes: ${error}`, true);
    }
  };

  const handleFinish = () => {
    onClose();
    onFinish();
  };

  return (
    <Portal>
      <div className={styles.modalOverlay}>
        <div className={styles.mappingResultsPanel}>
          <div className={styles.mappingResultsHeader}>
            <h3>{isConfirmationStage ? "Confirm File Mappings" : "File Mapping Results"}</h3>
            <div className={styles.resultsSummary}>
              <div className={styles.summaryStats}>
                {isConfirmationStage ? (
                  <span className={styles.totalStat}>
                    Ready to map: {mappingResults.total_processed} files
                  </span>
                ) : (
                  <>
                    <span className={styles.successStat}>
                      ✓ {mappingResults.successful_mappings} Successful
                    </span>
                    <span className={styles.failedStat}>
                      ✗ {mappingResults.failed_mappings} Failed
                    </span>
                    <span className={styles.totalStat}>
                      Total: {mappingResults.total_processed}
                    </span>
                  </>
                )}
              </div>
              <p className={styles.summaryMessage}>{mappingResults.message}</p>
            </div>
          </div>

          <div className={styles.mappingResultsContent}>
            {(mappingResults.results.length > 0 || isConfirmationStage) && (
              <div className={styles.resultSection}>
                <h4 className={styles.sectionTitle}>
                  {isConfirmationStage
                    ? `📋 Files to be mapped (${mappingResults.results.length})`
                    : `✓ Successful Mappings (${successfulMappings.length})`}
                </h4>
                <div className={styles.resultsList}>
                  {mappingResults.results.map((result, index) => (
                    <div key={index} className={`${styles.resultItem} ${styles.successItem}`}>
                      <div className={styles.resultFileName}>{result.filename}</div>
                      <div className={styles.resultUri}>{result.uri}</div>
                      {result.track_info && (
                        <div className={styles.resultTrackInfo}>
                          <span className={styles.trackName}>→ {result.track_info}</span>
                        </div>
                      )}
                      <div className={styles.resultMeta}>
                        {result.confidence && (
                          <span className={styles.confidence}>
                            {(result.confidence * 100).toFixed(1)}% confidence
                          </span>
                        )}
                        {result.source && (
                          <span className={styles.source}>
                            {result.source === "auto_match"
                              ? "Auto-matched"
                              : result.source === "user_selected"
                              ? "User selected"
                              : result.source}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={styles.mappingResultsFooter}>
            {isConfirmationStage ? (
              <>
                <button
                  className={styles.confirmButton}
                  onClick={handleConfirmApply}
                  disabled={isApplyingMapping}
                >
                  {isApplyingMapping ? "Applying Changes..." : "Confirm and Apply Changes"}
                </button>
                <button
                  className={styles.cancelButton}
                  onClick={onClose}
                  disabled={isApplyingMapping}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button className={styles.finishButton} onClick={handleFinish}>
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default MappingResultsPanel;
