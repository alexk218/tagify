import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure } from "@/types/tagData";
import { useTagData } from "@/features/tag-data";
import { useMetadataBackfill } from "../useMetadataBackfill";
import { RECOVERY_UNAVAILABLE_SKIP_MS, RECOVERY_UNAVAILABLE_UNTIL_KEY } from "@/services/sync/SyncInstallRecovery";

const uri = `spotify:track:${"b".repeat(22)}`;
const library: TagDataStructure = {
  ...JSON.parse(JSON.stringify(defaultTagData)),
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  tracks: {
    [uri]: {
      name: "Slide", artists: "Low", albumUri: "spotify:album:cccccccccccccccccccccc", albumName: "Double Negative",
      albumImageUrl: "https://i.scdn.co/image/slide", rating: 4, energy: 0, bpm: null, camelotKey: null,
      tagIds: ["rock", "pop", "jazz"], dateCreated: 1_000, dateModified: 1_000,
    },
  },
};

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  // Community already found nothing to reconnect on this computer, so opening the library
  // doesn't wait 3 s for a Spotify sign-in this test page never provides.
  localStorage.setItem(RECOVERY_UNAVAILABLE_UNTIL_KEY, String(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS));
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll(library)).toBe(true);
  localStorage.setItem("tagify:migrationCompleted", "true");
});

afterEach(() => {
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Looking up a song's tempo and key can take a few seconds. Tags added to
// that song in the meantime must survive when the lookup is saved.
it("keeps tags added while song details are being looked up", { timeout: 20_000 }, async () => {
  let finishLookup!: () => void;
  const lookup = new Promise<void>((resolve) => { finishLookup = resolve; });
  const getAudioFeatures = vi.spyOn(audioFeaturesService, "getAudioFeaturesFromUri").mockImplementation(async () => {
    await lookup;
    return { bpm: 72, camelotKey: "8A" } as Awaited<ReturnType<typeof audioFeaturesService.getAudioFeaturesFromUri>>;
  });

  const { result } = renderHook(() => {
    const tagData = useTagData();
    useMetadataBackfill({ enabled: !tagData.isLoading, onComplete: () => { void tagData.loadTagData(); } });
    return tagData;
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });
  await waitFor(() => expect(getAudioFeatures).toHaveBeenCalled());

  await act(async () => { await result.current.toggleTagSingleTrack(uri, "classical"); });
  await act(async () => { await result.current.toggleTagSingleTrack(uri, "country"); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  finishLookup();
  await act(() => new Promise((resolve) => setTimeout(resolve, 500)));

  const expected = ["rock", "pop", "jazz", "classical", "country"];
  const saved = (await indexedDBStorage.loadAllStrict()).tracks[uri];
  expect(saved.tagIds).toEqual(expected);
  expect(saved).toMatchObject({ bpm: 72, camelotKey: "8A" });
  expect(result.current.tagData.tracks[uri].tagIds).toEqual(expected);
});
