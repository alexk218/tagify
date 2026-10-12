import React, { useEffect, useRef, useState } from "react";
import { Portal } from "@/components/ui";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCopy,
  faDownload,
  faShieldHalved,
  faTimes,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import styles from "./SpotifyUpdateHelpModal.module.css";

interface SpotifyUpdateHelpModalProps {
  onClose: () => void;
}

export const BLOCK_SPOTIFY_UPDATES_COMMAND =
  "spicetify spotify-updates block";

type Platform = "windows" | "mac" | "linux";

function detectPlatform(): Platform {
  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "mac";
  return "linux";
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("The browser rejected the copy request");
    }
  } finally {
    document.body.removeChild(textArea);
  }
}

const SpotifyUpdateHelpModal: React.FC<SpotifyUpdateHelpModalProps> = ({
  onClose,
}) => {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const platform = detectPlatform();
  const installerUrl = platform === "windows"
    ? "https://tagify.fm/download/windows"
    : "https://tagify.fm";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [onClose]);

  const handleCopy = async () => {
    try {
      await copyText(BLOCK_SPOTIFY_UPDATES_COMMAND);
      setCopyState("copied");
    } catch (error) {
      console.error("Failed to copy the Spotify update command:", error);
      setCopyState("failed");
    }

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2500);
  };

  return (
    <Portal>
      <div className={styles.overlay} onClick={onClose}>
        <div
          aria-labelledby="spotify-update-help-title"
          aria-modal="true"
          className={styles.modal}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <div className={styles.header}>
            <div className={styles.titleGroup}>
              <span className={styles.shieldIcon}>
                <FontAwesomeIcon icon={faShieldHalved} />
              </span>
              <div>
                <h2 id="spotify-update-help-title">Keep Tagify available</h2>
                <p>Prevent Spotify updates from removing Spicetify changes.</p>
              </div>
            </div>
            <button
              aria-label="Close update protection help"
              className={styles.closeButton}
              onClick={onClose}
              type="button"
            >
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>

          <div className={styles.body}>
            <p className={styles.explanation}>
              Spotify updates can temporarily remove Tagify.
            </p>

            {platform !== "linux" && (
              <div className={styles.installerSection}>
                <p>
                  The Tagify installer lets you block automatic Spotify updates
                  to keep Tagify available. It also checks for Tagify and
                  Spicetify updates and handles updating them for you, making
                  your setup easier to maintain.
                </p>
                <a
                  className={styles.installerLink}
                  href={installerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FontAwesomeIcon icon={faDownload} />
                  {platform === "windows"
                    ? "Get the Windows installer"
                    : "Visit tagify.fm"}
                </a>
              </div>
            )}

            {platform === "mac" && (
              <div className={styles.commandSection}>
                <div className={styles.commandHeader}>
                  <span>Or run once in Terminal</span>
                  <span className={styles.platformBadge}>macOS</span>
                </div>
                <div className={styles.commandRow}>
                  <code>{BLOCK_SPOTIFY_UPDATES_COMMAND}</code>
                  <button
                    aria-label="Copy Spotify update blocking command"
                    className={`${styles.copyButton} ${
                      copyState === "copied" ? styles.copyButtonSuccess : ""
                    }`}
                    onClick={handleCopy}
                    type="button"
                  >
                    <FontAwesomeIcon
                      icon={copyState === "copied" ? faCheck : faCopy}
                    />
                    {copyState === "copied" ? "Copied!" : "Copy command"}
                  </button>
                </div>
                <p aria-live="polite" className={styles.copyStatus}>
                  {copyState === "failed"
                    ? "Copy failed. Select the command and copy it manually."
                    : copyState === "copied"
                      ? "Copied. Paste it into Terminal and press Enter."
                      : ""}
                </p>
              </div>
            )}

            {platform === "linux" && (
              <div className={styles.platformWarning}>
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <p>
                  Spicetify cannot block Spotify updates on Linux. Disable them
                  through the package manager used to install Spotify instead.
                </p>
              </div>
            )}

            <div className={styles.notes}>
              <p>
                <strong>This does not back up your Tagify data.</strong> Keep
                using Tagify&apos;s backup button regularly.
              </p>
              {platform === "mac" && (
                <p>
                  To allow Spotify updates again, change the setting in the
                  installer or run <code>spicetify spotify-updates unblock</code>
                  {" "}in Terminal.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default SpotifyUpdateHelpModal;
