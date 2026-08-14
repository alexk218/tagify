import React, { useState, useRef } from "react";
import styles from "./DataManager.module.css";
import "../../../styles/globals.css";
import { TagDataStructure } from "@/types/tagData";
import MainSettingsModal from "./MainSettingsModal";
import InfoModal from "./InfoModal";
import SpotifyUpdateHelpModal from "./SpotifyUpdateHelpModal";
import { type OrchestratorResult } from "@/services/MigrationOrchestrator";
import { Settings } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartSimple,
  faCoffee,
  faDownload,
  faInfo,
  faLightbulb,
  faShieldHalved,
  faUpload,
} from "@fortawesome/free-solid-svg-icons";
import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";

interface DataManagerProps {
  onExportTagData: () => Promise<void>;
  onImportTagData: (data: unknown) => Promise<void>;
  onExportRekordbox: () => void;
  onResetTagifyData: () => Promise<void>;
  onRetryMigration: () => Promise<OrchestratorResult>;
  lastSaved: Date | null;
}

const SHOW_SUPPORT_BUTTONS_KEY = "tagify:showSupportButtons";
const SHOW_UPDATE_PROTECTION_BUTTON_KEY =
  "tagify:showUpdateProtectionButton";

const DataManager: React.FC<DataManagerProps> = ({
  onExportTagData,
  onImportTagData,
  onExportRekordbox,
  onResetTagifyData,
  onRetryMigration,
  lastSaved,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showMainSettings, setShowMainSettings] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showSpotifyUpdateHelp, setShowSpotifyUpdateHelp] = useState(false);
  const [showSupportButtons, setShowSupportButtons] = useLocalStorage(
    SHOW_SUPPORT_BUTTONS_KEY,
    true
  );
  const [showUpdateProtectionButton, setShowUpdateProtectionButton] =
    useLocalStorage(SHOW_UPDATE_PROTECTION_BUTTON_KEY, true);
  const [infoModalSection, setInfoModalSection] = useState<string>("whats-new");

  const handleOpenInfoModal = (section: string) => {
    setInfoModalSection(section);
    setShowInfoModal(true);
  };

  // Update the export button handler to handle async
  const handleExportClick = async () => {
    try {
      await onExportTagData();
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      let data: unknown;

      try {
        const content = e.target?.result as string;
        data = JSON.parse(content);
      } catch (error) {
        console.error("Error parsing backup file:", error);
        Spicetify.showNotification("Error importing backup", true);
        return;
      }

      try {
        if (!data || typeof data !== "object") {
          console.error("Invalid backup structure:", data);
          Spicetify.showNotification("Invalid backup file format", true);
          return;
        }

        await onImportTagData(data as TagDataStructure);
        // Notification is handled by the importer.
      } catch (error) {
        console.error("Error importing backup file:", error);
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.onerror = () => {
      Spicetify.showNotification("Error reading backup file", true);
    };

    reader.readAsText(file);
  };

  return (
    <div className={styles.controlBar}>
      <div className={styles.actionPills}>
        <button
          className={`${styles.pillButton} ${styles.exportButton}`}
          onClick={handleExportClick}
          title="Backup your tag data"
        >
          <FontAwesomeIcon icon={faDownload} />
        </button>
        <button
          className={`${styles.pillButton} ${styles.importButton}`}
          onClick={handleImportClick}
          title="Import your tag data"
        >
          <FontAwesomeIcon icon={faUpload} />
        </button>
        <button
          className={`${styles.pillButton} ${styles.statsButton}`}
          onClick={onExportRekordbox}
          title="View your tag stats"
        >
          <FontAwesomeIcon icon={faChartSimple} />
        </button>
        <button
          className={`${styles.pillButton} ${styles.infoButton}`}
          onClick={() => setShowInfoModal(true)}
          title="Help & Tutorial"
        >
          <FontAwesomeIcon icon={faInfo} />
        </button>
        {showUpdateProtectionButton && (
          <button
            aria-label="Spotify update protection help"
            className={`${styles.pillButton} ${styles.updateProtectionButton}`}
            onClick={() => setShowSpotifyUpdateHelp(true)}
            title="Keep Tagify working after Spotify updates"
          >
            <FontAwesomeIcon icon={faShieldHalved} />
          </button>
        )}
        {showSupportButtons && (
          <>
            <button
              className={`${styles.pillButton} ${styles.surveyButton}`}
              onClick={() => {
                const formUrl = `https://forms.gle/H4xMyNC2zVAHowPF6`;
                window.open(formUrl, "_blank", "noopener,noreferrer");
              }}
              title="Give feedback - shape Tagify's future"
            >
              <FontAwesomeIcon icon={faLightbulb} />
            </button>
            <button
              className={`${styles.pillButton} ${styles.coffeeButton}`}
              onClick={() => {
                window.open(
                  "https://buymeacoffee.com/alexk218",
                  "_blank",
                  "noopener,noreferrer"
                );
              }}
              title="Support Tagify :)"
            >
              <FontAwesomeIcon icon={faCoffee} />
            </button>
          </>
        )}
        <button
          className={`${styles.pillButton} ${styles.discordButton}`}
          onClick={() => {
            const discordUrl = "https://discord.gg/C4qbPUbBKV";
            window.open(discordUrl, "_blank", "noopener,noreferrer");
          }}
          title="Join the Discord!"
        >
          <FontAwesomeIcon icon={faDiscord} />
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      {lastSaved && (
        <div className={styles.saveStatus}>
          ✓ Last backup: {lastSaved.toLocaleString()}
        </div>
      )}
      <button
        className={styles.settingsButton}
        onClick={() => setShowMainSettings(true)}
        title="Settings"
      >
        <Settings size={20} />
      </button>
      {showMainSettings && (
        <MainSettingsModal
          onClose={() => setShowMainSettings(false)}
          showSupportButtons={showSupportButtons}
          onToggleSupportButtons={setShowSupportButtons}
          showUpdateProtectionButton={showUpdateProtectionButton}
          onToggleUpdateProtectionButton={setShowUpdateProtectionButton}
          onOpenInfoModal={handleOpenInfoModal}
          onResetTagifyData={onResetTagifyData}
          onRetryMigration={onRetryMigration}
        />
      )}
      {showInfoModal && (
        <InfoModal
          onClose={() => {
            setShowInfoModal(false);
            setInfoModalSection("whats-new");
          }}
          initialSection={infoModalSection}
        />
      )}
      {showSpotifyUpdateHelp && (
        <SpotifyUpdateHelpModal
          onClose={() => setShowSpotifyUpdateHelp(false)}
        />
      )}
    </div>
  );
};

export default DataManager;
