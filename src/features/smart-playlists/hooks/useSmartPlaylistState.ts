import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import {
  loadSmartPlaylistsFromStorage,
  saveSmartPlaylistsToStorage,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";

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
  setSmartPlaylists: Dispatch<SetStateAction<SmartPlaylistCriteria[]>>;
  updateSmartPlaylistsImmediate: (
    updater: (prev: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[],
  ) => SmartPlaylistCriteria[];
  replaceSmartPlaylists: (playlists: SmartPlaylistCriteria[]) => void;
  resetSmartPlaylists: () => void;
}

export function useSmartPlaylistState(): UseSmartPlaylistStateResult {
  const [smartPlaylists, setSmartPlaylistsState] = useState<
    SmartPlaylistCriteria[]
  >([]);
  const smartPlaylistsRef = useRef<SmartPlaylistCriteria[]>([]);

  const persistAndSyncState = useCallback((next: SmartPlaylistCriteria[]) => {
    smartPlaylistsRef.current = next;
    setSmartPlaylistsState(next);

    try {
      saveSmartPlaylistsToStorage(next);
      dispatchSmartPlaylistsUpdated(next);
    } catch (error) {
      console.error("Error saving smart playlist data:", error);
    }
  }, []);

  const updateSmartPlaylistsImmediate = useCallback(
    (updater: (prev: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[]) => {
      const currentPlaylists = smartPlaylistsRef.current;
      const updated = updater(currentPlaylists);

      if (currentPlaylists.length > 0 && updated.length === 0) {
        return currentPlaylists;
      }

      persistAndSyncState(updated);
      return updated;
    },
    [persistAndSyncState],
  );

  const setSmartPlaylists: Dispatch<SetStateAction<SmartPlaylistCriteria[]>> =
    useCallback((value) => {
      setSmartPlaylistsState((previous) => {
        const next =
          typeof value === "function"
            ? (
                value as (
                  prev: SmartPlaylistCriteria[],
                ) => SmartPlaylistCriteria[]
              )(previous)
            : value;

        smartPlaylistsRef.current = next;

        try {
          saveSmartPlaylistsToStorage(next);
          dispatchSmartPlaylistsUpdated(next);
        } catch (error) {
          console.error("Error saving smart playlist data:", error);
        }

        return next;
      });
    }, []);

  const replaceSmartPlaylists = useCallback(
    (playlists: SmartPlaylistCriteria[]) => {
      persistAndSyncState(playlists);
    },
    [persistAndSyncState],
  );

  const resetSmartPlaylists = useCallback(() => {
    persistAndSyncState([]);
  }, [persistAndSyncState]);

  useEffect(() => {
    try {
      const validPlaylists = loadSmartPlaylistsFromStorage();
      if (validPlaylists.length === 0) {
        return;
      }

      smartPlaylistsRef.current = validPlaylists;
      setSmartPlaylistsState(validPlaylists);
    } catch (error) {
      console.error("Error loading smart playlists:", error);
    }
  }, []);

  return {
    smartPlaylists,
    smartPlaylistsRef,
    setSmartPlaylists,
    updateSmartPlaylistsImmediate,
    replaceSmartPlaylists,
    resetSmartPlaylists,
  };
}
