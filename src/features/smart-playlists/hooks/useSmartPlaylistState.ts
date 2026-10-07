import {
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import {
  clearExplicitSmartPlaylistClear,
  loadSmartPlaylistsFromStorage,
  markSmartPlaylistsExplicitlyCleared,
  saveSmartPlaylistsToStorage,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";

import { registerLocalPersistenceFlusher } from "@/services/sync/SyncLocalState";

const SMART_PLAYLISTS_UPDATED_EVENT = "tagify:smartPlaylistsUpdated";

function dispatchSmartPlaylistsUpdated(playlists: SmartPlaylistCriteria[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.dispatchEvent(
      new CustomEvent(SMART_PLAYLISTS_UPDATED_EVENT, {
        detail: {
          count: playlists.length,
          playlistIds: playlists.map((playlist) => playlist.playlistId),
          playlists,
        },
      }),
    );
  } catch (error) {
    console.error("Error dispatching smart playlists updated event:", error);
  }
}

export interface UseSmartPlaylistStateResult {
  smartPlaylists: SmartPlaylistCriteria[];
  smartPlaylistsRef: MutableRefObject<SmartPlaylistCriteria[]>;
  setSmartPlaylists: (value: SetStateAction<SmartPlaylistCriteria[]>) => Promise<void>;
  updateSmartPlaylistsImmediate: (
    updater: (prev: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[],
  ) => Promise<SmartPlaylistCriteria[]>;
  replaceSmartPlaylists: (playlists: SmartPlaylistCriteria[]) => Promise<void>;
  refreshSmartPlaylists: () => Promise<void>;
  resetSmartPlaylists: () => Promise<void>;
}

export function useSmartPlaylistState(): UseSmartPlaylistStateResult {
  const [smartPlaylists, setSmartPlaylistsState] = useState<
    SmartPlaylistCriteria[]
  >([]);
  const smartPlaylistsRef = useRef<SmartPlaylistCriteria[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => registerLocalPersistenceFlusher(() => saveQueueRef.current), []);

  const persistAndSyncState = useCallback((next: SmartPlaylistCriteria[]) => {
    smartPlaylistsRef.current = next;
    setSmartPlaylistsState(next);

    const save = saveQueueRef.current.then(() => saveSmartPlaylistsToStorage(next));
    saveQueueRef.current = save.catch(() => undefined);
    return save.then(
      () => dispatchSmartPlaylistsUpdated(next),
      async (error) => {
        if (smartPlaylistsRef.current === next) {
          try {
            const restored = await loadSmartPlaylistsFromStorage();
            if (smartPlaylistsRef.current === next) {
              smartPlaylistsRef.current = restored;
              setSmartPlaylistsState(restored);
            }
          } catch (reloadError) {
            console.error("Could not reload smart playlists after a failed save:", reloadError);
          }
        }
        throw error;
      },
    );
  }, []);

  const updateSmartPlaylistsImmediate = useCallback(
    async (updater: (prev: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[]) => {
      const currentPlaylists = smartPlaylistsRef.current;
      const updated = updater(currentPlaylists);

      if (currentPlaylists.length > 0 && updated.length === 0) {
        return currentPlaylists;
      }

      await persistAndSyncState(updated);
      return updated;
    },
    [persistAndSyncState],
  );

  const setSmartPlaylists = useCallback(
    (value: SetStateAction<SmartPlaylistCriteria[]>) =>
      persistAndSyncState(
        typeof value === "function" ? value(smartPlaylistsRef.current) : value,
      ),
    [persistAndSyncState],
  );

  const replaceSmartPlaylists = useCallback(
    (playlists: SmartPlaylistCriteria[]) => persistAndSyncState(playlists),
    [persistAndSyncState],
  );

  const refreshSmartPlaylists = useCallback(async () => {
    await saveQueueRef.current;
    const restored = await loadSmartPlaylistsFromStorage();
    smartPlaylistsRef.current = restored;
    setSmartPlaylistsState(restored);
  }, []);

  const resetSmartPlaylists = useCallback(async () => {
    markSmartPlaylistsExplicitlyCleared();
    try {
      await persistAndSyncState([]);
    } catch (error) {
      clearExplicitSmartPlaylistClear();
      throw error;
    }
  }, [persistAndSyncState]);

  useEffect(() => {
    void loadSmartPlaylistsFromStorage()
      .then((validPlaylists) => {
        smartPlaylistsRef.current = validPlaylists;
        setSmartPlaylistsState(validPlaylists);
      })
      .catch((error) => {
        console.error("Error loading smart playlists:", error);
      });
  }, []);

  useEffect(() => {
    const reload = (event?: Event) => {
      const eventPlaylists = (
        event as CustomEvent<{ playlists?: SmartPlaylistCriteria[] }>
      )?.detail?.playlists;
      if (Array.isArray(eventPlaylists)) {
        smartPlaylistsRef.current = eventPlaylists;
        setSmartPlaylistsState(eventPlaylists);
        return;
      }
      void refreshSmartPlaylists().catch((error) => {
        console.error("Error loading smart playlists:", error);
      });
    };
    window.addEventListener("tagify:durableStateRestored", reload);
    window.addEventListener(SMART_PLAYLISTS_UPDATED_EVENT, reload);
    window.addEventListener("tagify:dataUpdated", reload);
    return () => {
      window.removeEventListener("tagify:durableStateRestored", reload);
      window.removeEventListener(SMART_PLAYLISTS_UPDATED_EVENT, reload);
      window.removeEventListener("tagify:dataUpdated", reload);
    };
  }, [refreshSmartPlaylists]);

  return {
    smartPlaylists,
    smartPlaylistsRef,
    setSmartPlaylists,
    updateSmartPlaylistsImmediate,
    replaceSmartPlaylists,
    refreshSmartPlaylists,
    resetSmartPlaylists,
  };
}
