import React, { useState } from "react";
import styles from "./UpdateBanner.module.css";
import { UpdateInfo } from "@/services/VersionCheckerService";

interface UpdateBannerProps {
  updateInfo: UpdateInfo;
  onDismiss: (permanently?: boolean) => void;
}

const UpdateBanner: React.FC<UpdateBannerProps> = ({ updateInfo, onDismiss }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [dontRemindMe, setDontRemindMe] = useState(false);

  const handleDownload = () => {
    if (updateInfo.downloadUrl) {
      window.open(updateInfo.downloadUrl, "_blank");
    }
  };

  const handleDismiss = () => {
    setIsAnimating(true);
    setTimeout(() => {
      // Pass whether to permanently dismiss based on checkbox state
      onDismiss(dontRemindMe);
    }, 300); // Match CSS animation duration
  };

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const formatReleaseDate = (dateString?: string): string => {
    if (!dateString) return "";
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return "";
    }
  };

  return (
    <div className={`${styles.updateBanner} ${isAnimating ? styles.dismissing : ""}`}>
      <div className={styles.bannerContent}>
        {/* Main banner content */}
        <div className={styles.mainContent}>
          <div className={styles.iconSection}>
            <span className={styles.updateIcon}>🎉</span>
          </div>

          <div className={styles.textSection}>
            <div className={styles.title}>
              <strong>Tagify {updateInfo.latestVersion} is available!</strong>
              {updateInfo.releaseDate && (
                <span className={styles.releaseDate}>
                  Released {formatReleaseDate(updateInfo.releaseDate)}
                </span>
              )}
            </div>
            <p className={styles.subtitle}>New features and improvements are ready for you.</p>
          </div>

          <div className={styles.actionSection}>
            <button
              className={styles.primaryButton}
              onClick={handleDownload}
              title="Download the latest version"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" />
              </svg>
              Download
            </button>

            {updateInfo.changelog && (
              <button
                className={styles.secondaryButton}
                onClick={handleToggleExpand}
                title={isExpanded ? "Hide changelog" : "Show changelog"}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={`${styles.expandIcon} ${isExpanded ? styles.expanded : ""}`}
                >
                  <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" />
                </svg>
                {isExpanded ? "Less" : "What's New"}
              </button>
            )}

            <button
              className={styles.dismissButton}
              onClick={handleDismiss}
              title="Close this notification"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Dismissal options */}
        <div className={styles.dismissalOptions}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={dontRemindMe}
              onChange={(e) => setDontRemindMe(e.target.checked)}
            />
            <span className={styles.checkboxCustom}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                className={styles.checkIcon}
              >
                <path d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z" />
              </svg>
            </span>
            <span className={styles.checkboxText}>Don't remind me about this version</span>
          </label>
        </div>

        {/* Expandable changelog section */}
        {isExpanded && updateInfo.changelog && (
          <div className={styles.expandedContent}>
            <div className={styles.changelogSection}>
              <h4 className={styles.changelogTitle}>Release Notes</h4>
              <div className={styles.changelogContent}>
                {updateInfo.changelog.split("\n").map((line, index) => (
                  <p key={index} className={styles.changelogLine}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UpdateBanner;
