import { useCallback, useEffect, useRef, useState } from "react";
import type { UserTrackAddedEvent } from "@/features/tag-data";

interface PowerUserModalStorageState {
  hasDismissed: boolean;
  dismissedAt?: string;
}

export interface UsePowerUserModalOptions {
  taggedTrackCount: number;
  lastUserTrackAddedEvent: UserTrackAddedEvent | null;
  threshold?: number;
}

export interface UsePowerUserModalReturn {
  shouldShowPowerUserModal: boolean;
  dismissPowerUserModal: () => void;
  hasDismissedPowerUserModal: boolean;
}

const POWER_USER_MODAL_STORAGE_KEY = "tagify:powerUserModal";
const DEFAULT_THRESHOLD = 300;

function readStoredPowerUserState(): PowerUserModalStorageState {
  try {
    const raw = localStorage.getItem(POWER_USER_MODAL_STORAGE_KEY);
    if (!raw) {
      return { hasDismissed: false };
    }

    const parsed = JSON.parse(raw) as PowerUserModalStorageState;

    if (typeof parsed !== "object" || parsed === null) {
      return { hasDismissed: false };
    }

    return {
      hasDismissed: Boolean(parsed.hasDismissed),
      dismissedAt: parsed.dismissedAt,
    };
  } catch (error) {
    console.error("Tagify: Failed to read Power User modal state:", error);
    return { hasDismissed: false };
  }
}

function writeStoredPowerUserState(state: PowerUserModalStorageState): void {
  try {
    localStorage.setItem(POWER_USER_MODAL_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Tagify: Failed to persist Power User modal state:", error);
  }
}

export function usePowerUserModal({
  taggedTrackCount,
  lastUserTrackAddedEvent,
  threshold = DEFAULT_THRESHOLD,
}: UsePowerUserModalOptions): UsePowerUserModalReturn {
  const [shouldShowPowerUserModal, setShouldShowPowerUserModal] =
    useState(false);
  const [hasDismissedPowerUserModal, setHasDismissedPowerUserModal] =
    useState(false);
  const [hasLoadedDismissalState, setHasLoadedDismissalState] = useState(false);

  const lastHandledEventIdRef = useRef<number | null>(null);

  useEffect(() => {
    const storedState = readStoredPowerUserState();
    setHasDismissedPowerUserModal(storedState.hasDismissed);
    setHasLoadedDismissalState(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedDismissalState) {
      return;
    }

    if (!lastUserTrackAddedEvent) {
      return;
    }

    if (lastHandledEventIdRef.current === lastUserTrackAddedEvent.eventId) {
      return;
    }
    lastHandledEventIdRef.current = lastUserTrackAddedEvent.eventId;

    if (hasDismissedPowerUserModal) {
      return;
    }

    if (taggedTrackCount >= threshold) {
      setShouldShowPowerUserModal(true);
    }
  }, [
    taggedTrackCount,
    threshold,
    lastUserTrackAddedEvent,
    hasDismissedPowerUserModal,
    hasLoadedDismissalState,
  ]);

  const dismissPowerUserModal = useCallback(() => {
    setShouldShowPowerUserModal(false);
    setHasDismissedPowerUserModal(true);

    writeStoredPowerUserState({
      hasDismissed: true,
      dismissedAt: new Date().toISOString(),
    });
  }, []);

  return {
    shouldShowPowerUserModal,
    dismissPowerUserModal,
    hasDismissedPowerUserModal,
  };
}
