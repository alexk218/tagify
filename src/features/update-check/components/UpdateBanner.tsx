import React, { useState } from "react";
import styles from "./UpdateBanner.module.css";
import { UpdateInfo } from "@/services/VersionCheckerService";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRocket,
  faCheckCircle,
  faBox,
  faDownload,
  faLightbulb,
  faKeyboard,
  faCopy,
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";

interface UpdateBannerProps {
  updateInfo: UpdateInfo;
  onDismiss: (permanently?: boolean) => void;
}

type ExpandedSection = "update" | "changelog" | null;
type UpdateTab = "have-installer" | "need-installer" | "manual-install";

const detectOS = (): "windows" | "mac" | "linux" => {
  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "mac";
  return "linux";
};

const getInstallCommand = (os: "windows" | "mac" | "linux"): string => {
  if (os === "windows") {
    return 'iwr -useb "https://raw.githubusercontent.com/alexk218/tagify/main/install.ps1" | iex';
  }
  return 'curl -fsSL "https://raw.githubusercontent.com/alexk218/tagify/main/install.sh" | bash';
};

const getOSLabel = (os: "windows" | "mac" | "linux"): string => {
  if (os === "windows") return "Windows (PowerShell)";
  if (os === "mac") return "macOS (Terminal)";
  return "Linux (Terminal)";
};

