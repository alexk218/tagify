import { useEffect, useRef, useState } from "react";
import { keyboardShortcutService } from "@/services/KeyboardShortcutService";

interface UseMultiTrackKeyboardShortcutsOptions {
  hasUnsavedChanges: boolean;
  onSaveChanges: () => void;
  onToggleStarRatingDraft: (rating: number) => void;
  onToggleEnergyRatingDraft: (energy: number) => void;
}

export function useMultiTrackKeyboardShortcuts({
  hasUnsavedChanges,
  onSaveChanges,
  onToggleStarRatingDraft,
  onToggleEnergyRatingDraft,
}: UseMultiTrackKeyboardShortcutsOptions) {
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() => {
    try {
      const raw = localStorage.getItem("tagify:keyboardShortcutSettings");
      if (raw) {
        return JSON.parse(raw).enabled ?? true;
      }
    } catch {
      // ignore parse errors
    }

    return true;
  });

  const onSaveChangesRef = useRef(onSaveChanges);
  onSaveChangesRef.current = onSaveChanges;

  useEffect(() => {
    const handleSettingsChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const enabled = customEvent.detail?.enableKeyboardShortcuts;
      if (typeof enabled === "boolean") {
        setShortcutsEnabled(enabled);
      }
    };

    window.addEventListener("tagify:keyboardSettingsChanged", handleSettingsChange);

    return () => {
      window.removeEventListener(
        "tagify:keyboardSettingsChanged",
        handleSettingsChange,
      );
    };
  }, []);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!shortcutsEnabled) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "s") {
        event.preventDefault();

        if (hasUnsavedChanges) {
          onSaveChangesRef.current();
        }
      }
    };

    document.addEventListener("keydown", handleSaveShortcut);

    return () => {
      document.removeEventListener("keydown", handleSaveShortcut);
    };
  }, [hasUnsavedChanges, shortcutsEnabled]);

  useEffect(() => {
    keyboardShortcutService.temporarilyDisable();

    return () => {
      keyboardShortcutService.temporarilyEnable();
    };
  }, []);

  useEffect(() => {
    const handleRatingShortcuts = (event: KeyboardEvent) => {
      if (!shortcutsEnabled) {
        return;
      }

      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }

      const digitMatch = event.code.match(/^Digit(\d)$/);
      if (!digitMatch) {
        return;
      }

      const digit = digitMatch[1];

      const digitToStarRating: Record<string, number> = {
        "1": 0.5,
        "2": 1,
        "3": 1.5,
        "4": 2,
        "5": 2.5,
        "6": 3,
        "7": 3.5,
        "8": 4,
        "9": 4.5,
        "0": 5,
      };

      const digitToEnergyRating: Record<string, number> = {
        "1": 1,
        "2": 2,
        "3": 3,
        "4": 4,
        "5": 5,
        "6": 6,
        "7": 7,
        "8": 8,
        "9": 9,
        "0": 10,
      };

      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        onToggleEnergyRatingDraft(digitToEnergyRating[digit]);
        return;
      }

      onToggleStarRatingDraft(digitToStarRating[digit]);
    };

    document.addEventListener("keydown", handleRatingShortcuts, true);

    return () => {
      document.removeEventListener("keydown", handleRatingShortcuts, true);
    };
  }, [onToggleEnergyRatingDraft, onToggleStarRatingDraft, shortcutsEnabled]);
}
