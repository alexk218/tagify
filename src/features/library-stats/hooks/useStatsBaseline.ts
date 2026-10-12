import { useEffect, useRef, useState } from "react";
import type { TagDataStructure } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getTagifyDatabaseName, STATS_BASELINE_CHANGED_EVENT } from "@/services/sync/SyncLocalState";
import { createStatsBaseline, type StatsBaseline } from "../model/libraryStats";

/**
 * This account's Stats baseline, saved from the current library the first time Stats opens.
 * `undefined` while loading; `null` when there is none yet (an empty library) or it can't be read,
 * in which case Stats use first-tagged dates.
 */
export function useStatsBaseline(tagData: TagDataStructure, enabled: boolean): StatsBaseline | null | undefined {
  const account = getTagifyDatabaseName();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(STATS_BASELINE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(STATS_BASELINE_CHANGED_EVENT, refresh);
  }, []);
  const [loaded, setLoaded] = useState<{ account: string; baseline: StatsBaseline | null } | null>(null);
  // Read the library when saving, without reloading the baseline after every edit.
  const tracks = useRef(tagData.tracks);
  tracks.current = tagData.tracks;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      let baseline: StatsBaseline | null = null;
      try {
        baseline = await indexedDBStorage.getStatsBaseline(account);
        if (!baseline) {
          const created = createStatsBaseline(tracks.current, Date.now());
          if (Object.keys(created.dates).length) baseline = await indexedDBStorage.saveStatsBaseline(created, account);
        }
      } catch (error) {
        console.error("Stats: couldn't load the dates saved when Stats first opened", error);
      }
      if (!cancelled) setLoaded({ account, baseline });
    })();
    return () => { cancelled = true; };
  }, [enabled, account, revision]);

  return loaded?.account === account ? loaded.baseline : undefined;
}