const UpdateBanner: React.FC<UpdateBannerProps> = ({
  updateInfo,
  onDismiss,
}) => {
  const currentOS = detectOS();
  const isMac = currentOS === "mac";
  const defaultUpdateTab: UpdateTab = isMac
    ? "manual-install"
    : "have-installer";
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);
  const [activeTab, setActiveTab] = useState<UpdateTab>(defaultUpdateTab);
  const [isAnimating, setIsAnimating] = useState(false);
  const [dontRemindMe, setDontRemindMe] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  const handleDownloadInstaller = () => {
    window.open(
      "https://github.com/alexk218/tagify-installer/releases/latest",
      "_blank"
    );
  };

  const handleDirectDownload = () => {
    window.open(
      "https://github.com/alexk218/tagify-installer/releases/latest/download/TagifyInstaller.exe",
      "_blank"
    );
  };

  const handleDismiss = () => {
    setIsAnimating(true);
    setTimeout(() => {
      onDismiss(dontRemindMe);
    }, 300);
  };

  const handleToggleSection = (section: ExpandedSection) => {
    if (expandedSection === section) {
      setExpandedSection(null);
    } else {
      setExpandedSection(section);
      // Reset to first tab when opening update section
      if (section === "update") {
        setActiveTab(defaultUpdateTab);
      }
    }
  };

  const handleCopyCommand = async () => {
    const command = getInstallCommand(currentOS);

    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    } catch (err) {
      console.error("Failed to copy command:", err);
    }
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
    <div
      className={`${styles.updateBanner} ${
        isAnimating ? styles.dismissing : ""
      }`}
    >
      <div className={styles.bannerContent}>
        {/* Main banner content */}
        <div className={styles.mainContent}>
          <div className={styles.iconSection}>
            <FontAwesomeIcon icon={faRocket} className={styles.updateIcon} />
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
            <p className={styles.subtitle}>
              New features and improvements are ready for you.
            </p>
          </div>

          <div className={styles.actionSection}>
            <button
              className={styles.secondaryButton}
              onClick={() => handleToggleSection("update")}
              title={
                expandedSection === "update"
                  ? "Hide update instructions"
                  : "Show update instructions"
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                className={`${styles.expandIcon} ${
                  expandedSection === "update" ? styles.expanded : ""
                }`}
              >
                <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" />
              </svg>
              How to Update
            </button>

            {updateInfo.changelog && (
              <button
                className={styles.secondaryButton}
                onClick={() => handleToggleSection("changelog")}
                title={
                  expandedSection === "changelog"
                    ? "Hide changelog"
                    : "Show changelog"
                }
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={`${styles.expandIcon} ${
                    expandedSection === "changelog" ? styles.expanded : ""
                  }`}
                >
                  <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z" />
                </svg>
                What's New
              </button>
            )}

            <button
              className={styles.dismissButton}
              onClick={handleDismiss}
              title="Close this notification"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Expandable Update Instructions Section */}
        {expandedSection === "update" && (
          <div className={styles.expandedContent}>
            <div className={styles.tabContainer}>
              {!isMac && (
                <>
                  <button
                    className={`${styles.tab} ${
                      activeTab === "have-installer" ? styles.activeTab : ""
                    }`}
                    onClick={() => setActiveTab("have-installer")}
                  >
                    <FontAwesomeIcon
                      icon={faCheckCircle}
                      className={styles.tabIcon}
                    />
                    I Have Installer
                  </button>
                  <button
                    className={`${styles.tab} ${
                      activeTab === "need-installer" ? styles.activeTab : ""
                    }`}
                    onClick={() => setActiveTab("need-installer")}
                  >
                    <FontAwesomeIcon icon={faBox} className={styles.tabIcon} />
                    I Need Installer
                  </button>
                </>
              )}
              <button
                className={`${styles.tab} ${
                  activeTab === "manual-install" ? styles.activeTab : ""
                }`}
                onClick={() => setActiveTab("manual-install")}
              >
                <FontAwesomeIcon icon={faKeyboard} className={styles.tabIcon} />
                Manual Install
              </button>
            </div>

            <div className={styles.tabContent}>
              {activeTab === "have-installer" ? (
                <div className={styles.tabPanel}>
                  <p className={styles.instructionText}>
                    Open <strong>TagifyInstaller</strong> on your computer and
                    click the <strong>"Update Tagify"</strong> button.
                  </p>
                  <div className={styles.helpText}>
                    <FontAwesomeIcon
                      icon={faLightbulb}
                      className={styles.helpIcon}
                    />
                    The installer will automatically download and install the
                    latest version.
                  </div>
                </div>
              ) : activeTab === "need-installer" ? (
                <div className={styles.tabPanel}>
                  <p className={styles.instructionText}>
                    Download <strong>TagifyInstaller</strong> to easily update
                    <strong> Spicetify & Tagify</strong> now and in the future.
                  </p>
                  <div className={styles.downloadButtons}>
                    <button
                      className={styles.primaryButton}
                      onClick={handleDirectDownload}
                      title="Direct download of TagifyInstaller.exe"
                    >
                      <FontAwesomeIcon icon={faDownload} />
                      Download Installer
                    </button>
                    <button
                      className={styles.secondaryButton}
                      onClick={handleDownloadInstaller}
                      title="View all releases on GitHub"
                    >
                      <FontAwesomeIcon icon={faGithub} />
                      View on GitHub
                    </button>
                  </div>
                </div>
              ) : activeTab === "manual-install" ? (
                <div className={styles.tabPanel}>
                  <p className={styles.instructionText}>
                    Run this command in your terminal to install/update Tagify:
                  </p>
                  <div className={styles.commandBlock}>
                    <div className={styles.commandHeader}>
                      <span className={styles.osLabel}>
                        {getOSLabel(currentOS)}
                      </span>
                    </div>
                    <div className={styles.commandContent}>
                      <code className={styles.commandText}>
                        {getInstallCommand(currentOS)}
                      </code>
                      <button
                        className={styles.copyButton}
                        onClick={handleCopyCommand}
                        title="Copy command to clipboard"
                      >
                        <FontAwesomeIcon
                          icon={copiedCommand ? faCheckCircle : faCopy}
                        />
                      </button>
                    </div>
                  </div>
                  <div className={styles.helpText}>
                    <FontAwesomeIcon
                      icon={faLightbulb}
                      className={styles.helpIcon}
                    />
                    {currentOS === "windows"
                      ? "Open PowerShell and paste this command"
                      : "Open Terminal and paste this command"}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Expandable Changelog Section */}
        {expandedSection === "changelog" && updateInfo.changelog && (
          <div className={styles.expandedContent}>
            <div className={styles.changelogSection}>
              <div className={styles.changelogHeader}>
                <h4 className={styles.changelogTitle}>Release Notes</h4>
                <a
                  href={`https://github.com/alexk218/tagify/releases/tag/v${updateInfo.latestVersion}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.releaseLink}
                >
                  <FontAwesomeIcon
                    icon={faGithub}
                    className={styles.releaseLinkIcon}
                  />
                  View Full Release
                </a>
              </div>
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
            <span className={styles.checkboxText}>
              Don't remind me about this version
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default UpdateBanner;
