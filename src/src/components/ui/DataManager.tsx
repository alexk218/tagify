import React, { useState, useRef, useEffect } from "react";
import styles from "./DataManager.module.css";
import "../../styles/globals.css";
import { TagDataStructure } from "@/hooks/data/useTagData";
import MainSettingsModal from "@/components/modals/MainSettingsModal";
import InfoModal from "@/components/modals/InfoModal";
import { Settings } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartSimple,
  faCoffee,
  faDownload,
  faInfo,
  faLightbulb,
  faUpload,
} from "@fortawesome/free-solid-svg-icons";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";

interface DataManagerProps {
  onExportTagData: () => void;
  onImportTagData: (data: TagDataStructure) => void;
  onExportRekordbox: () => void;
  lastSaved: Date | null;
}

const SHOW_SUPPORT_BUTTONS_KEY = "tagify:showSupportButtons";

const DataManager: React.FC<DataManagerProps> = ({
  onExportTagData,
  onImportTagData,
  onExportRekordbox,
  lastSaved,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showMainSettings, setShowMainSettings] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showSupportButtons, setShowSupportButtons] = useLocalStorage(
    SHOW_SUPPORT_BUTTONS_KEY,
    true
  );

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        if (
          data &&
          typeof data === "object" &&
          data.categories &&
          Array.isArray(data.categories) &&
          data.tracks &&
          typeof data.tracks === "object"
        ) {
          onImportTagData(data);
          Spicetify.showNotification("Data imported successfully!");
        } else {
          console.error("Invalid backup structure:", data);
          Spicetify.showNotification("Invalid backup file format", true);
        }
      } catch (error) {
        console.error("Error parsing backup file:", error);
        Spicetify.showNotification("Error importing backup", true);
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
          onClick={onExportTagData}
          title="Backup your tag data"
        >
          <FontAwesomeIcon icon={faDownload} /> Backup
        </button>
        <button
          className={`${styles.pillButton} ${styles.importButton}`}
          onClick={handleImportClick}
          title="Import your tag data"
        >
          <FontAwesomeIcon icon={faUpload} /> Import
        </button>

        <button
          className={`${styles.pillButton} ${styles.statsButton}`}
          onClick={onExportRekordbox}
          title="View your tag stats"
        >
          <FontAwesomeIcon icon={faChartSimple} /> Stats
        </button>
        <button
          className={`${styles.pillButton} ${styles.infoButton}`}
          onClick={() => setShowInfoModal(true)}
          title="Help & Tutorial"
        >
          <FontAwesomeIcon icon={faInfo} /> Info
        </button>
        {showSupportButtons && (
          <>
            <button
              className={`${styles.pillButton} ${styles.surveyButton}`}
              onClick={() => {
                const formUrl = `https://forms.gle/H4xMyNC2zVAHowPF6`;
                window.open(formUrl, "_blank", "noopener,noreferrer");
              }}
              title="Your feedback helps me build better features"
            >
              <FontAwesomeIcon icon={faLightbulb} />
              <span className={styles.buttonText}>Feedback</span>
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
              title="Love Tagify? Buy me a coffee! :)"
            >
              <FontAwesomeIcon icon={faCoffee} />
              <span className={styles.buttonText}>Support</span>
            </button>
          </>
        )}
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
        />
      )}
      {showInfoModal && <InfoModal onClose={() => setShowInfoModal(false)} />}
    </div>
  );
};

export default DataManager;
