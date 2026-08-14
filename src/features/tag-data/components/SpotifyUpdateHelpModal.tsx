import React, { useEffect, useRef, useState } from "react";
import { Portal } from "@/components/ui";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCopy,
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
  const terminalName = platform === "windows" ? "PowerShell" : "Terminal";

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
              Spotify updates can temporarily remove Tagify. On Windows and
              macOS, Spicetify can block those automatic updates.
            </p>

            <div className={styles.commandSection}>
              <div className={styles.commandHeader}>
                <span>Run once in {terminalName}</span>
                <span className={styles.platformBadge}>
                  Windows &amp; macOS
                </span>
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
                    ? `Copied. Paste it into ${terminalName} and press Enter.`
                    : ""}
              </p>
            </div>

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
              <p>
                To receive Spotify updates again, run{" "}
                <code>spicetify spotify-updates unblock</code>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default SpotifyUpdateHelpModal;
