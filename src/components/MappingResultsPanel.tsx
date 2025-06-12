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
}

interface FileToProcess {
  file_path: string;
  file_name: string;
}

interface AnalysisResultsFileMapping {
  stage: string;
  success: boolean;
  message: string;
  needs_confirmation: boolean;
  requires_fuzzy_matching?: boolean;
  requires_user_selection: boolean;
  details: {
    files_requiring_user_input: FileToProcess[];
    auto_matched_files: any[];
    total_files: number;
    files_without_mappings: number;
  };
}

interface MappingResultsPanelProps {
  mappingResults: FileMappingResponse | null;
  showMappingResults: boolean;
  analysisResults: AnalysisResultsFileMapping | null;
  onContinue: () => void;
  onFinish: () => void;
  onClose: () => void;
}

const MappingResultsPanel: React.FC<MappingResultsPanelProps> = ({
  mappingResults,
  showMappingResults,
  analysisResults,
  onContinue,
  onFinish,
  onClose,
}) => {
  const [successPage, setSuccessPage] = useState(1);
  const [failedPage, setFailedPage] = useState(1);
  const resultsPerPage = 20;

  if (!mappingResults || !showMappingResults) return null;

  const successfulMappings = mappingResults.results.filter((r) => r.success);
  const failedMappings = mappingResults.results.filter((r) => !r.success);

  const getPagedResults = (results: FileMappingResult[], page: number) => {
    const startIndex = (page - 1) * resultsPerPage;
    return results.slice(startIndex, startIndex + resultsPerPage);
  };

  const handleContinue = () => {
    onClose();

    // Get the current remaining files count (after successful mappings were removed)
    const remainingFiles = analysisResults?.details?.files_requiring_user_input || [];

    // If there are still files requiring user input, resume fuzzy matching
    if (remainingFiles.length > 0) {
      onContinue();
    } else {
      // All done, reset everything
      onFinish();
      Spicetify.showNotification("All files have been processed!");
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
            <h3>File Mapping Results</h3>
            <div className={styles.resultsSummary}>
              <div className={styles.summaryStats}>
                <span className={styles.successStat}>
                  ✓ {mappingResults.successful_mappings} Successful
                </span>
                <span className={styles.failedStat}>✗ {mappingResults.failed_mappings} Failed</span>
                <span className={styles.totalStat}>Total: {mappingResults.total_processed}</span>
              </div>
              <p className={styles.summaryMessage}>{mappingResults.message}</p>
            </div>
          </div>

          <div className={styles.mappingResultsContent}>
            {/* Successful Mappings Section */}
            {successfulMappings.length > 0 && (
              <div className={styles.resultSection}>
                <h4 className={styles.sectionTitle}>
                  ✓ Successful Mappings ({successfulMappings.length})
                </h4>
                <div className={styles.resultsList}>
                  {getPagedResults(successfulMappings, successPage).map((result, index) => (
                    <div key={index} className={`${styles.resultItem} ${styles.successItem}`}>
                      <div className={styles.resultFileName}>{result.filename}</div>
                      <div className={styles.resultUri}>{result.uri}</div>
                      {/* Add track info display */}
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
                            {result.source === "auto_match" ? "Auto-matched" : "User selected"}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination for successful mappings */}
                {successfulMappings.length > resultsPerPage && (
                  <div className={styles.paginationControls}>
                    <button
                      disabled={successPage === 1}
                      onClick={() => setSuccessPage((prev) => Math.max(1, prev - 1))}
                    >
                      Previous
                    </button>
                    <span>
                      Page {successPage} of {Math.ceil(successfulMappings.length / resultsPerPage)}
                    </span>
                    <button
                      disabled={
                        successPage >= Math.ceil(successfulMappings.length / resultsPerPage)
                      }
                      onClick={() => setSuccessPage((prev) => prev + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Failed Mappings Section */}
            {failedMappings.length > 0 && (
              <div className={styles.resultSection}>
                <h4 className={styles.sectionTitle}>✗ Failed Mappings ({failedMappings.length})</h4>
                <div className={styles.resultsList}>
                  {getPagedResults(failedMappings, failedPage).map((result, index) => (
                    <div key={index} className={`${styles.resultItem} ${styles.failedItem}`}>
                      <div className={styles.resultFileName}>{result.filename}</div>
                      <div className={styles.resultUri}>{result.uri}</div>
                      {/* Add track info display for failed mappings too */}
                      {result.track_info && (
                        <div className={styles.resultTrackInfo}>
                          <span className={styles.trackName}>→ {result.track_info}</span>
                        </div>
                      )}
                      <div className={styles.resultReason}>
                        <span className={styles.errorReason}>
                          {result.reason || "Unknown error"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination for failed mappings */}
                {failedMappings.length > resultsPerPage && (
                  <div className={styles.paginationControls}>
                    <button
                      disabled={failedPage === 1}
                      onClick={() => setFailedPage((prev) => Math.max(1, prev - 1))}
                    >
                      Previous
                    </button>
                    <span>
                      Page {failedPage} of {Math.ceil(failedMappings.length / resultsPerPage)}
                    </span>
                    <button
                      disabled={failedPage >= Math.ceil(failedMappings.length / resultsPerPage)}
                      onClick={() => setFailedPage((prev) => prev + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={styles.mappingResultsFooter}>
            {(() => {
              const remainingFiles = analysisResults?.details?.files_requiring_user_input || [];
              const remainingCount = remainingFiles.length;

              return remainingCount > 0 ? (
                <>
                  <button className={styles.continueButton} onClick={handleContinue}>
                    Continue with Remaining Files ({remainingCount})
                  </button>
                  <button className={styles.finishButton} onClick={handleFinish}>
                    Finish
                  </button>
                </>
              ) : (
                <button className={styles.finishButton} onClick={handleFinish}>
                  Done - All Files Processed
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default MappingResultsPanel;
